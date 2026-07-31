import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBookCache } from "../src/client/src/lib/OfflineBookCache";
import type { Book } from "../src/client/src/types";

describe("OfflineBookCache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "caches");
  });

  it("saves audio and cover responses in browser cache storage", async () => {
    const cache = new FakeCache();
    Object.defineProperty(window, "caches", { configurable: true, value: { open: vi.fn(async () => cache) } });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:book-audio");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("data")));

    await new OfflineBookCache().save(bookFixture({ coverPath: "/covers/book.jpg" }));

    expect(cache.puts).toEqual(["/media/books/offline_book/audio", "/media/books/offline_book/cover"]);
  });

  it("returns a cached blob url for playback when audio is saved", async () => {
    const cache = new FakeCache();
    cache.responses.set("/media/books/offline_book/audio", new Response("audio"));
    Object.defineProperty(window, "caches", { configurable: true, value: { open: vi.fn(async () => cache) } });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:book-audio");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const source = await new OfflineBookCache().audioSource("offline_book");
    source.revoke?.();

    expect(source.url).toBe("blob:book-audio");
    expect(revoke).toHaveBeenCalledWith("blob:book-audio");
  });

  it("lists and removes downloaded books from cache storage", async () => {
    const cache = new FakeCache();
    cache.responses.set("/media/books/offline_book/audio", new Response("audio"));
    cache.responses.set("/media/books/offline_book/cover", new Response("cover"));
    Object.defineProperty(window, "caches", { configurable: true, value: { open: vi.fn(async () => cache) } });

    await expect(new OfflineBookCache().listBookIds()).resolves.toEqual(["offline_book"]);
    await new OfflineBookCache().remove(bookFixture({ coverPath: "/covers/book.jpg" }));

    expect(cache.deletes).toEqual(["/media/books/offline_book/audio", "/media/books/offline_book/cover"]);
  });
});

class FakeCache {
  readonly puts: string[] = [];
  readonly deletes: string[] = [];
  readonly responses = new Map<string, Response>();

  async put(url: string, response: Response): Promise<void> {
    this.puts.push(url);
    this.responses.set(url, response);
  }

  async match(url: string): Promise<Response | undefined> {
    return this.responses.get(url);
  }

  async keys(): Promise<Request[]> {
    return [...this.responses.keys()].map((url) => new Request(`http://story-stack.test${url}`, { method: "GET" }));
  }

  async delete(url: string): Promise<boolean> {
    this.deletes.push(url);
    return this.responses.delete(url);
  }
}

function bookFixture(overrides: Partial<Book> = {}): Book {
  return {
    id: "offline_book",
    title: "Offline Book",
    author: "A. Writer",
    addedAt: "2026-07-30T00:00:00.000Z",
    genres: [],
    hidden: false,
    ...overrides
  };
}
