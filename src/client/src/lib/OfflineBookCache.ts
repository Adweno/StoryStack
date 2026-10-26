import { sha256 } from "@noble/hashes/sha256";
import type { Book, DownloadManifest, DownloadManifestTrack } from "../types";

const CACHE_NAME = "story-stack-offline-books-v1";
const BOOK_METADATA_KEY = "story-stack-offline-book-metadata-v1";
const VERIFIED_MANIFEST_KEY = "story-stack-offline-manifests-v1";
const MAX_DOWNLOAD_ATTEMPTS = 3;

export class OfflineBookCache {
  private readonly activeDownloads = new Map<string, AbortController>();

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof window.caches !== "undefined" && typeof URL.createObjectURL === "function";
  }

  async save(book: Book, options: OfflineBookSaveOptions = {}): Promise<void> {
    this.assertSupported();
    const manifest = options.manifest;
    if (!manifest || manifest.bookId !== book.id || manifest.tracks.length === 0) {
      throw new Error("A verified download manifest is required.");
    }
    const controller = new AbortController();
    this.activeDownloads.set(book.id, controller);
    const cache = await caches.open(CACHE_NAME);
    try {
      options.onProgress?.({ percent: 0, receivedBytes: 0 });
      for (let index = 0; index < manifest.tracks.length; index += 1) {
        const track = manifest.tracks[index];
        await this.cacheUrl(cache, track.url, track, (progress) => {
          options.onProgress?.({
            ...progress,
            percent: progress.percent === undefined ? undefined : Math.min(99, Math.round(((index + progress.percent / 100) / manifest.tracks.length) * 100))
          });
        }, controller.signal);
      }
      if (book.coverPath) await this.cacheUrl(cache, this.coverUrl(book.id), undefined, undefined, controller.signal);
      options.onProgress?.({ percent: 100 });
      this.saveBookMetadata(book);
      this.saveManifest(manifest);
    } catch (error) {
      await Promise.all([...new Set([...this.audioUrls(book), this.coverUrl(book.id)])].map((url) => cache.delete(url)));
      this.removeBookMetadata(book.id);
      this.removeManifest(book.id);
      throw error;
    } finally {
      this.activeDownloads.delete(book.id);
    }
  }

  cancel(bookId: string): void {
    this.activeDownloads.get(bookId)?.abort();
  }

  async has(bookId: string): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }
    const manifest = this.readManifest(bookId);
    if (!manifest) return false;
    const cache = await caches.open(CACHE_NAME);
    return (await Promise.all(manifest.tracks.map((track) => cache.match(track.url)))).every(Boolean);
  }

  async verify(book: Book): Promise<boolean> {
    if (!this.isSupported()) return false;
    const manifest = this.readManifest(book.id);
    if (!manifest) return false;
    const cache = await caches.open(CACHE_NAME);
    for (const track of manifest.tracks) {
      const response = await cache.match(track.url);
      if (!response) return false;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== track.bytes || toSha256(bytes) !== track.sha256) return false;
    }
    return !book.coverPath || Boolean(await cache.match(this.coverUrl(book.id)));
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
    const books = this.readBookMetadata();
    const verified = await Promise.all(books.map(async (book) => [book, await this.has(book.id)] as const));
    return verified.filter(([, isVerified]) => isVerified).map(([book]) => book);
  }

  async remove(book: Book): Promise<void> {
    if (!this.isSupported()) {
      return;
    }
    const cache = await caches.open(CACHE_NAME);
    await Promise.all([...new Set([...this.audioUrls(book), this.audioUrl(book.id), this.coverUrl(book.id)])].map((url) => cache.delete(url)));
    this.removeBookMetadata(book.id);
    this.removeManifest(book.id);
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

  private async cacheUrl(cache: Cache, url: string, expected: DownloadManifestTrack | undefined, onProgress?: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error("Download failed.");
        }
        const trackingResponse = response.clone();
        const [bytes] = await Promise.all([
          response.arrayBuffer(),
          this.trackDownloadProgress(trackingResponse, onProgress)
        ]);
        if (expected) {
          if (bytes.byteLength !== expected.bytes) {
            throw new Error("Downloaded audio size did not match the server manifest.");
          }
          const actualHash = toSha256(new Uint8Array(bytes));
          if (actualHash !== expected.sha256) {
            throw new Error("Downloaded audio failed integrity verification.");
          }
        }
        await cache.put(url, new Response(bytes, { headers: response.headers, status: response.status, statusText: response.statusText }));
        return;
      } catch (error) {
        if (signal?.aborted || attempt === MAX_DOWNLOAD_ATTEMPTS - 1) {
          throw error;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
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

  private saveManifest(manifest: DownloadManifest): void {
    const manifests = this.readManifests();
    manifests[manifest.bookId] = manifest;
    window.localStorage.setItem(VERIFIED_MANIFEST_KEY, JSON.stringify(manifests));
  }

  private removeManifest(bookId: string): void {
    const manifests = this.readManifests();
    delete manifests[bookId];
    window.localStorage.setItem(VERIFIED_MANIFEST_KEY, JSON.stringify(manifests));
  }

  private readManifest(bookId: string): DownloadManifest | undefined {
    return this.readManifests()[bookId];
  }

  private readManifests(): Record<string, DownloadManifest> {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(VERIFIED_MANIFEST_KEY) ?? "{}") as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, DownloadManifest> : {};
    } catch {
      return {};
    }
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

function toSha256(bytes: Uint8Array): string {
  return [...sha256(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
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
  manifest?: DownloadManifest;
  onProgress?: (progress: DownloadProgress) => void;
}
