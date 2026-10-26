import express, { type Request, type Response } from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import type { Book, User } from "../domain/types";
import { BookCatalog } from "../domain/BookCatalog";
import { AppContext } from "./AppContext";
import { AuthRateLimiter } from "./AuthRateLimiter";

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});
const addToLibrarySchema = z.object({ bookId: z.string().min(1) });
const bookReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().trim().max(2000).default("")
});
const bookMetadataSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  subtitle: z.string().trim().max(200).optional(),
  author: z.string().trim().min(1).max(120).optional(),
  narrator: z.string().trim().max(120).optional(),
  series: z.string().trim().max(120).optional(),
  seriesOrder: z.number().min(0).optional(),
  description: z.string().trim().max(5000).optional(),
  genres: z.array(z.string().trim().min(1)).max(20).optional(),
  publicationYear: z.number().int().min(0).max(3000).optional(),
  coverPath: z.string().trim().max(1024).optional(),
  coverUrl: z.string().url().max(2048).optional()
});
const shelfSchema = z.object({ name: z.string().trim().min(1).max(80) });
const shelfBookSchema = z.object({ bookId: z.string().min(1) });
const progressSchema = z.object({
  bookId: z.string().min(1),
  positionSeconds: z.number().min(0),
  durationSeconds: z.number().min(1).optional()
});
const bookmarkSchema = z.object({
  positionSeconds: z.number().min(0),
  title: z.string().trim().max(120).optional()
});
const bookmarkPatchSchema = bookmarkSchema.partial();
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
  status: z.enum(["active", "disabled"]).optional(),
  metadataEditorEnabled: z.boolean().optional()
});
const remoteAccessSchema = z.object({
  mode: z.enum(["local", "manual", "cloudflare", "device"]),
  publicUrl: z.string().trim().default("")
});
const castMediaTokenSchema = z.object({ bookId: z.string().min(1) });

