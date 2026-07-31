import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { Book } from "../domain/types";
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
    const firstAudioPath = audioFiles
      .map((file) => file.metadata?.path)
      .find((audioPath): audioPath is string => Boolean(audioPath));
    const sourcePath = this.mapPrefix(row.itemPath, options.mediaPathPrefix, options.hostMediaPathPrefix);
    const audioPath = firstAudioPath
      ? this.mapPrefix(firstAudioPath, options.mediaPathPrefix, options.hostMediaPathPrefix)
      : sourcePath;

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
      addedAt: row.itemCreatedAt || new Date().toISOString(),
      hidden: false
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

  private toNumber(value: string | number | null): number | undefined {
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
  tags: string | null;
  genres: string | null;
  authors: string | null;
  series: string | null;
  seriesOrder: string | null;
}

interface AudioFileRecord {
  metadata?: {
    path?: string;
  };
}
