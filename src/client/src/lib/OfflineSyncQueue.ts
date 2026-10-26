import type { ApiClient } from "./ApiClient";

const QUEUE_KEY = "story-stack-offline-sync-queue-v1";

type SyncOperation =
  | { id: string; type: "progress"; bookId: string; positionSeconds: number; durationSeconds?: number }
  | { id: string; type: "bookmark-create"; bookId: string; bookmarkId?: string; positionSeconds: number; title?: string }
  | { id: string; type: "bookmark-delete"; bookId: string; bookmarkId: string }
  | { id: string; type: "library-add" | "library-remove"; bookId: string }
  | { id: string; type: "shelf-add" | "shelf-remove"; shelfId: string; bookId: string };

export interface QueuedProgress {
  bookId: string;
  positionSeconds: number;
  durationSeconds?: number;
}

export class OfflineSyncQueue {
  enqueueProgress(bookId: string, positionSeconds: number, durationSeconds?: number): void {
    const operations = this.read();
    const next = operations.filter((operation) => !(operation.type === "progress" && operation.bookId === bookId));
    next.push({ id: operationId(), type: "progress", bookId, positionSeconds, durationSeconds });
    this.write(next);
  }

  enqueueBookmarkCreate(bookId: string, bookmarkId: string | number, positionSeconds: number | string, title?: string): void {
    const localBookmarkId = typeof bookmarkId === "string" ? bookmarkId : `offline-${operationId()}`;
    const position = typeof positionSeconds === "number" ? positionSeconds : Number(bookmarkId);
    const note = typeof positionSeconds === "string" ? positionSeconds : title;
    this.append({ id: operationId(), type: "bookmark-create", bookId, bookmarkId: localBookmarkId, positionSeconds: position, title: note });
  }

  enqueueBookmarkDelete(bookId: string, bookmarkId: string): void {
    this.removeBookmarkCreate(bookId, bookmarkId);
    this.append({ id: operationId(), type: "bookmark-delete", bookId, bookmarkId });
  }

  cancelBookmarkCreate(bookId: string, bookmarkId: string): void {
    this.removeBookmarkCreate(bookId, bookmarkId);
  }

  enqueueLibraryAdd(bookId: string): void { this.replaceLibraryOperation(bookId, "library-add"); }
  enqueueLibraryRemove(bookId: string): void { this.replaceLibraryOperation(bookId, "library-remove"); }
  enqueueShelfAdd(shelfId: string, bookId: string): void { this.replaceShelfOperation(shelfId, bookId, "shelf-add"); }
  enqueueShelfRemove(shelfId: string, bookId: string): void { this.replaceShelfOperation(shelfId, bookId, "shelf-remove"); }

  progressSnapshot(): QueuedProgress[] {
    return this.read()
      .filter((operation): operation is Extract<SyncOperation, { type: "progress" }> => operation.type === "progress")
      .map(({ bookId, positionSeconds, durationSeconds }) => ({ bookId, positionSeconds, durationSeconds }));
  }

  async flush(api: ApiClient): Promise<void> {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const operations = this.read();
    for (const operation of operations) {
      try {
        if (operation.type === "progress") {
          await api.saveProgress(operation.bookId, operation.positionSeconds, operation.durationSeconds);
        } else if (operation.type === "bookmark-create") {
          await api.createBookBookmark(operation.bookId, { positionSeconds: operation.positionSeconds, title: operation.title });
        } else if (operation.type === "bookmark-delete") {
          await api.deleteBookBookmark(operation.bookId, operation.bookmarkId);
        } else if (operation.type === "library-add") {
          await api.addToLibrary(operation.bookId);
        } else if (operation.type === "library-remove") {
          await api.removeFromLibrary(operation.bookId);
        } else if (operation.type === "shelf-add") {
          await api.addBookToShelf(operation.shelfId, operation.bookId);
        } else if (operation.type === "shelf-remove") {
          await api.removeBookFromShelf(operation.shelfId, operation.bookId);
        }
        this.remove(operation.id);
      } catch {
        // Keep the operation for the next online retry.
        break;
      }
    }
  }

  size(): number {
    return this.read().length;
  }

  private append(operation: SyncOperation): void {
    this.write([...this.read(), operation]);
  }

  private remove(id: string): void {
    this.write(this.read().filter((operation) => operation.id !== id));
  }

  private removeBookmarkCreate(bookId: string, bookmarkId: string): void {
    this.write(this.read().filter((operation) => !(operation.type === "bookmark-create" && operation.bookId === bookId && operation.bookmarkId === bookmarkId)));
  }

  private replaceLibraryOperation(bookId: string, type: "library-add" | "library-remove"): void {
    this.write([...this.read().filter((operation) => !(operation.bookId === bookId && (operation.type === "library-add" || operation.type === "library-remove"))), { id: operationId(), type, bookId }]);
  }

  private replaceShelfOperation(shelfId: string, bookId: string, type: "shelf-add" | "shelf-remove"): void {
    this.write([...this.read().filter((operation) => {
      if (operation.type !== "shelf-add" && operation.type !== "shelf-remove") return true;
      return !(operation.shelfId === shelfId && operation.bookId === bookId);
    }), { id: operationId(), type, shelfId, bookId }]);
  }

  private read(): SyncOperation[] {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.filter(isSyncOperation) : [];
    } catch {
      return [];
    }
  }

  private write(operations: SyncOperation[]): void {
    if (typeof window !== "undefined") window.localStorage.setItem(QUEUE_KEY, JSON.stringify(operations));
  }
}

function operationId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isSyncOperation(value: unknown): value is SyncOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Partial<SyncOperation>;
  return typeof operation.id === "string" && typeof operation.type === "string" && typeof operation.bookId === "string" &&
    (operation.type !== "bookmark-create" || typeof operation.positionSeconds === "number") &&
    (operation.type !== "bookmark-delete" || typeof operation.bookmarkId === "string") &&
    (!("shelfId" in operation) || typeof operation.shelfId === "string");
}
