import { describe, expect, it } from "vitest";
import { LibraryAddPlanner } from "../src/client/src/lib/LibraryAddPlanner";
import type { Book } from "../src/client/src/types";

describe("LibraryAddPlanner", () => {
  it("returns only group books that are not already in the user's library", () => {
    const planner = new LibraryAddPlanner(new Set(["saved_by_id"]));
    const books = [
      book({ id: "saved_by_id", title: "Saved by Id" }),
      book({ id: "saved_by_flag", title: "Saved by Flag", inLibrary: true }),
      book({ id: "missing", title: "Missing" })
    ];

    expect(planner.missingBooks(books).map((item) => item.id)).toEqual(["missing"]);
    expect(planner.missingCount(books)).toBe(1);
  });
});

function book(overrides: Partial<Book>): Book {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "Sample",
    author: "A. Writer",
    genres: [],
    addedAt: "2026-07-30T00:00:00.000Z",
    hidden: false,
    inLibrary: overrides.inLibrary
  };
}
