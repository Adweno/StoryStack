// @vitest-environment node
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AudiobookshelfImporter } from "../src/services/AudiobookshelfImporter";

describe("AudiobookshelfImporter", () => {
  it("imports rich Audiobookshelf metadata without reading media folders", async () => {
    const folder = path.join(os.tmpdir(), `story-stack-abs-${crypto.randomUUID()}`);
    const databasePath = path.join(folder, "absdatabase.sqlite");
    await mkdir(folder, { recursive: true });
    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TABLE libraryItems (
        id TEXT PRIMARY KEY,
        path TEXT,
        relPath TEXT,
        mediaId TEXT,
        mediaType TEXT,
        isMissing INTEGER,
        isInvalid INTEGER,
        createdAt TEXT
      );
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT,
        subtitle TEXT,
        publishedYear TEXT,
        description TEXT,
        coverPath TEXT,
        duration REAL,
        narrators TEXT,
        audioFiles TEXT,
        tags TEXT,
        genres TEXT
      );
      CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE bookAuthors (id TEXT PRIMARY KEY, bookId TEXT, authorId TEXT);
      CREATE TABLE series (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE bookSeries (id TEXT PRIMARY KEY, bookId TEXT, seriesId TEXT, sequence TEXT);
    `);
    db.prepare("INSERT INTO libraryItems VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "item_1",
      "/audiobooks/Jamie/Book One",
      "Jamie/Book One",
      "book_1",
      "book",
      0,
      0,
      "2026-07-30T00:00:00.000Z"
    );
    db.prepare("INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "book_1",
      "Book One",
      "A Subtitle",
      "2024",
      "<p>A clean description.</p>",
      "/metadata/items/item_1/cover.jpg",
      1234,
      JSON.stringify(["A Narrator"]),
      JSON.stringify([
        {
          duration: 600,
          metadata: { path: "/audiobooks/Jamie/Book One/part01.mp3" },
          chapters: [{ id: 1, start: 0, end: 120, title: "Opening" }]
        },
        { duration: 634, metadata: { path: "/audiobooks/Jamie/Book One/part02.mp3" } }
      ]),
      JSON.stringify(["Featured"]),
      JSON.stringify(["Fantasy"])
    );
    db.prepare("INSERT INTO authors VALUES (?, ?)").run("author_1", "A. Writer");
    db.prepare("INSERT INTO bookAuthors VALUES (?, ?, ?)").run("ba_1", "book_1", "author_1");
    db.prepare("INSERT INTO series VALUES (?, ?)").run("series_1", "Stack Cycle");
    db.prepare("INSERT INTO bookSeries VALUES (?, ?, ?, ?)").run("bs_1", "book_1", "series_1", "2");
    db.close();

    const books = new AudiobookshelfImporter().importBooks({
      databasePath,
      libraryPathPrefix: "/audiobooks/Jamie",
      mediaPathPrefix: "/audiobooks",
      hostMediaPathPrefix: "/srv/media/audiobooks",
      metadataPathPrefix: "/metadata",
      hostMetadataPathPrefix: "/metadata"
    });

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id: "abs_item_1",
      sourcePath: "/srv/media/audiobooks/Jamie/Book One",
      title: "Book One",
      subtitle: "A Subtitle",
      author: "A. Writer",
      narrator: "A Narrator",
      series: "Stack Cycle",
      seriesOrder: 2,
      description: "A clean description.",
      genres: ["Fantasy", "Featured"],
      durationSeconds: 1234,
      publicationYear: 2024,
      coverPath: "/metadata/items/item_1/cover.jpg",
      audioPath: "/srv/media/audiobooks/Jamie/Book One/part01.mp3",
      audioTracks: [
        { path: "/srv/media/audiobooks/Jamie/Book One/part01.mp3", durationSeconds: 600 },
        { path: "/srv/media/audiobooks/Jamie/Book One/part02.mp3", durationSeconds: 634 }
      ],
      chapters: [{ id: "1", title: "Opening", startSeconds: 0, endSeconds: 120 }]
    });
  });

  it("flattens chapters stored on multiple audio files into book positions", async () => {
    const folder = path.join(os.tmpdir(), `story-stack-abs-${crypto.randomUUID()}`);
    const databasePath = path.join(folder, "absdatabase.sqlite");
    await mkdir(folder, { recursive: true });
    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TABLE libraryItems (id TEXT, path TEXT, relPath TEXT, mediaId TEXT, mediaType TEXT, isMissing INTEGER, isInvalid INTEGER, createdAt TEXT);
      CREATE TABLE books (id TEXT, title TEXT, subtitle TEXT, publishedYear TEXT, description TEXT, coverPath TEXT, duration REAL, narrators TEXT, audioFiles TEXT, tags TEXT, genres TEXT);
      CREATE TABLE authors (id TEXT, name TEXT);
      CREATE TABLE bookAuthors (id TEXT, bookId TEXT, authorId TEXT);
      CREATE TABLE series (id TEXT, name TEXT);
      CREATE TABLE bookSeries (id TEXT, bookId TEXT, seriesId TEXT, sequence TEXT);
    `);
    db.prepare("INSERT INTO libraryItems VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("item_3", "/audiobooks/Abandon", "Abandon", "book_3", "book", 0, 0, "2026-07-30T00:00:00.000Z");
    db.prepare("INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "book_3", "Abandon", null, null, null, null, 240, "[]",
      JSON.stringify([
        { duration: 120, metadata: { path: "/audiobooks/Abandon/01.mp3" }, chapters: [{ id: 1, start: 0, end: 60, title: "Chapter 1" }] },
        { duration: 120, metadata: { path: "/audiobooks/Abandon/02.mp3" }, chapters: [{ id: 2, start: 0, end: 45, title: "Chapter 2" }] }
      ]), "[]", "[]"
    );
    db.close();

    const books = new AudiobookshelfImporter().importBooks({
      databasePath,
      libraryPathPrefix: "/audiobooks",
      mediaPathPrefix: "/audiobooks",
      hostMediaPathPrefix: "/srv/media/audiobooks",
      metadataPathPrefix: "/metadata",
      hostMetadataPathPrefix: "/metadata"
    });

    expect(books[0].chapters).toEqual([
      { id: "1", title: "Chapter 1", startSeconds: 0, endSeconds: 60 },
      { id: "2", title: "Chapter 2", startSeconds: 120, endSeconds: 165 }
    ]);
  });

  it("maps media-folder cover paths when Audiobookshelf stores covers beside books", async () => {
    const folder = path.join(os.tmpdir(), `story-stack-abs-${crypto.randomUUID()}`);
    const databasePath = path.join(folder, "absdatabase.sqlite");
    await mkdir(folder, { recursive: true });
    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TABLE libraryItems (
        id TEXT PRIMARY KEY,
        path TEXT,
        relPath TEXT,
        mediaId TEXT,
        mediaType TEXT,
        isMissing INTEGER,
        isInvalid INTEGER,
        createdAt TEXT
      );
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT,
        subtitle TEXT,
        publishedYear TEXT,
        description TEXT,
        coverPath TEXT,
        duration REAL,
        narrators TEXT,
        audioFiles TEXT,
        tags TEXT,
        genres TEXT
      );
      CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE bookAuthors (id TEXT PRIMARY KEY, bookId TEXT, authorId TEXT);
      CREATE TABLE series (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE bookSeries (id TEXT PRIMARY KEY, bookId TEXT, seriesId TEXT, sequence TEXT);
    `);
    db.prepare("INSERT INTO libraryItems VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "item_2",
      "/audiobooks/Adam/Book Two",
      "Adam/Book Two",
      "book_2",
      "book",
      0,
      0,
      "2026-07-30T00:00:00.000Z"
    );
    db.prepare("INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "book_2",
      "Book Two",
      null,
      null,
      null,
      "/audiobooks/Adam/Book Two/cover.jpg",
      null,
      "[]",
      "[]",
      "[]",
      "[]"
    );
    db.close();

    const books = new AudiobookshelfImporter().importBooks({
      databasePath,
      libraryPathPrefix: "/audiobooks",
      mediaPathPrefix: "/audiobooks",
      hostMediaPathPrefix: "/srv/media/audiobooks",
      metadataPathPrefix: "/metadata",
      hostMetadataPathPrefix: "/metadata"
    });

    expect(books[0].coverPath).toBe("/srv/media/audiobooks/Adam/Book Two/cover.jpg");
  });
});
