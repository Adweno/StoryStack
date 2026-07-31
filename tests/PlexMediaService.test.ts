// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PlexMediaService } from "../src/services/PlexMediaService";
import { StoryStackDatabase } from "../src/storage/StoryStackDatabase";

describe("PlexMediaService", () => {
  it("lists Plex library sections with their media folders", async () => {
    const database = new StoryStackDatabase(path.join(os.tmpdir(), `story-stack-plex-${crypto.randomUUID()}.sqlite`));
    database.upsertPlexUser({
      plexId: "plex-adam",
      email: "adam.w.nott@gmail.com",
      name: "Adam",
      role: "admin",
      plexToken: "user-token"
    });
    const user = database.listUsers().find((item) => item.email === "adam.w.nott@gmail.com");
    const service = new PlexMediaService(database, vi.fn(async () => jsonResponse(plexSections())));

    await expect(service.listSections(user?.id ?? "", "http://plex.test:32400")).resolves.toEqual([
      {
        key: "12",
        title: "Music",
        type: "artist",
        locations: ["/srv/media/audiobooks"]
      }
    ]);
  });

  it("matches visible books to Plex media parts by audio file path", async () => {
    const database = new StoryStackDatabase(path.join(os.tmpdir(), `story-stack-plex-${crypto.randomUUID()}.sqlite`));
    database.upsertBook({
      id: "plex_book",
      sourcePath: "/srv/media/audiobooks/Adam/Book",
      title: "Book",
      author: "A. Writer",
      genres: [],
      audioPath: "/srv/media/audiobooks/Adam/Book/book.m4b",
      addedAt: "2026-07-30T00:00:00.000Z",
      hidden: false
    });
    database.upsertPlexUser({
      plexId: "plex-adam",
      email: "adam.w.nott@gmail.com",
      name: "Adam",
      role: "admin",
      plexToken: "user-token"
    });
    const user = database.listUsers().find((item) => item.email === "adam.w.nott@gmail.com");
    database.savePlexSettings({ serverUrl: "http://plex.test:32400", sectionKey: "12" });
    const service = new PlexMediaService(database, vi.fn(async () => jsonResponse(plexLibrary())));

    const result = await service.matchVisibleBooks(user?.id ?? "");
    const book = await database.getBook("plex_book");

    expect(result).toMatchObject({ scanned: 1, matched: 1, unmatched: 0 });
    expect(book).toMatchObject({
      plexKey: "901",
      plexPartKey: "/library/parts/902/file.m4b",
      plexFile: "/srv/media/audiobooks/Adam/Book/book.m4b"
    });
  });
});

function plexSections() {
  return {
    MediaContainer: {
      Directory: [
        {
          key: "12",
          title: "Music",
          type: "artist",
          Location: [{ path: "/srv/media/audiobooks" }]
        }
      ]
    }
  };
}

function plexLibrary() {
  return {
    MediaContainer: {
      Metadata: [
        {
          ratingKey: "901",
          Media: [
            {
              Part: [{ key: "/library/parts/902/file.m4b", file: "/srv/media/audiobooks/Adam/Book/book.m4b" }]
            }
          ]
        }
      ]
    }
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
