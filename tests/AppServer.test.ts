// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContext } from "../src/api/AppContext";
import { AppServer } from "../src/api/AppServer";

describe("AppServer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs in with a native Story Stack account", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    const context = new AppContext({ databasePath });
    const app = new AppServer(context).app;

    const loginResponse = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin" }).expect(200);

    expect(loginResponse.body.user.role).toBe("admin");
    await request(app).get("/api/me").set("Cookie", loginResponse.headers["set-cookie"]).expect(200);
  });

  it("lets signed-in users set and change their Story Stack password", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    const context = new AppContext({ databasePath });
    const app = new AppServer(context).app;
    stubPlexAuth({ email: "reader@example.com", name: "Reader" });

    await request(app).post("/api/auth/plex/start").expect(200);
    const plexLogin = await request(app).post("/api/auth/plex/poll").send({ pinId: 123 }).expect(200);
    const cookie = plexLogin.headers["set-cookie"];
    expect(plexLogin.body.user.passwordConfigured).toBe(false);

    const setPassword = await request(app).post("/api/me/password").set("Cookie", cookie).send({ newPassword: "first secure password" }).expect(200);
    expect(setPassword.body.user.passwordConfigured).toBe(true);

    await request(app).post("/api/auth/login").send({ username: "reader@example.com", password: "first secure password" }).expect(200);
    await request(app)
      .post("/api/me/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "wrong password", newPassword: "second secure password" })
      .expect(401);
    await request(app)
      .post("/api/me/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "first secure password", newPassword: "second secure password" })
      .expect(200);
    await request(app).post("/api/auth/login").send({ username: "reader@example.com", password: "second secure password" }).expect(200);
  });

  it("creates and accepts a Story Stack invite without Plex", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    const context = new AppContext({ databasePath });
    const app = new AppServer(context).app;
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin" }).expect(200);

    const inviteResponse = await request(app)
      .post("/api/admin/invites")
      .set("Cookie", adminLogin.headers["set-cookie"])
      .send({ email: "listener@example.com", role: "user", expiresInDays: 7 })
      .expect(201);
    const token = inviteResponse.body.invite.token;

    await request(app).get(`/api/invites/${token}`).expect(200);
    const accepted = await request(app).post(`/api/invites/${token}/accept`).send({ name: "Listener", password: "correct horse" }).expect(200);
    expect(accepted.body.user.email).toBe("listener@example.com");
    expect(accepted.body.user.role).toBe("user");

    await request(app).post("/api/auth/login").send({ username: "listener@example.com", password: "correct horse" }).expect(200);
  });

  it("lets admins manage user status and remote access settings", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    const context = new AppContext({ databasePath });
    const app = new AppServer(context).app;
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin" }).expect(200);

    const userResponse = await request(app)
      .post("/api/admin/users")
      .set("Cookie", adminLogin.headers["set-cookie"])
      .send({ name: "Reader Two", email: "reader-two@example.com", role: "user" })
      .expect(201);

    const disabled = await request(app)
      .patch(`/api/admin/users/${userResponse.body.user.id}`)
      .set("Cookie", adminLogin.headers["set-cookie"])
      .send({ status: "disabled" })
      .expect(200);
    expect(disabled.body.user.status).toBe("disabled");

    const remote = await request(app)
      .post("/api/admin/remote-access")
      .set("Cookie", adminLogin.headers["set-cookie"])
      .send({ mode: "manual", publicUrl: "http://192.168.1.234:4100" })
      .expect(200);
    expect(remote.body.settings.status).toBe("warning");
  });

  it("lets admins set a managed user's password", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    const context = new AppContext({ databasePath });
    const app = new AppServer(context).app;
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin" }).expect(200);
    const cookie = adminLogin.headers["set-cookie"];

    const userResponse = await request(app)
      .post("/api/admin/users")
      .set("Cookie", cookie)
      .send({ name: "Reader Two", email: "reader-two@example.com", role: "user" })
      .expect(201);
    expect(userResponse.body.user.passwordConfigured).toBe(false);

    const reset = await request(app)
      .post(`/api/admin/users/${userResponse.body.user.id}/password`)
      .set("Cookie", cookie)
      .send({ newPassword: "reset secure password" })
      .expect(200);
    expect(reset.body.user.passwordConfigured).toBe(true);
    expect(reset.body.user.passwordResetRequired).toBe(true);

    const login = await request(app).post("/api/auth/login").send({ username: "reader-two@example.com", password: "reset secure password" }).expect(200);
    expect(login.body.user.passwordResetRequired).toBe(true);

    const changed = await request(app)
      .post("/api/me/password")
      .set("Cookie", login.headers["set-cookie"])
      .send({ newPassword: "private secure password" })
      .expect(200);
    expect(changed.body.user.passwordResetRequired).toBe(false);
    await request(app).post("/api/auth/login").send({ username: "reader-two@example.com", password: "private secure password" }).expect(200);
  });

  it("adds and removes a Store book from My Library through the API", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    const context = new AppContext({ databasePath });
    context.database.upsertBook({
      id: "book_api",
      sourcePath: "/books/api",
      title: "API Book",
      author: "A. Writer",
      genres: [],
      addedAt: new Date().toISOString(),
      hidden: false
    });
    const app = new AppServer(context).app;
    stubPlexAuth({ email: "adam.w.nott@gmail.com", name: "Adam" });
    await request(app).post("/api/auth/plex/start").expect(200);
    const loginResponse = await request(app).post("/api/auth/plex/poll").send({ pinId: 123 }).expect(200);
    const cookie = loginResponse.headers["set-cookie"];

    await request(app).post("/api/library").set("Cookie", cookie).send({ bookId: "book_api" }).expect(201);
    const libraryResponse = await request(app).get("/api/library").set("Cookie", cookie).expect(200);
    expect(libraryResponse.body.books).toHaveLength(1);

    await request(app).delete("/api/library/book_api").set("Cookie", cookie).expect(204);
    const emptyLibraryResponse = await request(app).get("/api/library").set("Cookie", cookie).expect(200);
    expect(emptyLibraryResponse.body.books).toHaveLength(0);
  });

  it("lets users rate and review a book", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    const context = new AppContext({ databasePath });
    context.database.upsertBook({
      id: "book_reviewed",
      sourcePath: "/books/reviewed",
      title: "Reviewed Book",
      author: "A. Writer",
      genres: [],
      addedAt: new Date().toISOString(),
      hidden: false
    });
    const app = new AppServer(context).app;
    const loginResponse = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin" }).expect(200);
    const cookie = loginResponse.headers["set-cookie"];

    await request(app)
      .post("/api/books/book_reviewed/reviews")
      .set("Cookie", cookie)
      .send({ rating: 5, review: "Fantastic listen." })
      .expect(403);

    await request(app).post("/api/library").set("Cookie", cookie).send({ bookId: "book_reviewed" }).expect(201);

    const savedReview = await request(app)
      .post("/api/books/book_reviewed/reviews")
      .set("Cookie", cookie)
      .send({ rating: 5, review: "Fantastic listen." })
      .expect(200);
    expect(savedReview.body.review).toMatchObject({ rating: 5, review: "Fantastic listen.", userName: "Admin", isMine: true });

    const reviews = await request(app).get("/api/books/book_reviewed/reviews").set("Cookie", cookie).expect(200);
    expect(reviews.body.summary).toMatchObject({ averageRating: 5, reviewCount: 1 });
    expect(reviews.body.reviews).toHaveLength(1);

    await request(app)
      .post("/api/books/book_reviewed/reviews")
      .set("Cookie", cookie)
      .send({ rating: 4, review: "Still very good." })
      .expect(200);
    const updatedReviews = await request(app).get("/api/books/book_reviewed/reviews").set("Cookie", cookie).expect(200);
    expect(updatedReviews.body.summary).toMatchObject({ averageRating: 4, reviewCount: 1 });
    expect(updatedReviews.body.myReview).toMatchObject({ rating: 4, review: "Still very good." });

    await request(app).delete("/api/books/book_reviewed/reviews/me").set("Cookie", cookie).expect(204);
    const removedReviews = await request(app).get("/api/books/book_reviewed/reviews").set("Cookie", cookie).expect(200);
    expect(removedReviews.body.summary).toMatchObject({ averageRating: 0, reviewCount: 0 });
    expect(removedReviews.body.reviews).toHaveLength(0);
  });

  it("requires login and admin role for Store settings routes", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    const context = new AppContext({ databasePath });
    const app = new AppServer(context).app;

    await request(app).get("/api/me").expect(401);
    await request(app).get("/api/admin/users").expect(401);

    stubPlexAuth({ email: "reader@example.com", name: "Reader" });
    await request(app).post("/api/auth/plex/start").expect(200);
    const userLogin = await request(app).post("/api/auth/plex/poll").send({ pinId: 123 }).expect(200);
    expect(userLogin.body.user.role).toBe("user");
    await request(app).get("/api/admin/users").set("Cookie", userLogin.headers["set-cookie"]).expect(403);
    await request(app).post("/api/admin/metadata/enrich").set("Cookie", userLogin.headers["set-cookie"]).send({}).expect(403);
    await request(app).get("/api/admin/catalog").set("Cookie", userLogin.headers["set-cookie"]).expect(403);

    stubPlexAuth({ email: "adam.w.nott@gmail.com", name: "Adam" });
    await request(app).post("/api/auth/plex/start").expect(200);
    const adminLogin = await request(app).post("/api/auth/plex/poll").send({ pinId: 123 }).expect(200);
    expect(adminLogin.body.user.role).toBe("admin");
    const usersResponse = await request(app).get("/api/admin/users").set("Cookie", adminLogin.headers["set-cookie"]).expect(200);
    expect(usersResponse.body.users.some((user: { email?: string; role?: string }) => user.email === "adam.w.nott@gmail.com" && user.role === "admin")).toBe(
      true
    );

    const addedUser = await request(app)
      .post("/api/admin/users")
      .set("Cookie", adminLogin.headers["set-cookie"])
      .send({ name: "Jamie", email: "jamie@example.com", role: "user" })
      .expect(201);
    expect(addedUser.body.user.role).toBe("user");

    await request(app)
      .patch(`/api/admin/users/${addedUser.body.user.id}`)
      .set("Cookie", adminLogin.headers["set-cookie"])
      .send({ role: "admin" })
      .expect(200);

    await request(app).delete(`/api/admin/users/${addedUser.body.user.id}`).set("Cookie", adminLogin.headers["set-cookie"]).expect(204);
  });

  it("lets an admin choose and scan the audiobook folder", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    const libraryPath = path.join(os.tmpdir(), `story-stack-library-${crypto.randomUUID()}`);
    const bookFolder = path.join(libraryPath, "A Writer", "Folder Scan Book");
    await mkdir(bookFolder, { recursive: true });
    await writeFile(path.join(bookFolder, "book.mp3"), "audio-placeholder");
    await writeFile(path.join(bookFolder, "metadata.json"), JSON.stringify({ title: "Folder Scan Book", author: "A Writer" }));
    const context = new AppContext({ databasePath });
    const app = new AppServer(context).app;
    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin" }).expect(200);
    const cookie = adminLogin.headers["set-cookie"];

    const saved = await request(app).post("/api/admin/catalog").set("Cookie", cookie).send({ libraryPath }).expect(200);
    expect(saved.body.settings.libraryPath).toBe(libraryPath);

    const sync = await request(app).post("/api/admin/catalog/sync").set("Cookie", cookie).send({}).expect(200);
    expect(sync.body.result).toMatchObject({ scanned: 1, imported: 1, removed: 0 });

    const store = await request(app).get("/api/store").set("Cookie", cookie).expect(200);
    expect(store.body.books.map((book: { title: string }) => book.title)).toEqual(["Folder Scan Book"]);
  });

  it("lets an admin enrich missing metadata through the API", async () => {
    const dataDir = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}`);
    stubPlexAuth({ email: "adam.w.nott@gmail.com", name: "Adam" });
    const context = new AppContext({ dataDir });
    context.database.upsertBook({
      id: "api_metadata",
      sourcePath: "/books/api-metadata",
      title: "API Metadata",
      author: "Unknown Author",
      genres: [],
      addedAt: new Date().toISOString(),
      hidden: false
    });
    const app = new AppServer(context).app;
    const loginResponse = await request(app).post("/api/auth/plex/poll").send({ pinId: 123 }).expect(200);

    stubMetadataFetch();
    const response = await request(app).post("/api/admin/metadata/enrich").set("Cookie", loginResponse.headers["set-cookie"]).send({}).expect(200);
    const book = await context.database.getBook("api_metadata");

    expect(response.body.result).toMatchObject({ scanned: 1, matched: 1, coversAdded: 1, detailsAdded: 1 });
    expect(book?.description).toBe("Found through Google Books.");
    expect(book?.coverPath).toContain(path.join(dataDir, "covers"));
  });

  it("proxies matched Plex audio for a signed-in user", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-api-${crypto.randomUUID()}.sqlite`);
    stubPlexAuth({ email: "adam.w.nott@gmail.com", name: "Adam" });
    const context = new AppContext({ databasePath });
    context.database.upsertBook({
      id: "plex_audio",
      sourcePath: "/books/plex-audio",
      title: "Plex Audio",
      author: "A. Writer",
      genres: [],
      addedAt: new Date().toISOString(),
      hidden: false
    });
    context.database.savePlexSettings({ serverUrl: "http://plex.test:32400", sectionKey: "12" });
    context.database.updateBookPlexMatch("plex_audio", {
      plexKey: "901",
      plexPartKey: "/library/parts/902/file.m4b",
      plexFile: "/books/plex-audio/book.m4b"
    });
    const app = new AppServer(context).app;
    const loginResponse = await request(app).post("/api/auth/plex/poll").send({ pinId: 123 }).expect(200);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).startsWith("http://plex.test:32400/library/parts/902/file.m4b")) {
          return new Response("plex audio", { headers: { "Content-Type": "audio/mp4" } });
        }
        return jsonResponse({}, 404);
      })
    );

    const response = await request(app).get("/media/books/plex_audio/audio").set("Cookie", loginResponse.headers["set-cookie"]).expect(200);

    expect(response.body.toString()).toBe("plex audio");
    expect(response.headers["content-type"]).toContain("audio/mp4");
  });
});

function stubPlexAuth({ email, name }: { email: string; name: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/api/v2/pins?")) {
        return jsonResponse({ id: 123, code: "ABCD" });
      }
      if (target.includes("/api/v2/pins/123")) {
        return jsonResponse({ id: 123, code: "ABCD", authToken: "plex-token" });
      }
      if (target.includes("/api/v2/user") && init?.headers) {
        return jsonResponse({ uuid: `plex-${email}`, email, title: name });
      }
      return jsonResponse({}, 404);
    })
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function stubMetadataFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (target.includes("googleapis.com/books/v1/volumes")) {
        return jsonResponse({
          items: [
            {
              volumeInfo: {
                title: "API Metadata",
                authors: ["A. Writer"],
                description: "Found through Google Books.",
                categories: ["Fiction"],
                publishedDate: "2026",
                imageLinks: { thumbnail: "http://example.com/cover.jpg" }
              }
            }
          ]
        });
      }
      if (target.includes("example.com/cover.jpg")) {
        return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } });
      }
      return jsonResponse({}, 404);
    })
  );
}
