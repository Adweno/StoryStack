import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Book, MetadataEnrichmentOutcome, MetadataEnrichmentResult } from "../domain/types";
import type { BookMetadataPatch, StoryStackDatabase } from "../storage/StoryStackDatabase";
import type { ExternalMetadataProvider, MetadataCandidate } from "./ExternalMetadataProvider";
import { GoogleBooksMetadataProvider } from "./GoogleBooksMetadataProvider";

export class MetadataEnrichmentService {
  constructor(
    private readonly database: StoryStackDatabase,
    private readonly options: MetadataEnrichmentOptions
  ) {}

  async enrichMissing(): Promise<MetadataEnrichmentResult> {
    const books = this.database.listVisibleBooks().filter((book) => this.needsMetadata(book));
    const result: MetadataEnrichmentResult = {
      scanned: books.length,
      matched: 0,
      coversAdded: 0,
      detailsAdded: 0,
      errors: [],
      finishedAt: new Date().toISOString()
    };

    for (const book of books) {
      try {
        const outcome = await this.enrichBook(book.id);
        if (outcome.matched) {
          result.matched += 1;
        }
        if (outcome.coversAdded > 0) {
          result.coversAdded += 1;
        }
        if (outcome.detailsAdded > 0) {
          result.detailsAdded += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Metadata lookup failed.";
        result.errors.push(`${book.title}: ${message}`);
      }
    }

    return result;
  }

  async enrichBook(bookId: string): Promise<MetadataEnrichmentOutcome> {
    const book = await this.database.getBook(bookId);
    if (!book) {
      throw new Error("Book was not found.");
    }
    const candidate = await this.options.provider.find(book);
    if (!candidate) {
      return { matched: false, coversAdded: 0, detailsAdded: 0, book };
    }
    const patch = await this.createPatch(book, candidate);
    if (Object.keys(patch).length === 0) {
      return { matched: true, coversAdded: 0, detailsAdded: 0, book };
    }
    this.database.updateBookMetadata(book.id, patch);
    const updatedBook = await this.database.getBook(book.id);
    return {
      matched: true,
      coversAdded: patch.coverPath ? 1 : 0,
      detailsAdded: this.hasDetailPatch(patch) ? 1 : 0,
      book: updatedBook ?? book
    };
  }

  private needsMetadata(book: Book): boolean {
    return (
      !book.coverPath ||
      !existsSync(book.coverPath) ||
      isBlank(book.description) ||
      isBlank(book.subtitle) ||
      isMissingAuthor(book.author) ||
      book.genres.length === 0 ||
      !book.publicationYear
    );
  }

  private async createPatch(book: Book, candidate: MetadataCandidate): Promise<BookMetadataPatch> {
    const patch: BookMetadataPatch = {};
    if (!book.coverPath || !existsSync(book.coverPath)) {
      const coverPath = await this.saveCover(book, candidate.coverUrl);
      if (coverPath) {
        patch.coverPath = coverPath;
      }
    }
    if (isBlank(book.subtitle) && candidate.subtitle) {
      patch.subtitle = candidate.subtitle;
    }
    if (isMissingAuthor(book.author) && candidate.author) {
      patch.author = candidate.author;
    }
    if (isBlank(book.description) && candidate.description) {
      patch.description = candidate.description;
    }
    if (book.genres.length === 0 && candidate.genres?.length) {
      patch.genres = candidate.genres;
    }
    if (!book.publicationYear && candidate.publicationYear) {
      patch.publicationYear = candidate.publicationYear;
    }
    return patch;
  }

  private async saveCover(book: Book, coverUrl?: string): Promise<string | undefined> {
    if (!coverUrl) {
      return undefined;
    }
    const response = await this.options.fetcher(coverUrl);
    if (!response.ok) {
      return undefined;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const extension = contentType.includes("png") ? ".png" : ".jpg";
    const coverDir = path.join(this.options.dataDir, "covers");
    await mkdir(coverDir, { recursive: true });
    const coverPath = path.join(coverDir, `${safeFileName(book.id)}${extension}`);
    await writeFile(coverPath, Buffer.from(await response.arrayBuffer()));
    return coverPath;
  }

  private hasDetailPatch(patch: BookMetadataPatch): boolean {
    return Boolean(patch.subtitle ?? patch.author ?? patch.description ?? patch.genres ?? patch.publicationYear);
  }
}

export function createMetadataEnrichmentService(database: StoryStackDatabase, dataDir: string): MetadataEnrichmentService {
  const dynamicFetch: typeof fetch = (...args) => fetch(...args);
  const provider = new GoogleBooksMetadataProvider(dynamicFetch);
  return new MetadataEnrichmentService(database, { dataDir, fetcher: dynamicFetch, provider });
}

function isBlank(value?: string): boolean {
  return !value || value.trim().length === 0;
}

function isMissingAuthor(author: string): boolean {
  return author.trim().toLowerCase() === "unknown author" || author.trim().length === 0;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

interface MetadataEnrichmentOptions {
  dataDir: string;
  fetcher: typeof fetch;
  provider: ExternalMetadataProvider;
}
