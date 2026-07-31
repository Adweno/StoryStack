import express, { type Request, type Response } from "express";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { User } from "../domain/types";
import { BookCatalog } from "../domain/BookCatalog";
import { AppContext } from "./AppContext";

const plexPollSchema = z.object({ pinId: z.number().int().positive() });
const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});
const addToLibrarySchema = z.object({ bookId: z.string().min(1) });
const bookReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().trim().max(2000).default("")
});
const shelfSchema = z.object({ name: z.string().trim().min(1).max(80) });
const shelfBookSchema = z.object({ bookId: z.string().min(1) });
const progressSchema = z.object({
  bookId: z.string().min(1),
  positionSeconds: z.number().min(0),
  durationSeconds: z.number().min(1).optional()
});
const plexSettingsSchema = z.object({
  serverUrl: z.string().trim().min(1),
  sectionKey: z.string().trim().optional().default("")
});
const catalogSettingsSchema = z.object({
  libraryPath: z.string().trim().min(1)
});
const adminUserSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  role: z.enum(["admin", "user"])
});
const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["admin", "user"]).default("user"),
  expiresInDays: z.number().int().min(1).max(90).optional()
});
const acceptInviteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8)
});
const passwordChangeSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8)
});
const userPreferencesSchema = z.object({
  theme: z.enum(["dark", "light"]),
  reviewsEnabled: z.boolean()
});
const adminPasswordResetSchema = z.object({
  newPassword: z.string().min(8)
});
const userPatchSchema = z.object({
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "disabled"]).optional()
});
const remoteAccessSchema = z.object({
  mode: z.enum(["local", "manual", "cloudflare"]),
  publicUrl: z.string().trim().default("")
});

export class AppServer {
  readonly app = express();

  constructor(readonly context = new AppContext()) {
    this.configure();
    this.routes();
  }

  private configure(): void {
    this.app.use(express.json({ limit: "1mb" }));
    const staticPath = path.resolve("dist/client");
    if (existsSync(staticPath)) {
      this.app.use(express.static(staticPath));
    }
  }

