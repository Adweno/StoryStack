// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { CatalogScanner } from "../src/services/CatalogScanner";

describe("CatalogScanner", () => {
  it("imports audiobook folders without modifying source files", async () => {
    const root = path.join(tmpdir(), `story-stack-${crypto.randomUUID()}`);
    const bookFolder = path.join(root, "Author", "Sample Book");
    await mkdir(bookFolder, { recursive: true });
    await writeFile(path.join(bookFolder, "book.m4b"), "audio-placeholder");
    await writeFile(path.join(bookFolder, "cover.jpg"), "cover-placeholder");
    await writeFile(
      path.join(bookFolder, "metadata.json"),
      JSON.stringify({ title: "Sample Book", author: "A. Writer", narrator: "N. Voice", genres: ["Fantasy"] })
    );

    const scanner = new CatalogScanner();
    const books = await scanner.scan(root);

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      title: "Sample Book",
      author: "A. Writer",
      narrator: "N. Voice",
      genres: ["Fantasy"]
    });
    expect(books[0].audioPath).toBe(path.join(bookFolder, "book.m4b"));
    expect(books[0].coverPath).toBe(path.join(bookFolder, "cover.jpg"));
  });

  it("keeps scanning child book folders when the root has a loose audio file", async () => {
    const root = path.join(tmpdir(), `story-stack-${crypto.randomUUID()}`);
    const childBook = path.join(root, "Author", "Nested Book");
    await mkdir(childBook, { recursive: true });
    await writeFile(path.join(root, "loose.m4b"), "audio-placeholder");
    await writeFile(path.join(childBook, "nested.mp3"), "audio-placeholder");

    const scanner = new CatalogScanner();
    const books = await scanner.scan(root);

    expect(books).toHaveLength(2);
    expect(books.some((book) => book.title === "Nested Book")).toBe(true);
  });

  it("treats Disc folders as one parent book", async () => {
    const root = path.join(tmpdir(), `story-stack-${crypto.randomUUID()}`);
    const bookFolder = path.join(root, "Just Kids");
    await mkdir(path.join(bookFolder, "Disc 01"), { recursive: true });
    await mkdir(path.join(bookFolder, "Disc 02"), { recursive: true });
    await writeFile(path.join(bookFolder, "Disc 01", "track01.mp3"), "audio-placeholder");
    await writeFile(path.join(bookFolder, "Disc 02", "track02.mp3"), "audio-placeholder");

    const scanner = new CatalogScanner();
    const books = await scanner.scan(root);

    expect(books).toHaveLength(1);
    expect(books[0].title).toBe("Just Kids");
    expect(books[0].audioPath).toBe(path.join(bookFolder, "Disc 01", "track01.mp3"));
  });

  it("recognizes common audiobook audio extensions", async () => {
    const root = path.join(tmpdir(), `story-stack-${crypto.randomUUID()}`);
    const formats = ["Book AA", "Book AAX", "Book WMA", "Book WEBM"];
    await Promise.all(
      formats.map(async (folder, index) => {
        const bookFolder = path.join(root, folder);
        await mkdir(bookFolder, { recursive: true });
        const extension = [".aa", ".aax", ".wma", ".webm"][index];
        await writeFile(path.join(bookFolder, `audio${extension}`), "audio-placeholder");
      })
    );

    const scanner = new CatalogScanner();
    const books = await scanner.scan(root);

    expect(books).toHaveLength(4);
  });
});
