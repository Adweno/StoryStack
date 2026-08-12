// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogSyncService } from "../src/services/CatalogSyncService";
import { StoryStackDatabase } from "../src/storage/StoryStackDatabase";

const originalEnv = { ...process.env };

describe("CatalogSyncService", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("maps a common src typo to the matching Audiobookshelf subfolder", async () => {
    process.env.STORY_STACK_ABS_DB_PATH = "/abs-config/absdatabase.sqlite";
    process.env.STORY_STACK_MEDIA_PATH_PREFIX = "/srv/media/audiobooks";
    process.env.STORY_STACK_ABS_MEDIA_PATH_PREFIX = "/audiobooks";
    process.env.STORY_STACK_ABS_LIBRARY_PATH_PREFIX = "/audiobooks";

    const importer = {
      importBooks: vi.fn(() => [])
    };
    const database = new StoryStackDatabase(path.join(os.tmpdir(), `story-stack-sync-${crypto.randomUUID()}.sqlite`));
    const service = new CatalogSyncService(database, undefined, importer as never);

    const result = await service.sync("src/media/audiobooks/Adam");

    expect(importer.importBooks).toHaveBeenCalledWith(expect.objectContaining({ libraryPathPrefix: "/audiobooks/Adam" }));
    expect(result.path).toBe("/audiobooks/Adam");
  });

  it("shows only books from the latest synced catalog path", async () => {
    process.env.STORY_STACK_ABS_DB_PATH = "/abs-config/absdatabase.sqlite";
    process.env.STORY_STACK_MEDIA_PATH_PREFIX = "/srv/media/audiobooks";
    process.env.STORY_STACK_ABS_MEDIA_PATH_PREFIX = "/audiobooks";

    const database = new StoryStackDatabase(path.join(os.tmpdir(), `story-stack-sync-${crypto.randomUUID()}.sqlite`));
    database.upsertBook({
      id: "jamie_book",
      sourcePath: "/srv/media/audiobooks/Sample User/Book",
      title: "Sample Book",
      author: "A. Writer",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });
    const importer = {
      importBooks: vi.fn(() => [
        {
          id: "adam_book",
          sourcePath: "/srv/media/audiobooks/Adam/Book",
          title: "Adam Book",
          author: "A. Writer",
          genres: [],
          addedAt: "2026-07-30T00:00:00.000Z",
          hidden: false
        }
      ])
    };
    const service = new CatalogSyncService(database, undefined, importer as never);

    const result = await service.sync("/srv/media/audiobooks/Adam");

    expect(result.removed).toBe(1);
    expect(database.listVisibleBooks().map((book) => book.title)).toEqual(["Adam Book"]);
  });

  it("keeps updated books visible when their stored id differs from the importer id", async () => {
    process.env.STORY_STACK_ABS_DB_PATH = "/abs-config/absdatabase.sqlite";
    process.env.STORY_STACK_MEDIA_PATH_PREFIX = "/srv/media/audiobooks";
    process.env.STORY_STACK_ABS_MEDIA_PATH_PREFIX = "/audiobooks";

    const database = new StoryStackDatabase(path.join(os.tmpdir(), `story-stack-sync-${crypto.randomUUID()}.sqlite`));
    database.upsertBook({
      id: "old_scan_id",
      sourcePath: "/srv/media/audiobooks/Adam/Book",
      title: "Old Title",
      author: "Unknown Author",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });
    const importer = {
      importBooks: vi.fn(() => [
        {
          id: "abs_new_id",
          sourcePath: "/srv/media/audiobooks/Adam/Book",
          title: "Updated Title",
          author: "A. Writer",
          genres: [],
          addedAt: "2026-07-30T00:00:00.000Z",
          hidden: false
        }
      ])
    };
    const service = new CatalogSyncService(database, undefined, importer as never);

    await service.sync("/srv/media/audiobooks/Adam");

    expect(database.listVisibleBooks().map((book) => book.id)).toEqual(["old_scan_id"]);
    expect(database.listVisibleBooks().map((book) => book.title)).toEqual(["Updated Title"]);
  });
});
