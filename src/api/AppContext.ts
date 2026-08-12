import path from "node:path";
import { StoryStackDatabase } from "../storage/StoryStackDatabase";
import { LibraryService } from "../services/LibraryService";
import { CatalogSyncService } from "../services/CatalogSyncService";
import { AuthService } from "../services/AuthService";
import { createMetadataEnrichmentService, MetadataEnrichmentService } from "../services/MetadataEnrichmentService";

export class AppContext {
  readonly database: StoryStackDatabase;
  readonly authService: AuthService;
  readonly libraryService: LibraryService;
  readonly catalogSyncService: CatalogSyncService;
  readonly metadataEnrichmentService: MetadataEnrichmentService;

  constructor(options: AppContextOptions = {}) {
    const dataDir = options.dataDir ?? process.env.STORY_STACK_DATA_DIR ?? "./data";
    const databasePath = options.databasePath ?? path.join(dataDir, "story-stack.sqlite");
    this.database = new StoryStackDatabase(databasePath);
    this.authService = new AuthService(this.database);
    this.libraryService = new LibraryService(this.database);
    this.catalogSyncService = new CatalogSyncService(this.database);
    this.metadataEnrichmentService = createMetadataEnrichmentService(this.database, dataDir);
  }
}

interface AppContextOptions {
  dataDir?: string;
  databasePath?: string;
}
