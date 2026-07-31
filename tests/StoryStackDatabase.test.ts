// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StoryStackDatabase } from "../src/storage/StoryStackDatabase";
import { PasswordHasher } from "../src/services/PasswordHasher";

describe("StoryStackDatabase", () => {
  afterEach(() => {
    delete process.env.STORY_STACK_ADMIN_PASSWORD;
    delete process.env.STORY_STACK_USER_PASSWORD;
  });

  it("updates an existing source path when a richer importer uses a new id", async () => {
    const databasePath = path.join(os.tmpdir(), `story-stack-db-${crypto.randomUUID()}.sqlite`);
    const database = new StoryStackDatabase(databasePath);

    database.upsertBook({
      id: "folder_scan_id",
      sourcePath: "/srv/media/audiobooks/Jamie/Book One",
      title: "Book One Folder Name",
      author: "Unknown Author",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });

    const status = database.upsertBook({
      id: "abs_item_id",
      sourcePath: "/srv/media/audiobooks/Jamie/Book One",
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
      sourcePath: "/srv/media/audiobooks/Jamie/Book Two",
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
});
