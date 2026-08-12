// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StoryStackDatabase } from "../src/storage/StoryStackDatabase";
import { PasswordHasher } from "../src/services/PasswordHasher";

describe("StoryStackDatabase", () => {
  it("updates an existing source path when a richer importer uses a new id", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-db-${crypto.randomUUID()}.sqlite`);
    const database = new StoryStackDatabase(databasePath);

    database.upsertBook({
      id: "folder_scan_id",
      sourcePath: "/srv/media/audiobooks/Sample User/Book One",
      title: "Book One Folder Name",
      author: "Unknown Author",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });

    const status = database.upsertBook({
      id: "abs_item_id",
      sourcePath: "/srv/media/audiobooks/Sample User/Book One",
      title: "Book One",
      author: "A. Writer",
      narrator: "A. Narrator",
      genres: ["Fantasy"],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });

    const books = database.listBooks();
    expect(status).toEqual({ id: "folder_scan_id", status: "updated" });
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id: "folder_scan_id",
      title: "Book One",
      author: "A. Writer",
      narrator: "A. Narrator",
      genres: ["Fantasy"]
    });
  });

  it("updates only selected metadata fields for an existing book", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-db-${crypto.randomUUID()}.sqlite`);
    const database = new StoryStackDatabase(databasePath);

    database.upsertBook({
      id: "metadata_patch",
      sourcePath: "/srv/media/audiobooks/Sample User/Book Two",
      title: "Book Two",
      author: "Unknown Author",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });

    database.updateBookMetadata("metadata_patch", {
      author: "A. Writer",
      description: "Patched description.",
      genres: ["Fantasy"],
      coverPath: "/data/covers/metadata_patch.jpg"
    });

    await expect(database.getBook("metadata_patch")).resolves.toMatchObject({
      title: "Book Two",
      author: "A. Writer",
      description: "Patched description.",
      genres: ["Fantasy"],
      coverPath: "/data/covers/metadata_patch.jpg"
    });
  });

  it("persists ordered audio tracks for multi-file books", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-db-${crypto.randomUUID()}.sqlite`);
    const database = new StoryStackDatabase(databasePath);

    database.upsertBook({
      id: "multi_file",
      sourcePath: "/srv/media/audiobooks/Series/Book",
      title: "Multi File Book",
      author: "A. Writer",
      genres: [],
      audioPath: "/srv/media/audiobooks/Series/Book/part01.mp3",
      audioTracks: [
        { path: "/srv/media/audiobooks/Series/Book/part01.mp3", durationSeconds: 120 },
        { path: "/srv/media/audiobooks/Series/Book/part02.mp3", durationSeconds: 180 }
      ],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });

    await expect(database.getBook("multi_file")).resolves.toMatchObject({
      audioTracks: [
        { path: "/srv/media/audiobooks/Series/Book/part01.mp3", durationSeconds: 120 },
        { path: "/srv/media/audiobooks/Series/Book/part02.mp3", durationSeconds: 180 }
      ]
    });
  });

  it("creates a default Favorites shelf and keeps it first", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-db-${crypto.randomUUID()}.sqlite`);
    const database = new StoryStackDatabase(databasePath);

    await database.createShelf({
      id: "shelf_next",
      userId: "user_admin",
      name: "Next Up",
      createdAt: "2026-07-30T00:00:00.000Z"
    });

    const firstRead = await database.listShelves("user_admin");
    const secondRead = await database.listShelves("user_admin");

    expect(firstRead.map((shelf) => shelf.name)).toEqual(["Favorites", "Next Up"]);
    expect(secondRead.filter((shelf) => shelf.name === "Favorites")).toHaveLength(1);
  });

  it("rotates seeded account passwords when configured by environment", () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-db-${crypto.randomUUID()}.sqlite`);
    const hasher = new PasswordHasher();

    let database = new StoryStackDatabase(databasePath);
    let credentials = database.getUserCredentials("admin");
    expect(credentials?.passwordHash && hasher.verify("admin", credentials.passwordHash)).toBe(true);

    process.env.STORY_STACK_ADMIN_PASSWORD = "new secure admin password";
    database = new StoryStackDatabase(databasePath);
    credentials = database.getUserCredentials("admin");

    expect(credentials?.passwordHash && hasher.verify("admin", credentials.passwordHash)).toBe(false);
    expect(credentials?.passwordHash && hasher.verify("new secure admin password", credentials.passwordHash)).toBe(true);
  });

  it("does not seed accounts when production credentials are missing", () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-production-db-${crypto.randomUUID()}.sqlite`);
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAdminPassword = process.env.STORY_STACK_ADMIN_PASSWORD;
    const previousUserPassword = process.env.STORY_STACK_USER_PASSWORD;

    try {
      process.env.NODE_ENV = "production";
      delete process.env.STORY_STACK_ADMIN_PASSWORD;
      delete process.env.STORY_STACK_USER_PASSWORD;

      const database = new StoryStackDatabase(databasePath);

      expect(database.listUsers()).toEqual([]);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAdminPassword === undefined) delete process.env.STORY_STACK_ADMIN_PASSWORD;
      else process.env.STORY_STACK_ADMIN_PASSWORD = previousAdminPassword;
      if (previousUserPassword === undefined) delete process.env.STORY_STACK_USER_PASSWORD;
      else process.env.STORY_STACK_USER_PASSWORD = previousUserPassword;
    }
  });
});
