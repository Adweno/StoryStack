// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MetadataEnrichmentService } from "../src/services/MetadataEnrichmentService";
import { StoryStackDatabase } from "../src/storage/StoryStackDatabase";
import type { ExternalMetadataProvider } from "../src/services/ExternalMetadataProvider";

describe("MetadataEnrichmentService", () => {
  it("fills missing metadata and stores missing cover art locally", async () => {
    const dataDir = path.join(os.tmpdir(), `story-stack-metadata-${crypto.randomUUID()}`);
    const database = new StoryStackDatabase(path.join(dataDir, "story-stack.sqlite"));
    database.upsertBook({
      id: "missing_cover",
      sourcePath: "/books/missing-cover",
      title: "Missing Cover",
      author: "Unknown Author",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });
    const provider: ExternalMetadataProvider = {
      find: vi.fn(async () => ({
        author: "A. Writer",
        description: "A richer description.",
        genres: ["Fantasy"],
        publicationYear: 2024,
        coverUrl: "https://example.com/cover.jpg"
      }))
    };
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } }));
    const service = new MetadataEnrichmentService(database, { dataDir, fetcher, provider });

    const result = await service.enrichMissing();
    const book = await database.getBook("missing_cover");

    expect(result).toMatchObject({ scanned: 1, matched: 1, coversAdded: 1, detailsAdded: 1, errors: [] });
    expect(book).toMatchObject({
      author: "A. Writer",
      description: "A richer description.",
      genres: ["Fantasy"],
      publicationYear: 2024
    });
    expect(book?.coverPath).toContain(path.join(dataDir, "covers"));
    expect(existsSync(book?.coverPath ?? "")).toBe(true);
  });

  it("does not overwrite metadata that already exists", async () => {
    const dataDir = path.join(os.tmpdir(), `story-stack-metadata-${crypto.randomUUID()}`);
    const database = new StoryStackDatabase(path.join(dataDir, "story-stack.sqlite"));
    const existingCoverPath = path.join(dataDir, "existing-cover.jpg");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(existingCoverPath, "cover");
    database.upsertBook({
      id: "complete_book",
      sourcePath: "/books/complete-book",
      title: "Complete Book",
      author: "Original Author",
      description: "Original description.",
      genres: ["Memoir"],
      publicationYear: 2020,
      coverPath: existingCoverPath,
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });
    const provider: ExternalMetadataProvider = {
      find: vi.fn(async () => ({
        author: "Replacement Author",
        description: "Replacement description.",
        genres: ["Replacement"],
        publicationYear: 2026,
        coverUrl: "https://example.com/cover.jpg"
      }))
    };
    const service = new MetadataEnrichmentService(database, { dataDir, fetcher: vi.fn(), provider });

    const result = await service.enrichMissing();
    const book = await database.getBook("complete_book");

    expect(result.scanned).toBe(1);
    expect(result.coversAdded).toBe(0);
    expect(result.detailsAdded).toBe(0);
    expect(book).toMatchObject({
      author: "Original Author",
      description: "Original description.",
      genres: ["Memoir"],
      publicationYear: 2020,
      coverPath: existingCoverPath
    });
  });

  it("uses the first provider with a match and does not write during lookup", async () => {
    const dataDir = path.join(os.tmpdir(), `story-stack-metadata-${crypto.randomUUID()}`);
    const database = new StoryStackDatabase(path.join(dataDir, "story-stack.sqlite"));
    database.upsertBook({
      id: "preview_book",
      sourcePath: "/books/preview-book",
      title: "Preview Book",
      author: "Unknown Author",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });
    const audible = { find: vi.fn(async () => ({ title: "Preview Book", author: "A. Writer", coverUrl: "https://example.com/audible.jpg" })) };
    const google = { find: vi.fn(async () => ({ title: "Google Result" })) };
    const service = new MetadataEnrichmentService(database, { dataDir, fetcher: vi.fn(), providers: [audible, google] });

    const result = await service.findBook("preview_book");
    const book = await database.getBook("preview_book");

    expect(result).toMatchObject({ matched: true, provider: "Object" });
    expect(result.candidate).toMatchObject({ title: "Preview Book", coverUrl: "https://example.com/audible.jpg" });
    expect(audible.find).toHaveBeenCalledOnce();
    expect(google.find).not.toHaveBeenCalled();
    expect(book?.author).toBe("Unknown Author");
  });

  it("falls back to Google when Audible fails or has no match", async () => {
    const dataDir = path.join(os.tmpdir(), `story-stack-metadata-${crypto.randomUUID()}`);
    const database = new StoryStackDatabase(path.join(dataDir, "story-stack.sqlite"));
    database.upsertBook({
      id: "fallback_book",
      sourcePath: "/books/fallback-book",
      title: "Fallback Book",
      author: "Unknown Author",
      genres: [],
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });
    const audible = { find: vi.fn(async () => { throw new Error("Audible unavailable"); }) };
    const google = { find: vi.fn(async () => ({ title: "Fallback Book", provider: "Google Books" })) };
    const service = new MetadataEnrichmentService(database, { dataDir, fetcher: vi.fn(), providers: [audible, google] });

    const result = await service.findBook("fallback_book");

    expect(result).toMatchObject({ matched: true, provider: "Google Books" });
    expect(google.find).toHaveBeenCalledOnce();
  });
});
