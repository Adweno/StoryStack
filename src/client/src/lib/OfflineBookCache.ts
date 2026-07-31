import type { Book } from "../types";

const CACHE_NAME = "story-stack-offline-books-v1";

export class OfflineBookCache {
  isSupported(): boolean {
    return typeof window !== "undefined" && "caches" in window && typeof URL.createObjectURL === "function";
  }

  async save(book: Book): Promise<void> {
    this.assertSupported();
    const cache = await caches.open(CACHE_NAME);
    await this.cacheUrl(cache, this.audioUrl(book.id));
    if (book.coverPath) {
      await this.cacheUrl(cache, this.coverUrl(book.id));
    }
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

  async remove(book: Book): Promise<void> {
    if (!this.isSupported()) {
      return;
    }
    const cache = await caches.open(CACHE_NAME);
    await Promise.all([cache.delete(this.audioUrl(book.id)), cache.delete(this.coverUrl(book.id))]);
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
}

export interface CachedAudioSource {
  url: string;
  revoke?: () => void;
}
