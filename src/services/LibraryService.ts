import type { Book, PlaybackProgress, Shelf, ShelfBook, UserLibraryBook } from "../domain/types";
import { Clock } from "../domain/Clock";
import { IdFactory } from "../domain/IdFactory";

const DEFAULT_SHELF_NAME = "Favorites";
const MANAGED_SHELF_NAMES = new Set(["finished books", "books in progress"]);

export interface LibraryRepository {
  getBook(bookId: string): Promise<Book | undefined>;
  listLibraryBooks(userId: string): Promise<UserLibraryBook[]>;
  addLibraryBook(entry: UserLibraryBook): Promise<void>;
  removeLibraryBook(userId: string, bookId: string): Promise<void>;
  listShelves(userId: string): Promise<Shelf[]>;
  createShelf(shelf: Shelf): Promise<void>;
  deleteShelf(userId: string, shelfId: string): Promise<void>;
  addBookToShelf(entry: ShelfBook): Promise<void>;
  removeBookFromShelf(shelfId: string, bookId: string): Promise<void>;
  listShelfBooks(shelfId: string): Promise<ShelfBook[]>;
  upsertProgress(progress: PlaybackProgress): Promise<void>;
}

export class LibraryService {
  constructor(
    private readonly repository: LibraryRepository,
    private readonly clock = new Clock(),
    private readonly idFactory = new IdFactory()
  ) {}

  async addToLibrary(userId: string, bookId: string): Promise<UserLibraryBook> {
    const book = await this.repository.getBook(bookId);
    if (!book || book.hidden) {
      throw new Error("Book is not available in the Store.");
    }

    const existing = await this.repository.listLibraryBooks(userId);
    const found = existing.find((entry) => entry.bookId === bookId);
    if (found) {
      return found;
    }

    const entry = { userId, bookId, addedAt: this.clock.nowIso() };
    await this.repository.addLibraryBook(entry);
    return entry;
  }

  async removeFromLibrary(userId: string, bookId: string): Promise<void> {
    await this.repository.removeLibraryBook(userId, bookId);
  }

  async createShelf(userId: string, name: string): Promise<Shelf> {
    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error("Shelf name is required.");
    }
    if (MANAGED_SHELF_NAMES.has(cleanName.toLowerCase())) {
      throw new Error("This shelf is managed automatically.");
    }

    const existingShelf = (await this.repository.listShelves(userId)).find(
      (shelf) => shelf.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existingShelf) {
      return existingShelf;
    }

    const shelf = {
      id: this.idFactory.random("shelf"),
      userId,
      name: cleanName,
      createdAt: this.clock.nowIso()
    };
    await this.repository.createShelf(shelf);
    return shelf;
  }

  async deleteShelf(userId: string, shelfId: string): Promise<void> {
    const shelf = (await this.repository.listShelves(userId)).find((item) => item.id === shelfId);
    if (!shelf) {
      throw new Error("Shelf does not belong to this user.");
    }
    if (shelf.name.trim().toLowerCase() === DEFAULT_SHELF_NAME.toLowerCase()) {
      throw new Error("The Favorites shelf cannot be deleted.");
    }
    if (MANAGED_SHELF_NAMES.has(shelf.name.trim().toLowerCase())) {
      throw new Error("This shelf is managed automatically and cannot be deleted.");
    }
    await this.repository.deleteShelf(userId, shelfId);
  }

  async addBookToShelf(userId: string, shelfId: string, bookId: string): Promise<ShelfBook> {
    const libraryBooks = await this.repository.listLibraryBooks(userId);
    if (!libraryBooks.some((entry) => entry.bookId === bookId)) {
      await this.addToLibrary(userId, bookId);
    }

    const shelves = await this.repository.listShelves(userId);
    const shelf = shelves.find((item) => item.id === shelfId);
    if (!shelf) {
      throw new Error("Shelf does not belong to this user.");
    }
    if (MANAGED_SHELF_NAMES.has(shelf.name.trim().toLowerCase())) {
      throw new Error("This shelf is managed automatically.");
    }

    const shelfBooks = await this.repository.listShelfBooks(shelfId);
    const existing = shelfBooks.find((entry) => entry.bookId === bookId);
    if (existing) {
      return existing;
    }

    const entry = { shelfId, bookId, position: shelfBooks.length };
    await this.repository.addBookToShelf(entry);
    return entry;
  }

  async removeBookFromShelf(userId: string, shelfId: string, bookId: string): Promise<void> {
    const shelves = await this.repository.listShelves(userId);
    const shelf = shelves.find((item) => item.id === shelfId);
    if (!shelf) {
      throw new Error("Shelf does not belong to this user.");
    }
    if (MANAGED_SHELF_NAMES.has(shelf.name.trim().toLowerCase())) {
      throw new Error("This shelf is managed automatically.");
    }
    await this.repository.removeBookFromShelf(shelfId, bookId);
  }

  async updateProgress(
    userId: string,
    bookId: string,
    positionSeconds: number,
    durationSeconds?: number
  ): Promise<PlaybackProgress> {
    const status = this.getListeningStatus(positionSeconds, durationSeconds);
    const progress = {
      userId,
      bookId,
      positionSeconds: Math.max(0, positionSeconds),
      durationSeconds,
      status,
      updatedAt: this.clock.nowIso()
    };
    await this.repository.upsertProgress(progress);
    return progress;
  }

  private getListeningStatus(positionSeconds: number, durationSeconds?: number): PlaybackProgress["status"] {
    if (durationSeconds && durationSeconds > 0 && positionSeconds >= durationSeconds * 0.95) {
      return "finished";
    }
    return positionSeconds > 0 ? "in_progress" : "not_started";
  }
}
