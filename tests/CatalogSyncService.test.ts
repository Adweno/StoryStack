// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogSyncService } from "../src/services/CatalogSyncService";
import { StoryStackDatabase } from "../src/storage/StoryStackDatabase";

const originalEnv = { ...process.env };

describe("CatalogSyncService", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("scans source folders even when Audiobookshelf configuration is present", async () => {
    process.env.STORY_STACK_ABS_DB_PATH = "/does-not-exist/absdatabase.sqlite";
    const root = await createLibrary({ title: "Source Book", author: "Source Author" });
    const database = createDatabase();

    const result = await new CatalogSyncService(database).sync(root);

    expect(result.scanned).toBe(1);
    expect(result.path).toBe(root);
    expect(database.listVisibleBooks().map((book) => book.title)).toEqual(["Source Book"]);
  });

  it("shows only books from the latest synced catalog path", async () => {
    const root = await createLibrary({ title: "Adam Book", author: "A. Writer" });
    const database = createDatabase();
    database.upsertBook({
      id: "jamie_book",
      sourcePath: "/other-library/Sample User/Book",
      title: "Sample Book",
      author: "A. Writer",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });

    const result = await new CatalogSyncService(database).sync(root);

    expect(result.removed).toBe(1);
    expect(database.listVisibleBooks().map((book) => book.title)).toEqual(["Adam Book"]);
  });

  it("removes missing books from user libraries and shelves during sync", async () => {
    const root = path.join(os.tmpdir(), `story-stack-empty-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    const database = createDatabase();
    database.upsertBook({
      id: "removed_book",
      sourcePath: "/old-library/Removed Book",
      title: "Removed Book",
      author: "A. Writer",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });
    await database.addLibraryBook({ userId: "user_admin", bookId: "removed_book", addedAt: "2026-07-30T00:00:00.000Z" });
    await database.createShelf({
      id: "shelf_removed_book",
      userId: "user_admin",
      name: "To Remove",
      createdAt: "2026-07-30T00:00:00.000Z"
    });
    await database.addBookToShelf({ shelfId: "shelf_removed_book", bookId: "removed_book", position: 0 });

    const result = await new CatalogSyncService(database).sync(root);

    expect(result.removed).toBe(1);
    expect(database.listLibraryBookDetails("user_admin")).toEqual([]);
    expect(database.listShelfBookDetails("user_admin", "shelf_removed_book")).toEqual([]);
  });
});

function createDatabase(): StoryStackDatabase {
  return new StoryStackDatabase(path.join(os.tmpdir(), `story-stack-sync-${crypto.randomUUID()}.sqlite`));
}

async function createLibrary(metadata: Record<string, unknown>): Promise<string> {
  const root = path.join(os.tmpdir(), `story-stack-library-${crypto.randomUUID()}`);
  const bookFolder = path.join(root, "Author", String(metadata.title));
  await mkdir(bookFolder, { recursive: true });
  await writeFile(path.join(bookFolder, "book.m4b"), "audio-placeholder");
  await writeFile(path.join(bookFolder, "metadata.json"), JSON.stringify(metadata));
  return root;
}
