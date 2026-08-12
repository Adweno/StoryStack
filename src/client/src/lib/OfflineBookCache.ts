import type { Book } from "../types";

const CACHE_NAME = "story-stack-offline-books-v1";
const BOOK_METADATA_KEY = "story-stack-offline-book-metadata-v1";

export class OfflineBookCache {
  isSupported(): boolean {
    return typeof window !== "undefined" && typeof window.caches !== "undefined" && typeof URL.createObjectURL === "function";
  }

  async save(book: Book, options: OfflineBookSaveOptions = {}): Promise<void> {
    this.assertSupported();
    const cache = await caches.open(CACHE_NAME);
    options.onProgress?.({ percent: 0, receivedBytes: 0 });
    const audioUrls = this.audioUrls(book);
    for (let index = 0; index < audioUrls.length; index += 1) {
      await this.cacheUrl(cache, audioUrls[index], (progress) => {
        options.onProgress?.({
          ...progress,
          percent: progress.percent === undefined ? undefined : Math.min(99, Math.round(((index + progress.percent / 100) / audioUrls.length) * 100))
        });
      });
    }
    if (book.coverPath) {
      await this.cacheUrl(cache, this.coverUrl(book.id));
    }
    options.onProgress?.({ percent: 100 });
    this.saveBookMetadata(book);
  }

  async has(bookId: string): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }
    const cache = await caches.open(CACHE_NAME);
    return Boolean(await cache.match(this.audioUrl(bookId)) ?? (await cache.match(this.audioTrackUrl(bookId, 0))));
  }

  async listBookIds(): Promise<string[]> {
    if (!this.isSupported()) {
      return [];
    }
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    return requests
      .map((request) => new URL(request.url, window.location.origin).pathname.match(/^\/media\/books\/([^/]+)\/audio(?:\/0)?$/)?.[1])
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
    await Promise.all([...new Set([...this.audioUrls(book), this.audioUrl(book.id), this.coverUrl(book.id)])].map((url) => cache.delete(url)));
    this.removeBookMetadata(book.id);
  }

  async audioSources(book: Book, options: { sample?: boolean } = {}): Promise<CachedAudioSource[]> {
    if (!this.isSupported()) {
      return this.audioUrls(book, options.sample).map((url) => ({ url }));
    }
    const cache = await caches.open(CACHE_NAME);
    return Promise.all(
      this.audioUrls(book, options.sample).map(async (sourceUrl) => {
        const response = await cache.match(sourceUrl);
        if (!response) {
          return { url: sourceUrl };
        }
        const url = URL.createObjectURL(await response.blob());
        return { url, revoke: () => URL.revokeObjectURL(url) };
      })
    );
  }

  async audioSource(bookId: string): Promise<CachedAudioSource> {
    const sources = await this.audioSources({ id: bookId, title: "", author: "", genres: [], addedAt: "", hidden: false });
    return sources[0];
  }

  private async cacheUrl(cache: Cache, url: string, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Download failed.");
    }
    const trackingResponse = response.clone();
    await Promise.all([cache.put(url, response), this.trackDownloadProgress(trackingResponse, onProgress)]);
  }

  private async trackDownloadProgress(response: Response, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    if (!onProgress || !response.body) {
      return;
    }
    const totalBytes = Number(response.headers.get("content-length") ?? 0) || undefined;
    const reader = response.body.getReader();
    let receivedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      receivedBytes += value.byteLength;
      onProgress({
        percent: totalBytes ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : undefined,
        receivedBytes,
        totalBytes
      });
    }
  }

  private audioUrl(bookId: string, sample = false): string {
    return `/media/books/${encodeURIComponent(bookId)}/audio${sample ? "?sample=1" : ""}`;
  }

  private audioTrackUrl(bookId: string, trackIndex: number, sample = false): string {
    return `/media/books/${encodeURIComponent(bookId)}/audio/${trackIndex}${sample ? "?sample=1" : ""}`;
  }

  private audioUrls(book: Book, sample = false): string[] {
    if (book.audioTracks && book.audioTracks.length > 1) {
      return book.audioTracks.map((_track, index) => this.audioTrackUrl(book.id, index, sample));
    }
    return [this.audioUrl(book.id, sample)];
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

export interface DownloadProgress {
  percent?: number;
  receivedBytes?: number;
  totalBytes?: number;
}

export interface OfflineBookSaveOptions {
  onProgress?: (progress: DownloadProgress) => void;
}
