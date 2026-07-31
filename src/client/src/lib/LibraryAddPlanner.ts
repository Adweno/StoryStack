import type { Book } from "../types";

export class LibraryAddPlanner {
  constructor(private readonly inLibraryIds: Set<string>) {}

  missingBooks(books: Book[]): Book[] {
    return books.filter((book) => !this.inLibraryIds.has(book.id) && !book.inLibrary);
  }

  missingCount(books: Book[]): number {
    return this.missingBooks(books).length;
  }
}
