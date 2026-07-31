import type { Book } from "./types";

export class BookCatalog {
  constructor(private readonly books: Book[]) {}

  visible(): Book[] {
    return this.books.filter((book) => !book.hidden);
  }

  search(query: string): Book[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return this.visible();
    }

    return this.visible().filter((book) => {
      const searchable = [
        book.title,
        book.subtitle,
        book.author,
        book.narrator,
        book.series,
        book.description,
        ...book.genres
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalized);
    });
  }
}
