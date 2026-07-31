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
});
