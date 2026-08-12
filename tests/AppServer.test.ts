// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AppContext } from "../src/api/AppContext";
import { AppServer } from "../src/api/AppServer";

function testDatabasePath(): string {
  return path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
}

describe("AppServer", () => {
  it("signs in with a native Story Stack account", async () => {
    const context = new AppContext({ databasePath: testDatabasePath() });
    const response = await request(new AppServer(context).app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin" })
      .expect(200);

    expect(response.body.user.role).toBe("admin");
  });

  it("lets an admin scan an audiobook folder and serves its audio file", async () => {
    const databasePath = testDatabasePath();
    const libraryPath = path.join(os.tmpdir(), `story-stack-library-${crypto.randomUUID()}`);
    const bookFolder = path.join(libraryPath, "A Writer", "Folder Scan Book");
    await mkdir(bookFolder, { recursive: true });
    const audioPath = path.join(bookFolder, "book.mp3");
    await writeFile(audioPath, "audio-placeholder");
    await writeFile(path.join(bookFolder, "metadata.json"), JSON.stringify({ title: "Folder Scan Book", author: "A Writer" }));

    const context = new AppContext({ databasePath });
    const app = new AppServer(context).app;
    const login = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin" }).expect(200);
    const cookie = login.headers["set-cookie"];

    await request(app).post("/api/admin/catalog").set("Cookie", cookie).send({ libraryPath }).expect(200);
    const sync = await request(app).post("/api/admin/catalog/sync").set("Cookie", cookie).send({}).expect(200);
    expect(sync.body.result).toMatchObject({ scanned: 1, imported: 1, removed: 0 });

    const store = await request(app).get("/api/store").set("Cookie", cookie).expect(200);
    expect(store.body.books.map((book: { title: string }) => book.title)).toEqual(["Folder Scan Book"]);
    const book = store.body.books[0] as { id: string };
    await request(app).post("/api/library").set("Cookie", cookie).send({ bookId: book.id }).expect(201);

    const audio = await request(app).get(`/media/books/${book.id}/audio`).set("Cookie", cookie).expect(200);
    expect(audio.body.toString()).toBe("audio-placeholder");
  });

  it("creates and accepts a Story Stack invite", async () => {
    const app = new AppServer(new AppContext({ databasePath: testDatabasePath() })).app;
    const admin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin" }).expect(200);
    const invite = await request(app)
      .post("/api/admin/invites")
      .set("Cookie", admin.headers["set-cookie"])
      .send({ email: "listener@example.com", role: "user", expiresInDays: 7 })
      .expect(201);
    const token = invite.body.invite.token;

    const accepted = await request(app).post(`/api/invites/${token}/accept`).send({ name: "Listener", password: "correct horse" }).expect(200);
    expect(accepted.body.user.email).toBe("listener@example.com");
    await request(app).post("/api/auth/login").send({ username: "listener@example.com", password: "correct horse" }).expect(200);
  });
});
