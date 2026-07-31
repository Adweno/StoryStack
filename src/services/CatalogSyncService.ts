import type { SyncResult } from "../domain/types";
import { CatalogScanner } from "./CatalogScanner";
import { StoryStackDatabase } from "../storage/StoryStackDatabase";
import { AudiobookshelfImporter } from "./AudiobookshelfImporter";

export class CatalogSyncService {
  constructor(
    private readonly database: StoryStackDatabase,
    private readonly scanner = new CatalogScanner(),
    private readonly audiobookshelfImporter = new AudiobookshelfImporter()
  ) {}

  async sync(libraryPath: string): Promise<SyncResult> {
    const audiobookshelfPath = this.toAudiobookshelfPath(libraryPath);
    const books = process.env.STORY_STACK_ABS_DB_PATH
      ? this.audiobookshelfImporter.importBooks({
          databasePath: process.env.STORY_STACK_ABS_DB_PATH,
          libraryPathPrefix: audiobookshelfPath,
          mediaPathPrefix: process.env.STORY_STACK_ABS_MEDIA_PATH_PREFIX ?? "/audiobooks",
          hostMediaPathPrefix: process.env.STORY_STACK_MEDIA_PATH_PREFIX ?? "/srv/media/audiobooks",
          metadataPathPrefix: process.env.STORY_STACK_ABS_METADATA_PATH_PREFIX ?? "/metadata",
          hostMetadataPathPrefix: process.env.STORY_STACK_METADATA_PATH_PREFIX ?? "/metadata"
        })
      : await this.scanner.scan(libraryPath);
    let imported = 0;
    let updated = 0;
    const activeBookIds: string[] = [];

    for (const book of books) {
      const result = this.database.upsertBook(book);
      activeBookIds.push(result.id);
      if (result.status === "imported") {
        imported += 1;
      } else {
        updated += 1;
      }
    }
    const removed = this.database.replaceVisibleCatalog(activeBookIds);

    const result = {
      scanned: books.length,
      imported,
      updated,
      removed,
      errors: [],
      finishedAt: new Date().toISOString(),
      path: audiobookshelfPath
    };
    this.database.saveSyncResult(result);
    return result;
  }

  private toAudiobookshelfPath(libraryPath: string): string {
    const configuredPrefix = process.env.STORY_STACK_ABS_LIBRARY_PATH_PREFIX ?? "/audiobooks";
    const hostMediaPrefix = (process.env.STORY_STACK_MEDIA_PATH_PREFIX ?? "/srv/media/audiobooks").replace(/\/$/, "");
    const absMediaPrefix = (process.env.STORY_STACK_ABS_MEDIA_PATH_PREFIX ?? "/audiobooks").replace(/\/$/, "");
    const cleanPath = this.normalizeLibraryPath(libraryPath);
    if (!cleanPath) {
      return configuredPrefix;
    }
    if (cleanPath === hostMediaPrefix) {
      return absMediaPrefix;
    }
    if (cleanPath.startsWith(`${hostMediaPrefix}/`)) {
      return `${absMediaPrefix}${cleanPath.slice(hostMediaPrefix.length)}`;
    }
    return cleanPath.startsWith("/") ? cleanPath : configuredPrefix;
  }

  private normalizeLibraryPath(libraryPath: string): string {
    let cleanPath = libraryPath.trim().replace(/\\/g, "/").replace(/\/$/, "");
    if (cleanPath.startsWith("src/media/")) {
      cleanPath = `/srv/${cleanPath.slice("src/".length)}`;
    }
    if (cleanPath.startsWith("srv/media/")) {
      cleanPath = `/${cleanPath}`;
    }
    return cleanPath;
  }
}
