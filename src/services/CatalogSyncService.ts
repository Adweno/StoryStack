import type { SyncResult } from "../domain/types";
import { CatalogScanner } from "./CatalogScanner";
import { StoryStackDatabase } from "../storage/StoryStackDatabase";

export class CatalogSyncService {
  constructor(private readonly database: StoryStackDatabase, private readonly scanner = new CatalogScanner()) {}

  async sync(libraryPath: string): Promise<SyncResult> {
    const books = await this.scanner.scan(libraryPath);
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
      path: libraryPath
    };
    this.database.saveSyncResult(result);
    return result;
  }
}
