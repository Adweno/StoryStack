import type { Book, PlexLibrarySection, PlexMatchResult, PlexSettings } from "../domain/types";
import type { StoryStackDatabase } from "../storage/StoryStackDatabase";

const PLEX_HEADERS = {
  Accept: "application/json",
  "X-Plex-Product": "Story Stack",
  "X-Plex-Version": "1.0.0"
};

export class PlexMediaService {
  constructor(
    private readonly database: StoryStackDatabase,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args)
  ) {}

  settings(): PlexSettings {
    return this.database.getPlexSettings();
  }

  saveSettings(settings: PlexSettings): PlexSettings {
    if (!settings.serverUrl.trim()) {
      throw new Error("Plex server URL is required.");
    }
    return this.database.savePlexSettings({
      serverUrl: settings.serverUrl.trim(),
      sectionKey: settings.sectionKey.trim()
    });
  }

  async listSections(userId: string, serverUrl = this.database.getPlexSettings().serverUrl): Promise<PlexLibrarySection[]> {
    const token = this.requireToken(userId);
    const response = await this.fetcher(`${serverUrl.replace(/\/$/, "")}/library/sections?X-Plex-Token=${encodeURIComponent(token)}`, {
      headers: PLEX_HEADERS
    });
    if (!response.ok) {
      throw new Error("Plex libraries could not be loaded.");
    }
    const data = (await response.json()) as PlexSectionsResponse;
    return (data.MediaContainer?.Directory ?? []).map((section) => ({
      key: section.key,
      title: section.title,
      type: section.type,
      locations: (section.Location ?? []).map((location) => location.path).filter(Boolean)
    }));
  }

  async matchVisibleBooks(userId: string): Promise<PlexMatchResult> {
    const token = this.requireToken(userId);
    const settings = this.database.getPlexSettings();
    if (!settings.sectionKey) {
      throw new Error("Choose a Plex library section before matching media.");
    }
    const mediaParts = await this.fetchMediaParts(settings, token);
    const partsByFile = new Map(mediaParts.map((part) => [normalizePath(part.file), part]));
    const books = this.database.listVisibleBooks();
    const result: PlexMatchResult = {
      scanned: books.length,
      matched: 0,
      unmatched: 0,
      errors: [],
      finishedAt: new Date().toISOString()
    };

    for (const book of books) {
      const match = this.findMatch(book, partsByFile);
      if (!match) {
        result.unmatched += 1;
        continue;
      }
      this.database.updateBookPlexMatch(book.id, {
        plexKey: match.metadataKey,
        plexPartKey: match.partKey,
        plexFile: match.file
      });
      result.matched += 1;
    }
    return result;
  }

  mediaUrl(book: Book, userId: string): string | undefined {
    if (!book.plexPartKey) {
      return undefined;
    }
    const token = this.database.getUserPlexToken(userId);
    if (!token) {
      return undefined;
    }
    const serverUrl = this.database.getPlexSettings().serverUrl.replace(/\/$/, "");
    return `${serverUrl}${book.plexPartKey}${book.plexPartKey.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(token)}`;
  }

  private async fetchMediaParts(settings: PlexSettings, token: string): Promise<PlexMediaPart[]> {
    const sectionUrl = `${settings.serverUrl.replace(/\/$/, "")}/library/sections/${encodeURIComponent(settings.sectionKey)}/all?type=10&X-Plex-Token=${encodeURIComponent(token)}`;
    const response = await this.fetcher(sectionUrl, { headers: PLEX_HEADERS });
    if (!response.ok) {
      throw new Error("Plex media could not be loaded.");
    }
    const data = (await response.json()) as PlexLibraryResponse;
    const metadata = data.MediaContainer?.Metadata ?? [];
    return metadata.flatMap((item) =>
      (item.Media ?? []).flatMap((media) =>
        (media.Part ?? []).flatMap((part) => {
          if (!part.file || !part.key) {
            return [];
          }
          return [
            {
              metadataKey: item.ratingKey ?? item.key ?? "",
              partKey: part.key,
              file: part.file
            }
          ];
        })
      )
    );
  }

  private findMatch(book: Book, partsByFile: Map<string, PlexMediaPart>): PlexMediaPart | undefined {
    const candidates = [book.audioPath, book.sourcePath].filter((value): value is string => Boolean(value)).map(normalizePath);
    for (const candidate of candidates) {
      const exact = partsByFile.get(candidate);
      if (exact) {
        return exact;
      }
      const suffix = [...partsByFile.entries()].find(([file]) => file.endsWith(candidate) || candidate.endsWith(file))?.[1];
      if (suffix) {
        return suffix;
      }
    }
    return undefined;
  }

  private requireToken(userId: string): string {
    const token = this.database.getUserPlexToken(userId);
    if (!token) {
      throw new Error("Sign in with Plex again before matching media.");
    }
    return token;
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

interface PlexMediaPart {
  metadataKey: string;
  partKey: string;
  file: string;
}

interface PlexLibraryResponse {
  MediaContainer?: {
    Metadata?: PlexMetadata[];
  };
}

interface PlexSectionsResponse {
  MediaContainer?: {
    Directory?: Array<{
      key: string;
      title: string;
      type: string;
      Location?: Array<{ path: string }>;
    }>;
  };
}

interface PlexMetadata {
  ratingKey?: string;
  key?: string;
  Media?: Array<{
    Part?: Array<{
      key?: string;
      file?: string;
    }>;
  }>;
}
