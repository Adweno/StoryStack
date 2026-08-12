import type { Book } from "../types";

export type BookSortKey = "title" | "author" | "addedAt" | "publicationYear" | "rating";
export type SortDirection = "asc" | "desc";

export interface BookSortOptions {
  key: BookSortKey;
  direction: SortDirection;
}

export const defaultBookSort: BookSortOptions = {
  key: "title",
  direction: "asc"
};

export function sortBooksForDisplay(books: Book[], options: BookSortOptions): Book[] {
  const direction = options.direction === "asc" ? 1 : -1;
  return [...books].sort((left, right) => compareBooks(left, right, options.key, direction));
}

function compareBooks(left: Book, right: Book, key: BookSortKey, direction: number): number {
  if (key === "title") {
    return compareText(left.title, right.title) * direction;
  }
  if (key === "author") {
    return compareText(left.author, right.author) * direction || compareText(left.title, right.title);
  }
  if (key === "addedAt") {
    return compareText(left.addedAt, right.addedAt) * direction || compareText(left.title, right.title);
  }
  if (key === "publicationYear") {
    return compareOptionalNumber(left.publicationYear, right.publicationYear, direction) || compareText(left.title, right.title);
  }
  return compareOptionalNumber(left.averageRating, right.averageRating, direction) || compareText(left.title, right.title);
}

function compareText(left: string | undefined, right: string | undefined): number {
  return (left ?? "").localeCompare(right ?? "", undefined, { numeric: true, sensitivity: "base" });
}

function compareOptionalNumber(left: number | undefined, right: number | undefined, direction: number): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return (left - right) * direction;
}
