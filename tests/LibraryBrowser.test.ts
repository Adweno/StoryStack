import { describe, expect, it } from "vitest";
import { BookBrowser } from "../src/client/src/lib/BookBrowser";
import type { Book } from "../src/client/src/types";

const books: Book[] = [
  book({ id: "1", title: "The Ember Gate", author: "N. K. Vale", series: "Ash Road", genres: ["Fantasy"] }),
  book({ id: "2", title: "Blue Harbor", author: "Mira Chen", series: "Harbor Lights", genres: ["Mystery", "Cozy"] }),
  book({ id: "3", title: "A Quiet Machine", author: "N. K. Vale", genres: ["Science Fiction"] }),
  book({ id: "4", title: "1979", author: "Mira Chen, Sol Reyes", genres: [] })
];

describe("BookBrowser", () => {
  it("groups a user's library alphabetically by title", () => {
    const groups = new BookBrowser(books).browse("title");

    expect(groups.map((group) => group.label)).toEqual(["#", "A", "B", "T"]);
    expect(groups.find((group) => group.label === "A")?.books[0].title).toBe("A Quiet Machine");
  });

  it("groups by series and keeps standalone books discoverable", () => {
    const groups = new BookBrowser(books).browse("series");

    expect(groups.map((group) => group.label)).toEqual(["Ash Road", "Harbor Lights", "Standalone"]);
    expect(groups.find((group) => group.label === "Standalone")?.books).toHaveLength(2);
  });

  it("orders books inside a series by release year", () => {
    const groups = new BookBrowser([
      book({ id: "late", title: "Book Two", author: "Author", series: "Release Order", publicationYear: 2022, seriesOrder: 2 }),
      book({ id: "missing", title: "Undated", author: "Author", series: "Release Order" }),
      book({ id: "early", title: "Book One", author: "Author", series: "Release Order", publicationYear: 2018, seriesOrder: 1 })
    ]).browse("series");

    expect(groups.find((group) => group.label === "Release Order")?.books.map((book) => book.id)).toEqual(["early", "late", "missing"]);
  });

  it("can hide standalone books from Store series browsing", () => {
    const groups = new BookBrowser(books, { includeStandaloneSeries: false }).browse("series");

    expect(groups.map((group) => group.label)).toEqual(["Ash Road", "Harbor Lights"]);
  });

  it("groups books by each listed author and genre", () => {
    const authorGroups = new BookBrowser(books).browse("author");
    const genreGroups = new BookBrowser(books).browse("genre");

    expect(authorGroups.find((group) => group.label === "Mira Chen")?.books).toHaveLength(2);
    expect(authorGroups.find((group) => group.label === "Sol Reyes")?.books).toHaveLength(1);
    expect(genreGroups.find((group) => group.label === "Untagged")?.books[0].title).toBe("1979");
  });

  it("filters grouped library results by title, author, series, narrator, and genre", () => {
    const groups = new BookBrowser(books).browse("genre", "harbor");

    expect(groups).toHaveLength(2);
    expect(groups.flatMap((group) => group.books).every((result) => result.title === "Blue Harbor")).toBe(true);
  });
});

function book(overrides: Partial<Book>): Book {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "Untitled",
    author: overrides.author ?? "Unknown Author",
    genres: overrides.genres ?? [],
    addedAt: "2026-07-30T00:00:00.000Z",
    hidden: false,
    ...overrides
  };
}
