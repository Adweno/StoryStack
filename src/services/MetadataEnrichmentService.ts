import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Book, MetadataEnrichmentOutcome, MetadataEnrichmentResult } from "../domain/types";
import type { BookMetadataPatch, StoryStackDatabase } from "../storage/StoryStackDatabase";
import { cleanMetadataDescription, type ExternalMetadataProvider, type MetadataCandidate } from "./ExternalMetadataProvider";
import { AudibleMetadataProvider } from "./AudibleMetadataProvider";
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
    const candidate = await this.findCandidate(book);
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

  async findBook(bookId: string): Promise<{ matched: boolean; provider?: string; sourceUrl?: string; candidate?: MetadataCandidate }> {
    const book = await this.database.getBook(bookId);
    if (!book) throw new Error("Book was not found.");
    const candidate = await this.findCandidate(book);
    return candidate
      ? { matched: true, provider: candidate.provider, sourceUrl: candidate.sourceUrl, candidate }
      : { matched: false };
  }

  async applyCandidate(bookId: string, candidate: MetadataCandidate): Promise<Book> {
    const book = await this.database.getBook(bookId);
    if (!book) throw new Error("Book was not found.");
    const patch = await this.candidateToPatch(book, candidate);
    this.database.updateBookMetadata(book.id, patch);
    return (await this.database.getBook(book.id)) ?? book;
  }

  async applyMetadataPatch(bookId: string, patch: MetadataCandidate): Promise<Book> {
    return this.applyCandidate(bookId, patch);
  }

  private async findCandidate(book: Book): Promise<MetadataCandidate | undefined> {
    let lastError: unknown;
    const providers = this.options.providers ?? (this.options.provider ? [this.options.provider] : []);
    for (const provider of providers) {
      try {
        const candidate = await provider.find(book);
        if (candidate) return { ...candidate, provider: candidate.provider ?? provider.constructor.name.replace("MetadataProvider", "") };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError && providers.length === 1) throw lastError;
    return undefined;
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
    const patch = await this.candidateToPatch(book, candidate, true);
    return patch;
  }

  private async candidateToPatch(book: Book, candidate: MetadataCandidate, onlyMissing = false): Promise<BookMetadataPatch> {
    const patch: BookMetadataPatch = {};
    if (!onlyMissing || isBlank(book.title)) {
      if (candidate.title) patch.title = candidate.title;
    }
    if (!book.coverPath || !existsSync(book.coverPath)) {
      const coverPath = await this.saveCover(book, candidate.coverUrl);
      if (coverPath) {
        patch.coverPath = coverPath;
      }
    }
    if ((!onlyMissing || isBlank(book.subtitle)) && candidate.subtitle) {
      patch.subtitle = candidate.subtitle;
    }
    if ((!onlyMissing || isMissingAuthor(book.author)) && candidate.author) {
      patch.author = candidate.author;
    }
    if ((!onlyMissing || isBlank(book.narrator)) && candidate.narrator) {
      patch.narrator = candidate.narrator;
    }
    const description = cleanMetadataDescription(candidate.description);
    if ((!onlyMissing || isBlank(book.description)) && description) {
      patch.description = description;
    }
    if ((!onlyMissing || book.genres.length === 0) && candidate.genres?.length) {
      patch.genres = candidate.genres;
    }
    if ((!onlyMissing || !book.publicationYear) && candidate.publicationYear) {
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
  const audible = new AudibleMetadataProvider(dynamicFetch);
  const google = new GoogleBooksMetadataProvider(dynamicFetch);
  return new MetadataEnrichmentService(database, { dataDir, fetcher: dynamicFetch, providers: [audible, google] });
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
  providers?: ExternalMetadataProvider[];
  provider?: ExternalMetadataProvider;
}
