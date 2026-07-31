import { describe, expect, it } from "vitest";
import { LibraryRemovePlanner } from "../src/client/src/lib/LibraryRemovePlanner";
import type { Book } from "../src/client/src/types";

describe("LibraryRemovePlanner", () => {
  it("marks every book in a selected library group as removable", () => {
    const books = [book({ id: "one" }), book({ id: "two" })];
    const planner = new LibraryRemovePlanner();

    expect(planner.removableBooks(books).map((item) => item.id)).toEqual(["one", "two"]);
    expect(planner.removableCount(books)).toBe(2);
  });
});

function book(overrides: Partial<Book>): Book {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "Sample",
    author: "A. Writer",
    genres: [],
    addedAt: "2026-07-30T00:00:00.000Z",
    hidden: false
  };
}
