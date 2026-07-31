import path from "node:path";
import { StoryStackDatabase } from "../storage/StoryStackDatabase";
import { LibraryService } from "../services/LibraryService";
import { CatalogSyncService } from "../services/CatalogSyncService";
import { AuthService } from "../services/AuthService";
import { PlexAuthService } from "../services/PlexAuthService";
import { createMetadataEnrichmentService, MetadataEnrichmentService } from "../services/MetadataEnrichmentService";
import { PlexMediaService } from "../services/PlexMediaService";

export class AppContext {
  readonly database: StoryStackDatabase;
  readonly authService: AuthService;
  readonly plexAuthService: PlexAuthService;
  readonly libraryService: LibraryService;
  readonly catalogSyncService: CatalogSyncService;
  readonly metadataEnrichmentService: MetadataEnrichmentService;
  readonly plexMediaService: PlexMediaService;

  constructor(options: AppContextOptions = {}) {
    const dataDir = options.dataDir ?? process.env.STORY_STACK_DATA_DIR ?? "./data";
    const databasePath = options.databasePath ?? path.join(dataDir, "story-stack.sqlite");
    this.database = new StoryStackDatabase(databasePath);
    this.authService = new AuthService(this.database);
    this.plexAuthService = new PlexAuthService(this.database, this.authService);
    this.libraryService = new LibraryService(this.database);
    this.catalogSyncService = new CatalogSyncService(this.database);
    this.metadataEnrichmentService = createMetadataEnrichmentService(this.database, dataDir);
    this.plexMediaService = new PlexMediaService(this.database);
  }
}

interface AppContextOptions {
  dataDir?: string;
  databasePath?: string;
}
