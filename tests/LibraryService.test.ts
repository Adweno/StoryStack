import { describe, expect, it } from "vitest";
import type { Book, PlaybackProgress, Shelf, ShelfBook, UserLibraryBook } from "../src/domain/types";
import { LibraryRepository, LibraryService } from "../src/services/LibraryService";

class MemoryLibraryRepository implements LibraryRepository {
  books = new Map<string, Book>();
  libraryBooks: UserLibraryBook[] = [];
  shelves: Shelf[] = [];
  shelfBooks: ShelfBook[] = [];
  progress: PlaybackProgress[] = [];

  async getBook(bookId: string): Promise<Book | undefined> {
    return this.books.get(bookId);
  }

  async listLibraryBooks(userId: string): Promise<UserLibraryBook[]> {
    return this.libraryBooks.filter((entry) => entry.userId === userId);
  }

  async addLibraryBook(entry: UserLibraryBook): Promise<void> {
    this.libraryBooks.push(entry);
  }

  async removeLibraryBook(userId: string, bookId: string): Promise<void> {
    this.libraryBooks = this.libraryBooks.filter((entry) => entry.userId !== userId || entry.bookId !== bookId);
    const userShelves = this.shelves.filter((shelf) => shelf.userId === userId).map((shelf) => shelf.id);
    this.shelfBooks = this.shelfBooks.filter((entry) => entry.bookId !== bookId || !userShelves.includes(entry.shelfId));
  }

  async listShelves(userId: string): Promise<Shelf[]> {
    return this.shelves.filter((shelf) => shelf.userId === userId);
  }

  async createShelf(shelf: Shelf): Promise<void> {
    this.shelves.push(shelf);
  }

  async deleteShelf(userId: string, shelfId: string): Promise<void> {
    this.shelves = this.shelves.filter((shelf) => shelf.userId !== userId || shelf.id !== shelfId);
    this.shelfBooks = this.shelfBooks.filter((entry) => entry.shelfId !== shelfId);
  }

  async addBookToShelf(entry: ShelfBook): Promise<void> {
    this.shelfBooks.push(entry);
  }

  async removeBookFromShelf(shelfId: string, bookId: string): Promise<void> {
    this.shelfBooks = this.shelfBooks.filter((entry) => entry.shelfId !== shelfId || entry.bookId !== bookId);
  }

  async listShelfBooks(shelfId: string): Promise<ShelfBook[]> {
    return this.shelfBooks.filter((entry) => entry.shelfId === shelfId);
  }

  async upsertProgress(progress: PlaybackProgress): Promise<void> {
    this.progress = this.progress.filter((entry) => entry.userId !== progress.userId || entry.bookId !== progress.bookId);
    this.progress.push(progress);
  }
}

const sampleBook: Book = {
  id: "book_1",
  sourcePath: "/library/book-one",
  title: "Book One",
  author: "A. Writer",
  genres: ["Fantasy"],
  addedAt: "2026-07-30T00:00:00.000Z",
  hidden: false
};

describe("LibraryService", () => {
  it("adds a Store book to a user's library only once", async () => {
    const repository = new MemoryLibraryRepository();
    repository.books.set(sampleBook.id, sampleBook);
    const service = new LibraryService(repository);

    await service.addToLibrary("user_1", sampleBook.id);
    await service.addToLibrary("user_1", sampleBook.id);

    expect(repository.libraryBooks).toHaveLength(1);
    expect(repository.libraryBooks[0]).toMatchObject({ userId: "user_1", bookId: sampleBook.id });
  });

  it("keeps the Store book when a user removes it from My Library", async () => {
    const repository = new MemoryLibraryRepository();
    repository.books.set(sampleBook.id, sampleBook);
    const service = new LibraryService(repository);

    await service.addToLibrary("user_1", sampleBook.id);
    await service.removeFromLibrary("user_1", sampleBook.id);

    expect(repository.libraryBooks).toHaveLength(0);
    expect(repository.books.get(sampleBook.id)).toEqual(sampleBook);
  });

  it("lets one book belong to multiple shelves", async () => {
    const repository = new MemoryLibraryRepository();
    repository.books.set(sampleBook.id, sampleBook);
    const service = new LibraryService(repository);

    const favorites = await service.createShelf("user_1", "Favorites");
    const nextUp = await service.createShelf("user_1", "Next Up");
    await service.addBookToShelf("user_1", favorites.id, sampleBook.id);
    await service.addBookToShelf("user_1", nextUp.id, sampleBook.id);

    expect(repository.shelfBooks).toEqual([
      { shelfId: favorites.id, bookId: sampleBook.id, position: 0 },
      { shelfId: nextUp.id, bookId: sampleBook.id, position: 0 }
    ]);
    expect(repository.libraryBooks).toHaveLength(1);
  });

  it("marks progress as finished near the end of a book", async () => {
    const repository = new MemoryLibraryRepository();
    const service = new LibraryService(repository);

    const progress = await service.updateProgress("user_1", sampleBook.id, 571, 600);

    expect(progress.status).toBe("finished");
    expect(repository.progress[0].status).toBe("finished");
  });
});
