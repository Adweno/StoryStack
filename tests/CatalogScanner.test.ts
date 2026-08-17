// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseFile } from "music-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogScanner } from "../src/services/CatalogScanner";

vi.mock("music-metadata", () => ({
  parseFile: vi.fn()
}));

describe("CatalogScanner", () => {
  beforeEach(() => {
    vi.mocked(parseFile).mockReset();
  });

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

  it("reads Audiobookshelf-style metadata saved beside the source audio", async () => {
    const root = path.join(tmpdir(), `story-stack-${crypto.randomUUID()}`);
    const bookFolder = path.join(root, "Author", "Source Metadata Book");
    await mkdir(bookFolder, { recursive: true });
    await writeFile(path.join(bookFolder, "book.m4b"), "audio-placeholder");
    await writeFile(path.join(bookFolder, "folder.jpg"), "cover-placeholder");
    await writeFile(
      path.join(bookFolder, "metadata.json"),
      JSON.stringify({
        title: "Source Metadata Book",
        authors: [{ name: "A. Writer" }],
        narrators: ["N. Voice"],
        series: [{ name: "A Series", sequence: "2" }],
        publishedYear: "2024",
        tags: ["Fantasy"],
        description: "Saved by the source metadata workflow."
      })
    );

    const [book] = await new CatalogScanner().scan(root);

    expect(book).toMatchObject({
      title: "Source Metadata Book",
      author: "A. Writer",
      narrator: "N. Voice",
      series: "A Series",
      seriesOrder: 2,
      publicationYear: 2024,
      genres: ["Fantasy"],
      description: "Saved by the source metadata workflow."
    });
  });

  it("uses embedded audio tags and duration when source metadata is absent", async () => {
    const root = path.join(tmpdir(), `story-stack-${crypto.randomUUID()}`);
    const bookFolder = path.join(root, "Embedded Author", "Embedded Book");
    const audioPath = path.join(bookFolder, "book.m4b");
    const coverCache = path.join(root, "story-stack-data", "embedded-covers");
    await mkdir(bookFolder, { recursive: true });
    await writeFile(audioPath, "audio-placeholder");
    await writeFile(path.join(bookFolder, "metadata.json"), JSON.stringify({ coverPath: "/audiobookshelf/metadata/cover.jpg" }));

    vi.mocked(parseFile).mockResolvedValue({
      common: {
        title: "Embedded Book",
        artist: ["Embedded Author"],
        genre: ["Mystery"],
        year: 2022,
        comment: ["Embedded description"],
        picture: [{ data: new Uint8Array([1, 2, 3]), format: "image/png" }]
      },
      format: { duration: 3600 }
    } as never);

    const [book] = await new CatalogScanner(undefined, undefined, coverCache).scan(root);

    expect(book).toMatchObject({
      title: "Embedded Book",
      author: "Embedded Author",
      genres: ["Mystery"],
      publicationYear: 2022,
      description: "Embedded description",
      durationSeconds: 3600,
      coverPath: path.join(coverCache, `${createHash("sha256").update(audioPath).digest("hex")}.png`)
    });
    expect(parseFile).toHaveBeenCalledWith(audioPath, { duration: true });
    await expect(readFile(book.coverPath as string)).resolves.toEqual(Buffer.from([1, 2, 3]));
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
    expect(books[0].audioTracks?.map((track) => track.path)).toEqual([
      path.join(bookFolder, "Disc 01", "track01.mp3"),
      path.join(bookFolder, "Disc 02", "track02.mp3")
    ]);
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
