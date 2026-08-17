import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineSyncQueue } from "../src/client/src/lib/OfflineSyncQueue";
import type { ApiClient } from "../src/client/src/lib/ApiClient";

describe("OfflineSyncQueue", () => {
  afterEach(() => window.localStorage.clear());

  it("coalesces progress and flushes queued writes", async () => {
    const queue = new OfflineSyncQueue();
    queue.enqueueProgress("book-1", 10, 100);
    queue.enqueueProgress("book-1", 25, 100);
    const api = { saveProgress: vi.fn(async () => undefined), createBookBookmark: vi.fn(), deleteBookBookmark: vi.fn() } as unknown as ApiClient;

    await queue.flush(api);

    expect(api.saveProgress).toHaveBeenCalledOnce();
    expect(api.saveProgress).toHaveBeenCalledWith("book-1", 25, 100);
    expect(queue.size()).toBe(0);
  });

  it("keeps writes queued when the server is unavailable", async () => {
    const queue = new OfflineSyncQueue();
    queue.enqueueBookmarkCreate("book-1", 42, "A note");
    const api = { saveProgress: vi.fn(), createBookBookmark: vi.fn(async () => { throw new Error("offline"); }), deleteBookBookmark: vi.fn() } as unknown as ApiClient;

    await queue.flush(api);

    expect(queue.size()).toBe(1);
  });

  it("exposes the latest queued progress for offline playback", () => {
    const queue = new OfflineSyncQueue();
    queue.enqueueProgress("book-1", 10, 100);
    queue.enqueueProgress("book-1", 25, 100);

    expect(queue.progressSnapshot()).toEqual([{ bookId: "book-1", positionSeconds: 25, durationSeconds: 100 }]);
  });
});
