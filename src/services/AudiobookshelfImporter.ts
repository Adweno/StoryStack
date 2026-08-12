import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { Book, BookAudioTrack } from "../domain/types";
import { IdFactory } from "../domain/IdFactory";

export interface AudiobookshelfImportOptions {
  databasePath: string;
  libraryPathPrefix: string;
  mediaPathPrefix: string;
  hostMediaPathPrefix: string;
  metadataPathPrefix: string;
  hostMetadataPathPrefix: string;
}

export class AudiobookshelfImporter {
  constructor(private readonly idFactory = new IdFactory()) {}

  importBooks(options: AudiobookshelfImportOptions): Book[] {
    const database = new DatabaseSync(options.databasePath, { readOnly: true });
    try {
      const bookColumns = database.prepare("PRAGMA table_info(books)").all() as unknown as Array<{ name: string }>;
      const hasChapters = bookColumns.some((column) => column.name === "chapters");
      const rows = database
        .prepare(
          `SELECT
             li.id AS itemId,
             li.path AS itemPath,
             li.relPath AS relPath,
             li.createdAt AS itemCreatedAt,
             b.id AS bookId,
             b.title AS title,
             b.subtitle AS subtitle,
             b.publishedYear AS publishedYear,
             b.description AS description,
             b.coverPath AS coverPath,
             b.duration AS duration,
             b.narrators AS narrators,
             b.audioFiles AS audioFiles,
             ${hasChapters ? "b.chapters" : "NULL"} AS chapters,
             b.tags AS tags,
             b.genres AS genres,
             (
               SELECT group_concat(a.name, ', ')
               FROM bookAuthors ba
               JOIN authors a ON a.id = ba.authorId
               WHERE ba.bookId = b.id
             ) AS authors,
             (
               SELECT s.name
               FROM bookSeries bs
               JOIN series s ON s.id = bs.seriesId
               WHERE bs.bookId = b.id
               ORDER BY s.name
               LIMIT 1
             ) AS series,
             (
               SELECT bs.sequence
               FROM bookSeries bs
               WHERE bs.bookId = b.id
               ORDER BY bs.sequence
               LIMIT 1
             ) AS seriesOrder
           FROM libraryItems li
           JOIN books b ON b.id = li.mediaId
           WHERE li.mediaType = 'book'
             AND COALESCE(li.isMissing, 0) = 0
             AND COALESCE(li.isInvalid, 0) = 0
             AND li.path LIKE ?
           ORDER BY b.title`
        )
        .all(`${options.libraryPathPrefix.replace(/\/$/, "")}%`) as unknown as AudiobookshelfBookRow[];

      return rows.map((row) => this.toBook(row, options));
    } finally {
      database.close();
    }
  }

  private toBook(row: AudiobookshelfBookRow, options: AudiobookshelfImportOptions): Book {
    const audioFiles = this.parseJsonArray<AudioFileRecord>(row.audioFiles);
    const audioTracks = audioFiles
      .map((file) => this.toAudioTrack(file, options))
      .filter((track): track is BookAudioTrack => Boolean(track));
    const firstAudioPath = audioTracks[0]?.path;
    const sourcePath = this.mapPrefix(row.itemPath, options.mediaPathPrefix, options.hostMediaPathPrefix);
    const audioPath = firstAudioPath
      ? this.mapPrefix(firstAudioPath, options.mediaPathPrefix, options.hostMediaPathPrefix)
      : sourcePath;
    const chapters = this.parseBookChapters(row.chapters, audioFiles);

    return {
      id: `abs_${row.itemId}` || this.idFactory.stableBookId(sourcePath),
      sourcePath,
      title: row.title || path.basename(sourcePath),
      subtitle: row.subtitle ?? undefined,
      author: row.authors || "Unknown Author",
      narrator: this.parseJsonArray<string>(row.narrators).join(", ") || undefined,
      series: row.series ?? undefined,
      seriesOrder: this.toNumber(row.seriesOrder),
      description: this.stripHtml(row.description),
      genres: [...this.parseJsonArray<string>(row.genres), ...this.parseJsonArray<string>(row.tags)].filter(Boolean),
      durationSeconds: this.toNumber(row.duration),
      publicationYear: this.toNumber(row.publishedYear),
      coverPath: row.coverPath ? this.mapCoverPath(row.coverPath, options) : undefined,
      audioPath,
      audioTracks,
      chapters: chapters.length ? chapters : undefined,
      addedAt: row.itemCreatedAt || new Date().toISOString(),
      hidden: false
    };
  }