const CAST_TOKEN_TTL_MS = 10 * 60 * 1000;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export class AppServer {
  readonly app = express();
  private readonly castTokenSecret = randomBytes(32);
  private readonly authRateLimiter = new AuthRateLimiter();

  constructor(readonly context = new AppContext()) {
    this.configure();
    this.routes();
  }

  private configure(): void {
    this.app.use(express.json({ limit: "1mb" }));
    const staticPath = path.resolve("dist/client");
    if (existsSync(staticPath)) {
      this.app.use(
        express.static(staticPath, {
          setHeaders: (response, filePath) => {
            if (filePath.endsWith("service-worker.js") || filePath.endsWith("manifest.webmanifest")) {
              response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            }
          }
        })
      );
    }
  }

  private routes(): void {
    this.app.get("/privacy-policy.html", (_request, response) => {
      const policyPath = path.resolve("dist/client/privacy-policy.html");
      if (existsSync(policyPath)) {
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        return response.sendFile(policyPath);
      }
      response.status(404).send("Privacy policy is not available until the client has been built.");
    });

    this.app.get("/api/health", (_request, response) => {
      response.json({ ok: true, app: "Story Stack" });
    });

    this.app.post("/api/auth/login", (request, response) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Username/email and password are required." });
      }
      const loginKey = `login:${request.ip}:${parsed.data.username.toLowerCase()}`;
      const retryAfter = this.authRateLimiter.consume(loginKey, LOGIN_LIMIT, LOGIN_WINDOW_MS);
      if (retryAfter) {
        response.setHeader("Retry-After", retryAfter);
        return response.status(429).json({ error: "Too many sign-in attempts. Try again later." });
      }
      const result = this.context.authService.login(parsed.data.username, parsed.data.password);
      if (!result) {
        return response.status(401).json({ error: "Sign in failed. Check the account and password." });
      }
      this.authRateLimiter.clear(loginKey);
      this.setSessionCookie(request, response, result.token, result.expiresAt);
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
        this.setSessionCookie(request, response, result.token, result.expiresAt);
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

    this.app.get("/api/books/:bookId/download-manifest", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || book.hidden) {
        return response.status(404).json({ error: "Book was not found." });
      }
      if (!this.context.database.isBookInUserLibrary(user.id, book.id)) {
        return response.status(403).json({ error: "Add this book to your library first." });
      }

      const tracks = book.audioTracks?.length
        ? book.audioTracks.map((track, index) => ({
            path: track.path,
            url: `/media/books/${encodeURIComponent(book.id)}/audio/${index}`
          }))
        : book.audioPath
        ? [{ path: book.audioPath, url: `/media/books/${encodeURIComponent(book.id)}/audio` }]
        : [];
      if (!tracks.length || tracks.some((track) => !existsSync(track.path))) {
        return response.status(404).json({ error: "Audio is not available on the server." });
      }

      const manifestTracks = await Promise.all(
        tracks.map(async (track) => {
          const stats = await stat(track.path);
          return {
            url: track.url,
            bytes: stats.size,
            sha256: await sha256File(track.path)
          };
        })
      );
      response.json({ bookId: book.id, tracks: manifestTracks });
    });

    this.app.patch("/api/books/:bookId/metadata", async (request, response) => {
      const user = this.requireMetadataEditor(request, response);
      if (!user) return;
      const parsed = bookMetadataSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "Choose metadata fields to update." });
      }
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || book.hidden) {
        return response.status(404).json({ error: "Book was not found." });
      }
      const { coverUrl, ...metadataPatch } = parsed.data;
      if (coverUrl) {
        await this.context.metadataEnrichmentService.applyMetadataPatch(request.params.bookId, { ...metadataPatch, coverUrl });
      } else {
        this.context.database.updateBookMetadata(request.params.bookId, metadataPatch);
      }
      const updatedBook = await this.context.database.getBook(request.params.bookId);
      if (!updatedBook) {
        return response.status(404).json({ error: "Book was not found." });
      }
      response.json({ book: updatedBook });
    });

    this.app.post("/api/books/:bookId/metadata/find", async (request, response) => {
      const user = this.requireMetadataEditor(request, response);
      if (!user) return;
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || book.hidden) {
        return response.status(404).json({ error: "Book was not found." });
      }
      try {
        const result = await this.context.metadataEnrichmentService.findBook(request.params.bookId);
        response.json(result);
      } catch (error) {
        this.sendHandledError(response, error);
      }
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

    this.app.get("/api/books/:bookId/bookmarks", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || book.hidden) return response.status(404).json({ error: "Book was not found." });
      if (!this.context.database.isBookInUserLibrary(user.id, book.id)) return response.status(403).json({ error: "Add this book to your library first." });
      response.json({ bookmarks: this.context.database.listBookBookmarks(book.id, user.id) });
    });

    this.app.post("/api/books/:bookId/bookmarks", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = bookmarkSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: "A valid bookmark position is required." });
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || book.hidden) return response.status(404).json({ error: "Book was not found." });
      if (!this.context.database.isBookInUserLibrary(user.id, book.id)) return response.status(403).json({ error: "Add this book to your library first." });
      response.status(201).json({ bookmark: this.context.database.createBookBookmark({ bookId: book.id, userId: user.id, ...parsed.data }) });
    });

    this.app.patch("/api/books/:bookId/bookmarks/:bookmarkId", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = bookmarkPatchSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: "A valid bookmark update is required." });
      const bookmark = this.context.database.updateBookBookmark(request.params.bookmarkId, user.id, parsed.data);
      if (!bookmark || bookmark.bookId !== request.params.bookId) return response.status(404).json({ error: "Bookmark was not found." });
      response.json({ bookmark });
    });

    this.app.delete("/api/books/:bookId/bookmarks/:bookmarkId", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const bookmark = this.context.database.listBookBookmarks(request.params.bookId, user.id).find((item) => item.id === request.params.bookmarkId);
      if (!bookmark) return response.status(404).json({ error: "Bookmark was not found." });
      this.context.database.deleteBookBookmark(bookmark.id, user.id);
      response.status(204).send();
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

    this.app.delete("/api/shelves/:shelfId", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      try {
        await this.context.libraryService.deleteShelf(user.id, request.params.shelfId);
        response.status(204).send();
      } catch (error) {
        this.sendHandledError(response, error);
      }
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

    this.app.delete("/api/shelves/:shelfId/books/:bookId", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      try {
        await this.context.libraryService.removeBookFromShelf(
          user.id,
          request.params.shelfId,
          request.params.bookId
        );
        response.status(204).send();
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
        return response.status(400).json({ error: "Role, status, or metadata access is required." });
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
      if (typeof parsed.data.metadataEditorEnabled === "boolean") {
        user = this.context.database.updateUserMetadataEditorEnabled(request.params.userId, parsed.data.metadataEditorEnabled);
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

    this.app.get("/media/books/:bookId/cover", async (request, response) => {
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book?.coverPath) {
        return response.status(404).send("Cover not found");
      }
      response.setHeader("Cache-Control", "private, max-age=86400");
      response.sendFile(book.coverPath);
    });

    this.app.post("/api/cast/media-token", async (request, response) => {
      const user = this.requireUser(request, response);
      if (!user) return;
      const parsed = castMediaTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: "A book is required." });
      }
      const book = await this.context.database.getBook(parsed.data.bookId);
      if (!book || (!book.audioPath && !book.audioTracks?.length)) {
        return response.status(404).json({ error: "Audio not found." });
      }
      if (!this.context.database.isBookInUserLibrary(user.id, book.id)) {
        return response.status(403).json({ error: "Add this book to your library before casting it." });
      }

      const expiresAt = Date.now() + CAST_TOKEN_TTL_MS;
      const token = this.createCastToken(user.id, book.id, expiresAt);
      const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
      const baseUrl = `${forwardedProto || request.protocol}://${request.get("host")}`;
      const audioUrl = this.castMediaUrl(baseUrl, book.id, token);
      const trackUrls = (book.audioTracks ?? []).map((_, trackIndex) =>
        this.castMediaUrl(baseUrl, book.id, token, trackIndex)
      );
      response.json({
        token,
        expiresAt: new Date(expiresAt).toISOString(),
        audioUrl,
        trackUrls
      });
    });

    this.app.get("/media/books/:bookId/audio", async (request, response) => {
      const user = await this.requireMediaUser(request, response, request.params.bookId);
      if (!user) return;
      const book = await this.context.database.getBook(request.params.bookId);
      if (!book || (!book.audioPath && !book.audioTracks?.length)) {
        return response.status(404).send("Audio not found");
      }
      const localAudioPath = this.localAudioPath(book);
      if (localAudioPath) {
        response.sendFile(localAudioPath);
        return;
      }
      if (!book.audioPath) {
        return response.status(404).send("Audio not found");
      }
      return response.status(404).send("Audio file is not available on the server");
    });

    this.app.get("/media/books/:bookId/audio/:trackIndex", async (request, response) => {
      const user = await this.requireMediaUser(request, response, request.params.bookId);
      if (!user) return;
      const book = await this.context.database.getBook(request.params.bookId);
      const trackIndex = Number(request.params.trackIndex);
      const track = Number.isInteger(trackIndex) && trackIndex >= 0 ? book?.audioTracks?.[trackIndex] : undefined;
      if (!track?.path) {
        return response.status(404).send("Audio track not found");
      }
      if (!existsSync(track.path)) {
        return response.status(404).send("Audio track is not available on the server");
      }
      response.sendFile(track.path);
    });

    this.app.use((_request, response) => {
      if (_request.path.startsWith("/api/")) {
        return response.status(404).json({ error: "API route not found." });
      }
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

  private localAudioPath(book: Book): string | undefined {
    for (const candidate of [book.audioPath]) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private async requireMediaUser(request: Request, response: Response, bookId: string): Promise<User | undefined> {
    const sessionUser = this.currentUser(request);
    if (sessionUser) {
      if (request.query.sample === "1") {
        const book = await this.context.database.getBook(bookId);
        if (book && !book.hidden) return sessionUser;
        response.status(404).json({ error: "Book was not found." });
        return undefined;
      }
      if (!this.context.database.isBookInUserLibrary(sessionUser.id, bookId)) {
        response.status(403).json({ error: "Add this book to your library before playing it." });
        return undefined;
      }
      return sessionUser;
    }
    const castUserId = this.verifyCastToken(String(request.query.castToken ?? ""), bookId);
    const castUser = castUserId ? this.context.database.getUserById(castUserId) : undefined;
    if (!castUser || castUser.status === "disabled") {
      response.status(401).json({ error: "Login required." });
      return undefined;
    }
    if (!this.context.database.isBookInUserLibrary(castUser.id, bookId)) {
      response.status(403).json({ error: "Add this book to your library before playing it." });
      return undefined;
    }
    return castUser;
  }

  private createCastToken(userId: string, bookId: string, expiresAt: number): string {
    const payload = Buffer.from(JSON.stringify({ userId, bookId, expiresAt })).toString("base64url");
    const signature = createHmac("sha256", this.castTokenSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private verifyCastToken(token: string, bookId: string): string | undefined {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return undefined;
    const expected = createHmac("sha256", this.castTokenSecret).update(payload).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "base64url");
    } catch {
      return undefined;
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        userId?: string;
        bookId?: string;
        expiresAt?: number;
      };
      if (!parsed.userId || parsed.bookId !== bookId || !parsed.expiresAt || parsed.expiresAt <= Date.now()) {
        return undefined;
      }
      return parsed.userId;
    } catch {
      return undefined;
    }
  }

  private castMediaUrl(baseUrl: string, bookId: string, token: string, trackIndex?: number): string {
    const suffix = trackIndex === undefined ? "audio" : `audio/${trackIndex}`;
    return `${baseUrl}/media/books/${encodeURIComponent(bookId)}/${suffix}?castToken=${encodeURIComponent(token)}`;
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

  private requireMetadataEditor(request: Request, response: Response): User | undefined {
    const user = this.requireUser(request, response);
    if (!user) {
      return undefined;
    }
    if (user.role !== "admin" && !user.metadataEditorEnabled) {
      response.status(403).json({ error: "Metadata editing is not enabled for this account." });
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

  private setSessionCookie(request: Request, response: Response, token: string, expiresAt: Date): void {
    const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
    response.cookie("story_stack_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.protocol === "https" || forwardedProto === "https",
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

}
