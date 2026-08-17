import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";
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
  constructor(
    private readonly idFactory = new IdFactory(),
    private readonly clock = new Clock(),
    private readonly embeddedCoverDirectory?: string
  ) {}

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
    const sourceMetadata = await this.readMetadata(directory, directFiles);
    const audioFiles = entries.filter((file) => AUDIO_EXTENSIONS.has(path.extname(file.name).toLowerCase()));
    const audioTracks = audioFiles.map((file) => ({ path: path.join(file.directory, file.name) }));
    const audioFile = audioFiles[0];
    const embeddedMetadata = await this.readEmbeddedMetadataFromAudioFiles(audioFiles);
    const metadata = { ...embeddedMetadata, ...sourceMetadata };
    const sourceCover = this.metadataPath(directory, sourceMetadata.coverPath);
    const embeddedCover = this.metadataPath(directory, embeddedMetadata.coverPath);
    const metadataCover = sourceCover && (await this.fileExists(sourceCover))
      ? sourceCover
      : embeddedCover && (await this.fileExists(embeddedCover))
        ? embeddedCover
        : undefined;
    const coverFile = metadataCover
      ? undefined
      : entries.find((file) => COVER_EXTENSIONS.has(path.extname(file.name).toLowerCase()) && /cover|folder|front/i.test(file.name)) ??
        entries.find((file) => COVER_EXTENSIONS.has(path.extname(file.name).toLowerCase()));
    const fallbackTitle = path.basename(directory).replace(/[_-]+/g, " ");

    return {
      id: this.idFactory.stableBookId(directory),
      sourcePath: directory,
      title: this.asString(metadata.title) ?? fallbackTitle,
      subtitle: this.asString(metadata.subtitle),
      author: this.asPersonString(metadata.author) ?? this.asPersonString(metadata.authors) ?? "Unknown Author",
      narrator: this.asPersonString(metadata.narrator ?? metadata.narrators),
      series: this.asSeriesName(metadata.series),
      seriesOrder: this.asNumber(metadata.seriesOrder) ?? this.asSeriesOrder(metadata.series) ?? this.asNumber(metadata.sequence),
      description: this.asString(metadata.description) ?? this.asString(metadata.summary),
      genres: this.asStringArray(metadata.genres ?? metadata.tags),
      durationSeconds: this.asNumber(metadata.durationSeconds) ?? this.asNumber(metadata.duration),
      publicationYear: this.asNumber(metadata.publicationYear) ?? this.asNumber(metadata.publishedYear),
      coverPath: metadataCover && (await this.fileExists(metadataCover))
        ? metadataCover
        : coverFile
          ? path.join(coverFile.directory, coverFile.name)
          : undefined,
      audioPath: audioFile ? path.join(audioFile.directory, audioFile.name) : undefined,
      audioTracks,
      chapters: this.asChapters(metadata.chapters),
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

  private async readEmbeddedMetadata(filePath: string): Promise<Record<string, unknown>> {
    try {
      const parsed = await parseFile(filePath, { duration: true });
      const common = parsed.common as typeof parsed.common & EmbeddedCommonTags;
      const metadata: Record<string, unknown> = {
        title: common.title,
        author: common.artist?.length ? common.artist : common.albumartist,
        narrator: common.narrator,
        series: common.series,
        seriesOrder: common.track?.no,
        description: common.comment?.[0],
        genres: common.genre,
        publicationYear: common.year,
        durationSeconds: parsed.format.duration,
        coverPath: await this.cacheEmbeddedCover(filePath, common.picture),
        chapters: common.chapters?.map((chapter, index) => ({
          id: chapter.id ?? `chapter-${index + 1}`,
          title: chapter.title,
          startSeconds: chapter.start,
          endSeconds: chapter.end
        }))
      };
      return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
    } catch {
      // Some sources contain placeholder or partially written audio files. A
      // tag parse failure should not prevent the rest of the catalog syncing.
      return {};
    }
  }

  private async readEmbeddedMetadataFromAudioFiles(audioFiles: BookFile[]): Promise<Record<string, unknown>> {
    let metadata: Record<string, unknown> = {};
    for (const audioFile of audioFiles) {
      const candidate = await this.readEmbeddedMetadata(path.join(audioFile.directory, audioFile.name));
      metadata = { ...candidate, ...metadata };
      if (metadata.coverPath) break;
    }
    return metadata;
  }

  private async cacheEmbeddedCover(filePath: string, pictures: EmbeddedPicture[] | undefined): Promise<string | undefined> {
    const picture = pictures?.find((candidate) => candidate.data?.length && candidate.format);
    if (!picture || !this.embeddedCoverDirectory) return undefined;

    try {
      const extension = pictureExtension(picture.format);
      const key = createHash("sha256").update(filePath).digest("hex");
      const coverPath = path.join(this.embeddedCoverDirectory, `${key}.${extension}`);
      await mkdir(this.embeddedCoverDirectory, { recursive: true });
      await writeFile(coverPath, picture.data);
      return coverPath;
    } catch {
      return undefined;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile();
    } catch {
      return false;
    }
  }

  private metadataPath(directory: string, value: unknown): string | undefined {
    const metadataPath = this.asString(value);
    if (!metadataPath) return undefined;
    return path.isAbsolute(metadataPath) ? metadataPath : path.resolve(directory, metadataPath);
  }

  private asPersonString(value: unknown): string | undefined {
    if (!Array.isArray(value)) return this.asString(value);
    const people = value
      .map((person) => {
        if (typeof person === "string") return person.trim();
        if (person && typeof person === "object") return this.asString((person as Record<string, unknown>).name);
        return undefined;
      })
      .filter((person): person is string => Boolean(person));
    return people.length ? people.join(", ") : undefined;
  }

  private asSeriesName(value: unknown): string | undefined {
    if (!Array.isArray(value)) {
      if (value && typeof value === "object") return this.asString((value as Record<string, unknown>).name);
      return this.asString(value);
    }
    const series = value[0];
    if (series && typeof series === "object") return this.asString((series as Record<string, unknown>).name);
    return this.asString(series);
  }

  private asSeriesOrder(value: unknown): number | undefined {
    if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") return undefined;
    const series = value[0] as Record<string, unknown>;
    return this.asNumber(series.sequence ?? series.order);
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

  private asChapters(value: unknown): NonNullable<Book["chapters"]> | undefined {
    if (!Array.isArray(value)) return undefined;
    const chapters = value.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const chapter = item as Record<string, unknown>;
      const start = this.asNumber(chapter.start ?? chapter.startSeconds);
      const end = this.asNumber(chapter.end ?? chapter.endSeconds);
      if (start === undefined || end === undefined || end <= start) return [];
      return [{
        id: String(chapter.id ?? `chapter-${index + 1}`),
        title: this.asString(chapter.title) ?? `Chapter ${index + 1}`,
        startSeconds: start,
        endSeconds: end
      }];
    });
    return chapters.length ? chapters : undefined;
  }
}

interface EmbeddedCommonTags {
  narrator?: string[];
  series?: string;
  chapters?: Array<{
    id?: string;
    title?: string;
    start: number;
    end: number;
  }>;
  picture?: EmbeddedPicture[];
}

interface EmbeddedPicture {
  data: Uint8Array;
  format: string;
}

interface BookFile {
  directory: string;
  name: string;
}

function pictureExtension(format: string): string {
  const normalized = format.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "jpg";
}