  private toAudioTrack(file: AudioFileRecord, options: AudiobookshelfImportOptions): BookAudioTrack | undefined {
    const audioPath = file.metadata?.path;
    if (!audioPath) {
      return undefined;
    }
    return {
      path: this.mapPrefix(audioPath, options.mediaPathPrefix, options.hostMediaPathPrefix),
      durationSeconds: this.toNumber(file.duration) ?? this.toNumber(file.metadata?.duration)
    };
  }

  private parseJsonArray<T>(value: string | null): T[] {
    if (!value) {
      return [];
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private parseBookChapters(bookValue: string | null, audioFiles: AudioFileRecord[]): NonNullable<Book["chapters"]> {
    const bookChapters = this.parseJsonArray<BookChapterRecord>(bookValue);
    if (bookChapters.length) {
      return this.normalizeChapters(bookChapters);
    }

    // Audiobookshelf stores chapter markers on each audio file. Convert those
    // file-relative offsets into positions in the book's combined timeline.
    const chapters: BookChapterRecord[] = [];
    let fileOffset = 0;
    for (const file of audioFiles) {
      for (const chapter of file.chapters ?? []) {
        chapters.push({
          ...chapter,
          start: (this.toNumber(chapter.start) ?? 0) + fileOffset,
          end: (this.toNumber(chapter.end) ?? 0) + fileOffset
        });
      }
      fileOffset += this.toNumber(file.duration) ?? this.toNumber(file.metadata?.duration) ?? 0;
    }
    return this.normalizeChapters(chapters);
  }

  private normalizeChapters(chapters: BookChapterRecord[]): NonNullable<Book["chapters"]> {
    return chapters
      .map((chapter, index) => {
        const start = this.toNumber(chapter.start);
        const end = this.toNumber(chapter.end);
        if (start === undefined || end === undefined || end <= start) return undefined;
        return {
          id: String(chapter.id ?? `chapter-${index + 1}`),
          title: chapter.title?.trim() || `Chapter ${index + 1}`,
          startSeconds: start,
          endSeconds: end
        };
      })
      .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter));
  }

  private mapPrefix(value: string, fromPrefix: string, toPrefix: string): string {
    const cleanFrom = fromPrefix.replace(/\/$/, "");
    const cleanTo = toPrefix.replace(/\/$/, "");
    if (value === cleanFrom) {
      return cleanTo;
    }
    if (value.startsWith(`${cleanFrom}/`)) {
      return `${cleanTo}${value.slice(cleanFrom.length)}`;
    }
    return value;
  }

  private mapCoverPath(value: string, options: AudiobookshelfImportOptions): string {
    const metadataPath = this.mapPrefix(value, options.metadataPathPrefix, options.hostMetadataPathPrefix);
    if (metadataPath !== value) {
      return metadataPath;
    }
    return this.mapPrefix(value, options.mediaPathPrefix, options.hostMediaPathPrefix);
  }

  private toNumber(value: string | number | null | undefined): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return undefined;
  }

  private stripHtml(value: string | null): string | undefined {
    if (!value) {
      return undefined;
    }
    return value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

interface AudiobookshelfBookRow {
  itemId: string;
  itemPath: string;
  relPath: string | null;
  itemCreatedAt: string;
  bookId: string;
  title: string | null;
  subtitle: string | null;
  publishedYear: string | null;
  description: string | null;
  coverPath: string | null;
  duration: number | null;
  narrators: string | null;
  audioFiles: string | null;
  chapters: string | null;
  tags: string | null;
  genres: string | null;
  authors: string | null;
  series: string | null;
  seriesOrder: string | null;
}

interface AudioFileRecord {
  duration?: number | string | null;
  metadata?: {
    path?: string;
    duration?: number | string | null;
  };
  chapters?: BookChapterRecord[];
}

interface BookChapterRecord {
  id?: string | number;
  start?: number | string | null;
  end?: number | string | null;
  title?: string | null;
}
