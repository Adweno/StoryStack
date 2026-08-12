import { describe, expect, it } from "vitest";
import { sortBooksForDisplay } from "../src/client/src/lib/BookSorter";
import type { Book } from "../src/client/src/types";

describe("sortBooksForDisplay", () => {
  it("sorts by title in either direction", () => {
    const books = [book({ title: "Beta" }), book({ title: "Alpha" })];

    expect(sortBooksForDisplay(books, { key: "title", direction: "asc" }).map((item) => item.title)).toEqual(["Alpha", "Beta"]);
    expect(sortBooksForDisplay(books, { key: "title", direction: "desc" }).map((item) => item.title)).toEqual(["Beta", "Alpha"]);
  });

  it("sorts missing years and ratings last before direction is applied", () => {
    const books = [
      book({ title: "Missing" }),
      book({ title: "High", averageRating: 5, publicationYear: 2020 }),
      book({ title: "Low", averageRating: 3, publicationYear: 2010 })
    ];

    expect(sortBooksForDisplay(books, { key: "publicationYear", direction: "asc" }).map((item) => item.title)).toEqual([
      "Low",
      "High",
      "Missing"
    ]);
    expect(sortBooksForDisplay(books, { key: "rating", direction: "desc" }).map((item) => item.title)).toEqual(["High", "Low", "Missing"]);
  });
});

function book(overrides: Partial<Book>): Book {
  return {
    id: overrides.title ?? "book",
    title: "Book",
    author: "Author",
    genres: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    hidden: false,
    ...overrides
  };
}
