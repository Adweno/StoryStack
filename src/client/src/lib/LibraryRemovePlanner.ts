import type { Book } from "../types";

export class LibraryRemovePlanner {
  removableBooks(books: Book[]): Book[] {
    return [...books];
  }

  removableCount(books: Book[]): number {
    return this.removableBooks(books).length;
  }
}
