import type { ApiClient } from "./ApiClient";

const QUEUE_KEY = "story-stack-offline-sync-queue-v1";

type SyncOperation =
  | { id: string; type: "progress"; bookId: string; positionSeconds: number; durationSeconds?: number }
  | { id: string; type: "bookmark-create"; bookId: string; positionSeconds: number; title?: string }
  | { id: string; type: "bookmark-delete"; bookId: string; bookmarkId: string };

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

  enqueueBookmarkCreate(bookId: string, positionSeconds: number, title?: string): void {
    this.append({ id: operationId(), type: "bookmark-create", bookId, positionSeconds, title });
  }

  enqueueBookmarkDelete(bookId: string, bookmarkId: string): void {
    this.append({ id: operationId(), type: "bookmark-delete", bookId, bookmarkId });
  }

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
        } else {
          await api.deleteBookBookmark(operation.bookId, operation.bookmarkId);
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
  return typeof operation.id === "string" && typeof operation.type === "string" && typeof operation.bookId === "string";
}