  private routes(): void {
    this.app.get("/api/health", (_request, response) => {
      response.json({ ok: true, app: "Story Stack" });
    });

    this.app.post("/api/auth/login", (request, response) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Username/email and password are required." });
      }
      const result = this.context.authService.login(parsed.data.username, parsed.data.password);
      if (!result) {
        return response.status(401).json({ error: "Sign in failed. Check the account and password." });
      }
      this.setSessionCookie(response, result.token, result.expiresAt);
      response.json({ user: result.user });
    });

    this.app.post("/api/auth/plex/start", async (_request, response) => {
      try {
        response.json({ pin: await this.context.plexAuthService.createPin() });
      } catch (error) {
        this.sendHandledError(response, error);
      }
    });

    this.app.post("/api/auth/plex/poll", async (request, response) => {
      const parsed = plexPollSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Plex PIN id is required." });
      }
      const result = await this.context.plexAuthService.completePin(parsed.data.pinId);
      if (!result) {
        return response.status(202).json({ pending: true });
      }
      this.setSessionCookie(response, result.token, result.expiresAt);
      response.json({ user: result.user });
    });

    this.app.get("/api/invites/:token", (request, response) => {
      const invite = this.context.database.getInviteByToken(request.params.token);
      if (!invite || invite.status !== "pending") {
        return response.status(404).json({ error: "Invite is no longer available." });
      }
      response.json({ invite: { email: invite.email, role: invite.role, expiresAt: invite.expiresAt } });
    });

    this.app.post("/api/invites/:token/accept", (request, response) => {
      const parsed = acceptInviteSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Name and a password of at least 8 characters are required." });
      }
      try {
        const user = this.context.database.acceptInvite({ token: request.params.token, ...parsed.data });
        const result = this.context.authService.createSession(user);
        this.setSessionCookie(response, result.token, result.expiresAt);
        response.json({ user: result.user });
      } catch (error) {
        this.sendHandledError(response, error);
      }
    });

    this.app.post("/api/logout", (request, response) => {
      this.context.authService.logout(this.sessionToken(request));
      response.clearCookie("story_stack_session", { path: "/" });
      response.status(204).send();
    });

    this.app.get("/api/me", (request, response) => {
      const user = this.currentUser(request);
      if (!user) {
        return response.status(401).json({ error: "Login required." });
      }
      response.json(user);
    });

    this.app.post("/api/me/password", (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = passwordChangeSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "A password of at least 8 characters is required." });
      }
      try {
        response.json({ user: this.context.authService.changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword) });
      } catch (error) {
        response.status(401).json({ error: error instanceof Error ? error.message : "Password could not be changed." });
      }
    });

    this.app.patch("/api/me/preferences", (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = userPreferencesSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Choose a valid theme and review setting." });
      }
      response.json({ user: this.context.database.updateUserPreferences(user.id, parsed.data) });
    });

    this.app.get("/api/store", (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const query = String(request.query.q ?? "");
      const books = new BookCatalog(this.context.database.listVisibleBooks()).search(query);
      const libraryBookIds = new Set(this.context.database.listLibraryBookDetails(user.id).map((book) => book.id));
      response.json({
        books: books.map((book) => ({ ...book, inLibrary: libraryBookIds.has(book.id) }))
      });
    });

    this.app.get("/api/books/:bookId", async (request, response) => {
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || book.hidden) {
        return response.status(404).json({ error: "Book was not found." });
      }
      response.json({ book });
    });

    this.app.get("/api/books/:bookId/reviews", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || book.hidden) {
        return response.status(404).json({ error: "Book was not found." });
      }
      const reviews = this.context.database
        .listBookReviews(request.params.bookId)
        .map((review) => ({ ...review, isMine: review.userId === user.id }));
      response.json({
        summary: this.context.database.getBookReviewSummary(request.params.bookId),
        reviews,
        myReview: reviews.find((review) => review.userId === user.id)
      });
    });

    this.app.post("/api/books/:bookId/reviews", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = bookReviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Choose a rating from 1 to 5 stars." });
      }
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || book.hidden) {
        return response.status(404).json({ error: "Book was not found." });
      }
      if (!this.context.database.isBookInUserLibrary(user.id, request.params.bookId)) {
        return response.status(403).json({ error: "Add this book to your library before reviewing it." });
      }
      const review = this.context.database.upsertBookReview({ bookId: request.params.bookId, userId: user.id, ...parsed.data });
      response.json({
        review: { ...review, isMine: true },
        summary: this.context.database.getBookReviewSummary(request.params.bookId)
      });
    });

    this.app.delete("/api/books/:bookId/reviews/me", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || book.hidden) {
        return response.status(404).json({ error: "Book was not found." });
      }
      if (!this.context.database.isBookInUserLibrary(user.id, request.params.bookId)) {
        return response.status(403).json({ error: "Reviews can only be managed from your library." });
      }
      this.context.database.deleteBookReview(request.params.bookId, user.id);
      response.status(204).send();
    });

    this.app.get("/api/library", (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      response.json({
        books: this.context.database.listLibraryBookDetails(user.id),
        progress: this.context.database.listProgress(user.id)
      });
    });

    this.app.post("/api/library", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = addToLibrarySchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Book id is required." });
      }
      try {
        const entry = await this.context.libraryService.addToLibrary(user.id, parsed.data.bookId);
        response.status(201).json({ entry });
      } catch (error) {
        this.sendHandledError(response, error);
      }
    });

    this.app.delete("/api/library/:bookId", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      await this.context.libraryService.removeFromLibrary(user.id, request.params.bookId);
      response.status(204).send();
    });

    this.app.get("/api/shelves", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      response.json({ shelves: await this.context.database.listShelves(user.id) });
    });

    this.app.post("/api/shelves", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = shelfSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Shelf name is required." });
      }
      const shelf = await this.context.libraryService.createShelf(user.id, parsed.data.name);
      response.status(201).json({ shelf });
    });

    this.app.get("/api/shelves/:shelfId/books", (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      response.json({ books: this.context.database.listShelfBookDetails(user.id, request.params.shelfId) });
    });

    this.app.post("/api/shelves/:shelfId/books", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = shelfBookSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Book id is required." });
      }
      try {
        const entry = await this.context.libraryService.addBookToShelf(
          user.id,
          request.params.shelfId,
          parsed.data.bookId
        );
        response.status(201).json({ entry });
      } catch (error) {
        this.sendHandledError(response, error);
      }
    });

    this.app.post("/api/progress", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = progressSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Valid progress is required." });
      }
      const progress = await this.context.libraryService.updateProgress(
        user.id,
        parsed.data.bookId,
        parsed.data.positionSeconds,
        parsed.data.durationSeconds
      );
      response.json({ progress });
    });

    this.app.get("/api/admin/users", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      response.json({ users: this.context.database.listUsers() });
    });

    this.app.post("/api/admin/users", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      const parsed = adminUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Name, email, and role are required." });
      }
      response.status(201).json({ user: this.context.database.createManagedUser(parsed.data) });
    });

    this.app.patch("/api/admin/users/:userId", (request, response) => {
      const currentUser = this.requireAdmin(request, response);
      if (!currentUser) return;
      const parsed = userPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Role or status is required." });
      }
      if (parsed.data.role === "user" && this.wouldRemoveLastAdmin(request.params.userId)) {
        return response.status(400).json({ error: "At least one admin account is required." });
      }
      if (parsed.data.status === "disabled" && request.params.userId === currentUser.id) {
        return response.status(400).json({ error: "You cannot disable your own account." });
      }
      let user = parsed.data.role ? this.context.database.updateUserRole(request.params.userId, parsed.data.role) : this.context.database.getUserById(request.params.userId);
      if (parsed.data.status) {
        user = this.context.database.updateUserStatus(request.params.userId, parsed.data.status);
      }
      response.json({ user });
    });

    this.app.post("/api/admin/users/:userId/password", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      const parsed = adminPasswordResetSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "A password of at least 8 characters is required." });
      }
      response.json({ user: this.context.authService.resetPassword(request.params.userId, parsed.data.newPassword) });
    });

    this.app.delete("/api/admin/users/:userId", (request, response) => {
      const currentUser = this.requireAdmin(request, response);
      if (!currentUser) return;
      if (request.params.userId === currentUser.id) {
        return response.status(400).json({ error: "You cannot remove your own account." });
      }
      if (this.wouldRemoveLastAdmin(request.params.userId)) {
        return response.status(400).json({ error: "At least one admin account is required." });
      }
      this.context.database.deleteUser(request.params.userId);
      response.status(204).send();
    });

    this.app.get("/api/admin/invites", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      response.json({ invites: this.context.database.listInvites() });
    });

    this.app.post("/api/admin/invites", (request, response) => {
      const user = this.requireAdmin(request, response);
      if (!user) return;
      const parsed = inviteSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Invite email is required." });
      }
      const expiresAt = parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;
      response.status(201).json({ invite: this.context.database.createInvite({ ...parsed.data, invitedByUserId: user.id, expiresAt }) });
    });

    this.app.delete("/api/admin/invites/:inviteId", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      this.context.database.revokeInvite(request.params.inviteId);
      response.status(204).send();
    });

    this.app.get("/api/admin/remote-access", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      response.json({ settings: this.context.database.getRemoteAccessSettings() });
    });

    this.app.post("/api/admin/remote-access", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      const parsed = remoteAccessSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Remote access mode is required." });
      }
      response.json({ settings: this.context.database.saveRemoteAccessSettings(parsed.data) });
    });

    this.app.post("/api/admin/metadata/enrich", async (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      try {
        response.json({ result: await this.context.metadataEnrichmentService.enrichMissing() });
      } catch (error) {
        this.sendHandledError(response, error);
      }
    });

    this.app.get("/api/admin/catalog", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      response.json({
        settings: this.context.database.getCatalogSettings(),
        latestSync: this.context.database.getLatestSync()
      });
    });

    this.app.post("/api/admin/catalog", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      const parsed = catalogSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Audiobook folder is required." });
      }
      response.json({ settings: this.context.database.saveCatalogSettings(parsed.data) });
    });

    this.app.post("/api/admin/catalog/sync", async (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      const requestedPath = String(request.body?.libraryPath ?? "").trim();
      const libraryPath = requestedPath || this.context.database.getCatalogSettings().libraryPath;
      if (!libraryPath) {
        return response.status(400).json({ error: "Choose an audiobook folder before scanning." });
      }
      try {
        this.context.database.saveCatalogSettings({ libraryPath });
        response.json({ result: await this.context.catalogSyncService.sync(libraryPath) });
      } catch (error) {
        this.sendHandledError(response, error);
      }
    });

    this.app.get("/api/admin/plex", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      response.json({ settings: this.context.plexMediaService.settings() });
    });

    this.app.get("/api/admin/plex/sections", async (request, response) => {
      const user = this.requireAdmin(request, response);
      if (!user) return;
      try {
        const serverUrl = String(request.query.serverUrl ?? "").trim() || undefined;
        response.json({ sections: await this.context.plexMediaService.listSections(user.id, serverUrl) });
      } catch (error) {
        this.sendHandledError(response, error);
      }
    });

    this.app.post("/api/admin/plex", (request, response) => {
      if (!this.requireAdmin(request, response)) return;
      const parsed = plexSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Plex server URL is required." });
      }
      try {
        response.json({ settings: this.context.plexMediaService.saveSettings(parsed.data) });
      } catch (error) {
        this.sendHandledError(response, error);
      }
    });

    this.app.post("/api/admin/plex/match", async (request, response) => {
      const user = this.requireAdmin(request, response);
      if (!user) return;
      try {
        response.json({ result: await this.context.plexMediaService.matchVisibleBooks(user.id) });
      } catch (error) {
        this.sendHandledError(response, error);
      }
    });

    this.app.get("/media/books/:bookId/cover", async (request, response) => {
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book?.coverPath) {
        return response.status(404).send("Cover not found");
      }
      response.sendFile(book.coverPath);
    });

    this.app.get("/media/books/:bookId/audio", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || (!book.audioPath && !book.plexPartKey)) {
        return response.status(404).send("Audio not found");
      }
      const plexUrl = this.context.plexMediaService.mediaUrl(book, user.id);
      if (plexUrl) {
        await this.proxyPlexAudio(request, response, plexUrl);
        return;
      }
      if (!book.audioPath) {
        return response.status(404).send("Audio not found");
      }
      response.sendFile(book.audioPath);
    });

    this.app.use((_request, response) => {
      const indexPath = path.resolve("dist/client/index.html");
      if (existsSync(indexPath)) {
        return response.sendFile(indexPath);
      }
      response.status(404).send("Story Stack client has not been built yet. Run the Vite dev server for the UI.");
    });
  }

  private currentUser(request: Request): User | undefined {
    return this.context.authService.sessionUser(this.sessionToken(request));
  }

  private requireUser(request: Request, response: Response): User | undefined {
    const user = this.currentUser(request);
    if (!user) {
      response.status(401).json({ error: "Login required." });
      return undefined;
    }
    return user;
  }

  private requireAdmin(request: Request, response: Response): User | undefined {
    const user = this.requireUser(request, response);
    if (!user) {
      return undefined;
    }
    if (user.role !== "admin") {
      response.status(403).json({ error: "Admin access is required." });
      return undefined;
    }
    return user;
  }

  private sessionToken(request: Request): string | undefined {
    const cookie = request.headers.cookie ?? "";
    return cookie
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("story_stack_session="))
      ?.split("=")[1];
  }

  private setSessionCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie("story_stack_session", token, {
      httpOnly: true,
      sameSite: "lax",
      expires: expiresAt,
      path: "/"
    });
  }

  private wouldRemoveLastAdmin(userId: string): boolean {
    const users = this.context.database.listUsers();
    const target = users.find((user) => user.id === userId);
    return target?.role === "admin" && users.filter((user) => user.role === "admin").length <= 1;
  }

  private sendHandledError(response: Response, error: unknown): void {
    const message = error instanceof Error ? error.message : "Request failed.";
    response.status(400).json({ error: message });
  }

  private async proxyPlexAudio(request: Request, response: Response, url: string): Promise<void> {
    const plexResponse = await fetch(url, {
      headers: request.headers.range ? { Range: request.headers.range } : undefined
    });
    if (!plexResponse.ok && plexResponse.status !== 206) {
      response.status(plexResponse.status).send("Plex audio not available");
      return;
    }
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = plexResponse.headers.get(header);
      if (value) {
        response.setHeader(header, value);
      }
    }
    response.status(plexResponse.status);
    if (!plexResponse.body) {
      response.end();
      return;
    }
    Readable.fromWeb(plexResponse.body as unknown as NodeReadableStream).pipe(response);
  }
}
