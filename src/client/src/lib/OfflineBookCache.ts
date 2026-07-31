import type { Book } from "../types";

const CACHE_NAME = "story-stack-offline-books-v1";
const BOOK_METADATA_KEY = "story-stack-offline-book-metadata-v1";

export class OfflineBookCache {
  isSupported(): boolean {
    return typeof window !== "undefined" && typeof window.caches !== "undefined" && typeof URL.createObjectURL === "function";
  }

  async save(book: Book): Promise<void> {
    this.assertSupported();
    const cache = await caches.open(CACHE_NAME);
    await this.cacheUrl(cache, this.audioUrl(book.id));
    if (book.coverPath) {
      await this.cacheUrl(cache, this.coverUrl(book.id));
    }
    this.saveBookMetadata(book);
  }

  async has(bookId: string): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }
    const cache = await caches.open(CACHE_NAME);
    return Boolean(await cache.match(this.audioUrl(bookId)));
  }

  async listBookIds(): Promise<string[]> {
    if (!this.isSupported()) {
      return [];
    }
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    return requests
      .map((request) => new URL(request.url, window.location.origin).pathname.match(/^\/media\/books\/([^/]+)\/audio$/)?.[1])
      .filter((bookId): bookId is string => Boolean(bookId))
      .map((bookId) => decodeURIComponent(bookId));
  }

  async listBooks(): Promise<Book[]> {
    if (!this.isSupported()) {
      return [];
    }
    const cachedIds = new Set(await this.listBookIds());
    return this.readBookMetadata().filter((book) => cachedIds.has(book.id));
  }

  async remove(book: Book): Promise<void> {
    if (!this.isSupported()) {
      return;
    }
    const cache = await caches.open(CACHE_NAME);
    await Promise.all([cache.delete(this.audioUrl(book.id)), cache.delete(this.coverUrl(book.id))]);
    this.removeBookMetadata(book.id);
  }

  async audioSource(bookId: string): Promise<CachedAudioSource> {
    if (!this.isSupported()) {
      return { url: this.audioUrl(bookId) };
    }
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(this.audioUrl(bookId));
    if (!response) {
      return { url: this.audioUrl(bookId) };
    }
    const url = URL.createObjectURL(await response.blob());
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }

  private async cacheUrl(cache: Cache, url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Download failed.");
    }
    await cache.put(url, response);
  }

  private audioUrl(bookId: string): string {
    return `/media/books/${encodeURIComponent(bookId)}/audio`;
  }

  private coverUrl(bookId: string): string {
    return `/media/books/${encodeURIComponent(bookId)}/cover`;
  }

  private assertSupported(): void {
    if (!this.isSupported()) {
      throw new Error("Offline downloads are not available in this browser.");
    }
  }

  private saveBookMetadata(book: Book): void {
    const books = this.readBookMetadata();
    const nextBooks = [book, ...books.filter((cachedBook) => cachedBook.id !== book.id)];
    window.localStorage.setItem(BOOK_METADATA_KEY, JSON.stringify(nextBooks));
  }

  private removeBookMetadata(bookId: string): void {
    const books = this.readBookMetadata().filter((book) => book.id !== bookId);
    window.localStorage.setItem(BOOK_METADATA_KEY, JSON.stringify(books));
  }

  private readBookMetadata(): Book[] {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(BOOK_METADATA_KEY) ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.filter(isBookMetadata) : [];
    } catch {
      return [];
    }
  }
}

function isBookMetadata(value: unknown): value is Book {
  if (!value || typeof value !== "object") {
    return false;
  }
  const book = value as Partial<Book>;
  return typeof book.id === "string" && typeof book.title === "string" && typeof book.author === "string";
}

export interface CachedAudioSource {
  url: string;
  revoke?: () => void;
}
