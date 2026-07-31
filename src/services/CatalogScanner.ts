import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Book } from "../domain/types";
import { Clock } from "../domain/Clock";
import { IdFactory } from "../domain/IdFactory";

const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".aa",
  ".aax",
  ".aiff",
  ".alac",
  ".flac",
  ".m4a",
  ".m4b",
  ".mp3",
  ".mp4",
  ".mka",
  ".ogg",
  ".oga",
  ".opus",
  ".wav",
  ".weba",
  ".webm",
  ".wma"
]);
const COVER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const METADATA_FILE_NAMES = new Set(["metadata.json", "book.json", "desc.json"]);

export class CatalogScanner {
  constructor(private readonly idFactory = new IdFactory(), private readonly clock = new Clock()) {}

  async scan(libraryPath: string): Promise<Book[]> {
    const cleanPath = path.resolve(libraryPath);
    const rootStat = await stat(cleanPath);
    if (!rootStat.isDirectory()) {
      throw new Error("Library path must be a directory.");
    }

    const bookDirectories = await this.findBookDirectories(cleanPath);
    const books = await Promise.all(bookDirectories.map((directory) => this.createBook(directory)));
    return books.sort((left, right) => left.title.localeCompare(right.title));
  }

  private async findBookDirectories(root: string): Promise<string[]> {
    const audioDirectories = new Set<string>();
    const queue = [root];

    while (queue.length) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const entries = await readdir(current, { withFileTypes: true });
      const hasAudio = entries.some((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
      if (hasAudio) {
        audioDirectories.add(this.normalizeBookDirectory(root, current));
      }

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          queue.push(path.join(current, entry.name));
        }
      }
    }

    return [...audioDirectories].sort((left, right) => left.localeCompare(right));
  }

  private async createBook(directory: string): Promise<Book> {
    const entries = await this.readBookFiles(directory);
    const directFiles = entries.filter((entry) => entry.directory === directory).map((entry) => entry.name);
    const metadata = await this.readMetadata(directory, directFiles);
    const audioFile = entries.find((file) => AUDIO_EXTENSIONS.has(path.extname(file.name).toLowerCase()));
    const coverFile =
      entries.find((file) => COVER_EXTENSIONS.has(path.extname(file.name).toLowerCase()) && /cover|folder|front/i.test(file.name)) ??
      entries.find((file) => COVER_EXTENSIONS.has(path.extname(file.name).toLowerCase()));
    const fallbackTitle = path.basename(directory).replace(/[_-]+/g, " ");

    return {
      id: this.idFactory.stableBookId(directory),
      sourcePath: directory,
      title: this.asString(metadata.title) ?? fallbackTitle,
      subtitle: this.asString(metadata.subtitle),
      author: this.asString(metadata.author) ?? this.asString(metadata.authors) ?? "Unknown Author",
      narrator: this.asString(metadata.narrator),
      series: this.asString(metadata.series),
      seriesOrder: this.asNumber(metadata.seriesOrder) ?? this.asNumber(metadata.sequence),
      description: this.asString(metadata.description) ?? this.asString(metadata.summary),
      genres: this.asStringArray(metadata.genres ?? metadata.tags),
      durationSeconds: this.asNumber(metadata.durationSeconds) ?? this.asNumber(metadata.duration),
      publicationYear: this.asNumber(metadata.publicationYear) ?? this.asNumber(metadata.publishedYear),
      coverPath: coverFile ? path.join(coverFile.directory, coverFile.name) : undefined,
      audioPath: audioFile ? path.join(audioFile.directory, audioFile.name) : undefined,
      addedAt: this.clock.nowIso(),
      hidden: false
    };
  }

  private normalizeBookDirectory(root: string, audioDirectory: string): string {
    const name = path.basename(audioDirectory);
    if (audioDirectory !== root && /^(cd|disc|disk|part|volume|vol)\s*[-_.#]?\s*\d+$/i.test(name)) {
      return path.dirname(audioDirectory);
    }
    return audioDirectory;
  }

  private async readBookFiles(directory: string): Promise<BookFile[]> {
    const result: BookFile[] = [];
    const queue = [directory];

    while (queue.length) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          result.push({ directory: current, name: entry.name });
        } else if (entry.isDirectory() && this.shouldScanNestedBookFiles(entry.name)) {
          queue.push(path.join(current, entry.name));
        }
      }
    }

    return result.sort((left, right) => path.join(left.directory, left.name).localeCompare(path.join(right.directory, right.name)));
  }

  private shouldScanNestedBookFiles(directoryName: string): boolean {
    return /^(cd|disc|disk|part|volume|vol)\s*[-_.#]?\s*\d+$/i.test(directoryName);
  }

  private async readMetadata(directory: string, files: string[]): Promise<Record<string, unknown>> {
    const metadataFile = files.find((file) => METADATA_FILE_NAMES.has(file.toLowerCase()));
    if (!metadataFile) {
      return {};
    }

    try {
      const raw = await readFile(path.join(directory, metadataFile), "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private asString(value: unknown): string | undefined {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join(", ");
    }
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return undefined;
  }

  private asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }
}

interface BookFile {
  directory: string;
  name: string;
}
