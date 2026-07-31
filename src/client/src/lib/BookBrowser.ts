import type { Book } from "../types";

export type BookBrowseMode = "title" | "series" | "author" | "genre";

export interface BookBrowseGroup {
  key: string;
  label: string;
  books: Book[];
}

export interface BookBrowserOptions {
  includeStandaloneSeries?: boolean;
}

export class BookBrowser {
  constructor(
    private readonly books: Book[],
    private readonly options: BookBrowserOptions = {}
  ) {}

  browse(mode: BookBrowseMode, query = ""): BookBrowseGroup[] {
    const filteredBooks = this.filterBooks(query);

    if (mode === "title") {
      return this.groupByTitle(filteredBooks);
    }

    return this.groupByValue(filteredBooks, (book) => this.valuesForMode(book, mode));
  }

  private filterBooks(query: string): Book[] {
    const normalized = query.trim().toLowerCase();
    const sortedBooks = [...this.books].sort((left, right) => left.title.localeCompare(right.title));
    if (!normalized) {
      return sortedBooks;
    }

    return sortedBooks.filter((book) => {
      const haystack = [
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
      return haystack.includes(normalized);
    });
  }

  private groupByTitle(books: Book[]): BookBrowseGroup[] {
    return this.groupByValue(books, (book) => [this.titleBucket(book.title)]);
  }

  private groupByValue(books: Book[], getValues: (book: Book) => string[]): BookBrowseGroup[] {
    const groups = new Map<string, Book[]>();

    for (const book of books) {
      const values = getValues(book);
      for (const value of values) {
        const label = value.trim() || "Unknown";
        const groupBooks = groups.get(label) ?? [];
        groupBooks.push(book);
        groups.set(label, groupBooks);
      }
    }

    return [...groups.entries()]
      .map(([label, groupBooks]) => ({
        key: label.toLowerCase(),
        label,
        books: groupBooks.sort((left, right) => left.title.localeCompare(right.title))
      }))
      .sort((left, right) => this.sortLabels(left.label, right.label));
  }

  private valuesForMode(book: Book, mode: Exclude<BookBrowseMode, "title">): string[] {
    if (mode === "series") {
      if (book.series) {
        return [book.series];
      }
      return this.options.includeStandaloneSeries === false ? [] : ["Standalone"];
    }
    if (mode === "author") {
      return this.splitList(book.author || "Unknown Author");
    }
    return book.genres.length ? book.genres : ["Untagged"];
  }

  private splitList(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private titleBucket(title: string): string {
    const first = title.trim().charAt(0).toUpperCase();
    if (!first) {
      return "#";
    }
    return /[A-Z]/.test(first) ? first : "#";
  }

  private sortLabels(left: string, right: string): number {
    if (left === "#") {
      return -1;
    }
    if (right === "#") {
      return 1;
    }
    if (left === "Standalone") {
      return 1;
    }
    if (right === "Standalone") {
      return -1;
    }
    if (left === "Untagged") {
      return 1;
    }
    if (right === "Untagged") {
      return -1;
    }
    return left.localeCompare(right);
  }
}
