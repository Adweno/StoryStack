import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  Book,
  CatalogSettings,
  PlaybackProgress,
  PlexSettings,
  RemoteAccessSettings,
  Shelf,
  ShelfBook,
  SyncResult,
  User,
  UserInvite,
  UserLibraryBook,
  UserRole,
  UserStatus
} from "../domain/types";
import type { LibraryRepository } from "../services/LibraryService";
import { PasswordHasher } from "../services/PasswordHasher";

export class StoryStackDatabase implements LibraryRepository {
  private readonly database: DatabaseSync;

  constructor(databasePath = "./data/story-stack.sqlite") {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.seedUsers();
  }

  listUsers(): User[] {
    return (this.database
      .prepare("SELECT id, name, role, status, username, email, plexId, lastLoginAt, passwordHash, passwordResetRequired FROM users ORDER BY name")
      .all() as unknown as UserRow[]).map((row) => this.toUser(row));
  }

  createManagedUser(input: { name: string; email: string; role: UserRole }): User {
    const id = `manual_${input.email.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    this.database
      .prepare(
        `INSERT INTO users (id, name, role, status, username, email, plexId)
         VALUES (?, ?, ?, 'active', ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          username = excluded.username,
          email = excluded.email`
      )
      .run(id, input.name, input.role, input.email, input.email);
    const user = this.getUserById(id);
    if (!user) {
      throw new Error("User could not be saved.");
    }
    return user;
  }

  createInvite(input: { email: string; role: UserRole; invitedByUserId: string; expiresAt?: string }): UserInvite {
    const now = new Date().toISOString();
    const invite: UserInvite = {
      id: `invite_${randomBytes(12).toString("hex")}`,
      token: randomBytes(24).toString("hex"),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      status: "pending",
      invitedByUserId: input.invitedByUserId,
      createdAt: now,
      expiresAt: input.expiresAt
    };
    this.database
      .prepare(
        `INSERT INTO user_invites (id, token, email, role, status, invitedByUserId, createdAt, expiresAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(invite.id, invite.token, invite.email, invite.role, invite.status, invite.invitedByUserId, invite.createdAt, invite.expiresAt ?? null);
    return invite;
  }

  listInvites(now = new Date().toISOString()): UserInvite[] {
    this.expireInvites(now);
    return (this.database.prepare("SELECT * FROM user_invites ORDER BY createdAt DESC").all() as unknown as UserInviteRow[]).map((row) =>
      this.toInvite(row)
    );
  }

  getInviteByToken(token: string, now = new Date().toISOString()): UserInvite | undefined {
    this.expireInvites(now);
    const row = this.database.prepare("SELECT * FROM user_invites WHERE token = ?").get(token) as UserInviteRow | undefined;
    return row ? this.toInvite(row) : undefined;
  }

  acceptInvite(input: { token: string; name: string; password: string }, now = new Date().toISOString()): User {
    const invite = this.getInviteByToken(input.token, now);
    if (!invite || invite.status !== "pending") {
      throw new Error("Invite is no longer available.");
    }
    const id = `manual_${invite.email.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const hasher = new PasswordHasher();
    this.database
      .prepare(
        `INSERT INTO users (id, name, role, status, username, passwordHash, email, plexId)
         VALUES (?, ?, ?, 'active', ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          status = 'active',
          username = excluded.username,
          passwordHash = excluded.passwordHash,
          email = excluded.email`
      )
      .run(id, input.name.trim(), invite.role, invite.email, hasher.hash(input.password), invite.email);
    this.database
      .prepare("UPDATE user_invites SET status = 'accepted', acceptedAt = ?, acceptedByUserId = ? WHERE token = ?")
      .run(now, id, input.token);
    const user = this.getUserById(id);
    if (!user) {
      throw new Error("User could not be activated.");
    }
    return user;
  }

  revokeInvite(inviteId: string): void {
    this.database.prepare("UPDATE user_invites SET status = 'revoked' WHERE id = ? AND status = 'pending'").run(inviteId);
  }

  updateUserRole(userId: string, role: UserRole): User {
    this.database.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error("User was not found.");
    }
    return user;
  }

  updateUserStatus(userId: string, status: UserStatus): User {
    this.database.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, userId);
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error("User was not found.");
    }
    return user;
  }

  deleteUser(userId: string): void {
    this.database.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }

  getDefaultUser(): User {
    const row = this.database
      .prepare("SELECT id, name, role, status, username, email, plexId, lastLoginAt, passwordHash, passwordResetRequired FROM users ORDER BY role LIMIT 1")
      .get() as UserRow | undefined;
    if (!row) {
      throw new Error("Default user was not created.");
    }
    return this.toUser(row);
  }

  getUserById(userId: string): User | undefined {
    const row = this.database
      .prepare("SELECT id, name, role, status, username, email, plexId, lastLoginAt, passwordHash, passwordResetRequired FROM users WHERE id = ?")
      .get(userId) as UserRow | undefined;
    return row ? this.toUser(row) : undefined;
  }

  getUserCredentials(username: string): UserCredentials | undefined {
    return this.database
      .prepare("SELECT id, name, role, status, username, email, passwordHash, passwordResetRequired FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)")
      .get(username, username) as UserCredentials | undefined;
  }

  getUserPasswordHash(userId: string): string | undefined {
    const row = this.database.prepare("SELECT passwordHash FROM users WHERE id = ?").get(userId) as { passwordHash: string | null } | undefined;
    return row?.passwordHash ?? undefined;
  }

  isPasswordResetRequired(userId: string): boolean {
    const row = this.database.prepare("SELECT passwordResetRequired FROM users WHERE id = ?").get(userId) as { passwordResetRequired: number } | undefined;
    return Boolean(row?.passwordResetRequired);
  }

  setUserPassword(userId: string, password: string, options: { resetRequired?: boolean } = {}): User {
    const hasher = new PasswordHasher();
    this.database
      .prepare("UPDATE users SET passwordHash = ?, passwordResetRequired = ? WHERE id = ?")
      .run(hasher.hash(password), options.resetRequired ? 1 : 0, userId);
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error("User was not found.");
    }
    return user;
  }

  recordLastLogin(userId: string, now = new Date().toISOString()): void {
    this.database.prepare("UPDATE users SET lastLoginAt = ? WHERE id = ?").run(now, userId);
  }

  createSession(session: UserSession): void {
    this.database
      .prepare("INSERT INTO user_sessions (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)")
      .run(session.token, session.userId, session.expiresAt, session.createdAt);
  }

  getSessionUser(token: string, now = new Date().toISOString()): User | undefined {
    const row = this.database
      .prepare(
        `SELECT u.id, u.name, u.role, u.status, u.username, u.email, u.plexId, u.lastLoginAt, u.passwordHash, u.passwordResetRequired
         FROM user_sessions s
         JOIN users u ON u.id = s.userId
         WHERE s.token = ? AND s.expiresAt > ? AND COALESCE(u.status, 'active') = 'active'`
      )
      .get(token, now) as UserRow | undefined;
    if (!row) {
      this.database.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
    }
    return row ? this.toUser(row) : undefined;
  }

  upsertPlexUser(input: { plexId: string; email: string; name: string; role: "admin" | "user"; plexToken: string }): User {
    const existing = this.database
      .prepare("SELECT id FROM users WHERE lower(email) = lower(?) OR plexId = ?")
      .get(input.email, input.plexId) as { id: string } | undefined;
    const id = existing?.id ?? `plex_${input.plexId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    this.database
      .prepare(
        `INSERT INTO users (id, name, role, status, username, passwordHash, email, plexId, plexToken)
         VALUES (?, ?, ?, 'active', ?, NULL, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          status = 'active',
          username = excluded.username,
          email = excluded.email,
          plexId = excluded.plexId,
          plexToken = excluded.plexToken`
      )
      .run(id, input.name, input.role, input.email, input.email, input.plexId, input.plexToken);
    const user = this.getUserById(id);
    if (!user) {
      throw new Error("Plex user could not be saved.");
    }
    return user;
  }

  deleteSession(token: string): void {
    this.database.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
  }

  async getBook(bookId: string): Promise<Book | undefined> {
    const row = this.database.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as BookRow | undefined;
    return row ? this.toBook(row) : undefined;
  }

  listBooks(): Book[] {
    return (this.database.prepare("SELECT * FROM books ORDER BY title").all() as unknown as BookRow[]).map((row) => this.toBook(row));
  }

  listVisibleBooks(): Book[] {
    return (this.database.prepare("SELECT * FROM books WHERE hidden = 0 ORDER BY title").all() as unknown as BookRow[]).map((row) =>
      this.toBook(row)
    );
  }

  upsertBook(book: Book): BookUpsertResult {
    const existing = this.database.prepare("SELECT id FROM books WHERE id = ? OR sourcePath = ?").get(book.id, book.sourcePath) as
      | { id: string }
      | undefined;
    const targetBook = existing && existing.id !== book.id ? { ...book, id: existing.id } : book;
    this.database
      .prepare(
        `INSERT INTO books (
          id, sourcePath, title, subtitle, author, narrator, series, seriesOrder, description, genres,
          durationSeconds, publicationYear, coverPath, audioPath, plexKey, plexPartKey, plexFile, addedAt, hidden
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          sourcePath = excluded.sourcePath,
          title = excluded.title,
          subtitle = excluded.subtitle,
          author = excluded.author,
          narrator = excluded.narrator,
          series = excluded.series,
          seriesOrder = excluded.seriesOrder,
          description = excluded.description,
          genres = excluded.genres,
          durationSeconds = excluded.durationSeconds,
          publicationYear = excluded.publicationYear,
          coverPath = excluded.coverPath,
          audioPath = excluded.audioPath,
          plexKey = COALESCE(books.plexKey, excluded.plexKey),
          plexPartKey = COALESCE(books.plexPartKey, excluded.plexPartKey),
          plexFile = COALESCE(books.plexFile, excluded.plexFile),
          hidden = excluded.hidden`
      )
      .run(
        targetBook.id,
        targetBook.sourcePath,
        targetBook.title,
        targetBook.subtitle ?? null,
        targetBook.author,
        targetBook.narrator ?? null,
        targetBook.series ?? null,
        targetBook.seriesOrder ?? null,
        targetBook.description ?? null,
        JSON.stringify(targetBook.genres),
        targetBook.durationSeconds ?? null,
        targetBook.publicationYear ?? null,
        targetBook.coverPath ?? null,
        targetBook.audioPath ?? null,
        targetBook.plexKey ?? null,
        targetBook.plexPartKey ?? null,
        targetBook.plexFile ?? null,
        targetBook.addedAt,
        targetBook.hidden ? 1 : 0
      );
    return { id: targetBook.id, status: existing ? "updated" : "imported" };
  }

  setHidden(bookId: string, hidden: boolean): void {
    this.database.prepare("UPDATE books SET hidden = ? WHERE id = ?").run(hidden ? 1 : 0, bookId);
  }

  getUserPlexToken(userId: string): string | undefined {
    const row = this.database.prepare("SELECT plexToken FROM users WHERE id = ?").get(userId) as { plexToken?: string | null } | undefined;
    return row?.plexToken ?? undefined;
  }

  getPlexSettings(): PlexSettings {
    return {
      serverUrl: this.getSetting("plex.serverUrl") ?? process.env.STORY_STACK_PLEX_SERVER_URL ?? "",
      sectionKey: this.getSetting("plex.sectionKey") ?? process.env.STORY_STACK_PLEX_SECTION_KEY ?? ""
    };
  }

  savePlexSettings(settings: PlexSettings): PlexSettings {
    this.setSetting("plex.serverUrl", settings.serverUrl.replace(/\/$/, ""));
    this.setSetting("plex.sectionKey", settings.sectionKey);
    return this.getPlexSettings();
  }

  getCatalogSettings(): CatalogSettings {
    return {
      libraryPath: this.getSetting("catalog.libraryPath") ?? process.env.STORY_STACK_LIBRARY_PATH ?? ""
    };
  }

  saveCatalogSettings(settings: CatalogSettings): CatalogSettings {
    this.setSetting("catalog.libraryPath", settings.libraryPath.trim());
    return this.getCatalogSettings();
  }

  getRemoteAccessSettings(): RemoteAccessSettings {
    const publicUrl = this.getSetting("remote.publicUrl") ?? process.env.STORY_STACK_PUBLIC_URL ?? "";
    const mode = (this.getSetting("remote.mode") ?? (publicUrl ? "manual" : "local")) as RemoteAccessSettings["mode"];
    return this.evaluateRemoteAccess({ mode, publicUrl });
  }

  saveRemoteAccessSettings(input: { mode: RemoteAccessSettings["mode"]; publicUrl: string }): RemoteAccessSettings {
    this.setSetting("remote.mode", input.mode);
    this.setSetting("remote.publicUrl", input.publicUrl.trim().replace(/\/$/, ""));
    this.setSetting("remote.checkedAt", new Date().toISOString());
    return this.getRemoteAccessSettings();
  }

  updateBookPlexMatch(bookId: string, match: BookPlexMatch): void {
    this.database
      .prepare("UPDATE books SET plexKey = ?, plexPartKey = ?, plexFile = ? WHERE id = ?")
      .run(match.plexKey, match.plexPartKey, match.plexFile, bookId);
  }

  updateBookMetadata(bookId: string, patch: BookMetadataPatch): void {
    const updates: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [field, value] of Object.entries(patch)) {
      updates.push(`${field} = ?`);
      values.push(field === "genres" ? JSON.stringify(value) : value ?? null);
    }
    if (updates.length === 0) {
      return;
    }
    this.database.prepare(`UPDATE books SET ${updates.join(", ")} WHERE id = ?`).run(...values, bookId);
  }

  replaceVisibleCatalog(activeBookIds: string[]): number {
    const activeIds = new Set(activeBookIds);
    const visibleRows = this.database.prepare("SELECT id FROM books WHERE hidden = 0").all() as unknown as { id: string }[];
    const removed = visibleRows.filter((row) => !activeIds.has(row.id)).length;
    this.database.prepare("UPDATE books SET hidden = 1 WHERE hidden = 0").run();
    for (let index = 0; index < activeBookIds.length; index += 500) {
      const batch = activeBookIds.slice(index, index + 500);
      const placeholders = batch.map(() => "?").join(", ");
      this.database.prepare(`UPDATE books SET hidden = 0 WHERE id IN (${placeholders})`).run(...batch);
    }
    return removed;
  }

  saveSyncResult(result: SyncResult): void {
    this.database
      .prepare("INSERT INTO sync_jobs (finishedAt, scanned, imported, updated, removed, errors) VALUES (?, ?, ?, ?, ?, ?)")
      .run(result.finishedAt, result.scanned, result.imported, result.updated, result.removed, JSON.stringify(result.errors));
  }

  getLatestSync(): SyncResult | undefined {
    const row = this.database.prepare("SELECT * FROM sync_jobs ORDER BY id DESC LIMIT 1").get() as SyncRow | undefined;
    return row
      ? {
          finishedAt: row.finishedAt,
          scanned: row.scanned,
          imported: row.imported,
          updated: row.updated,
          removed: row.removed,
          errors: JSON.parse(row.errors) as string[]
        }
      : undefined;
  }

  async listLibraryBooks(userId: string): Promise<UserLibraryBook[]> {
    return this.database
      .prepare("SELECT userId, bookId, addedAt FROM user_library_books WHERE userId = ? ORDER BY addedAt DESC")
      .all(userId) as unknown as UserLibraryBook[];
  }

  listLibraryBookDetails(userId: string): Book[] {
    return (
      this.database
        .prepare(
          `SELECT b.* FROM books b
           JOIN user_library_books ulb ON ulb.bookId = b.id
           WHERE ulb.userId = ?
           ORDER BY ulb.addedAt DESC`
        )
        .all(userId) as unknown as BookRow[]
    ).map((row) => this.toBook(row));
  }

  async addLibraryBook(entry: UserLibraryBook): Promise<void> {
    this.database
      .prepare("INSERT OR IGNORE INTO user_library_books (userId, bookId, addedAt) VALUES (?, ?, ?)")
      .run(entry.userId, entry.bookId, entry.addedAt);
  }

  async removeLibraryBook(userId: string, bookId: string): Promise<void> {
    this.database.prepare("DELETE FROM shelf_books WHERE bookId = ? AND shelfId IN (SELECT id FROM shelves WHERE userId = ?)").run(bookId, userId);
    this.database.prepare("DELETE FROM user_library_books WHERE userId = ? AND bookId = ?").run(userId, bookId);
  }

  async listShelves(userId: string): Promise<Shelf[]> {
    return this.database.prepare("SELECT id, userId, name, createdAt FROM shelves WHERE userId = ? ORDER BY createdAt").all(userId) as unknown as Shelf[];
  }

  async createShelf(shelf: Shelf): Promise<void> {
    this.database.prepare("INSERT INTO shelves (id, userId, name, createdAt) VALUES (?, ?, ?, ?)").run(
      shelf.id,
      shelf.userId,
      shelf.name,
      shelf.createdAt
    );
  }

  async deleteShelf(userId: string, shelfId: string): Promise<void> {
    this.database.prepare("DELETE FROM shelves WHERE userId = ? AND id = ?").run(userId, shelfId);
  }

  async addBookToShelf(entry: ShelfBook): Promise<void> {
    this.database
      .prepare("INSERT OR IGNORE INTO shelf_books (shelfId, bookId, position) VALUES (?, ?, ?)")
      .run(entry.shelfId, entry.bookId, entry.position);
  }

  async removeBookFromShelf(shelfId: string, bookId: string): Promise<void> {
    this.database.prepare("DELETE FROM shelf_books WHERE shelfId = ? AND bookId = ?").run(shelfId, bookId);
  }

  async listShelfBooks(shelfId: string): Promise<ShelfBook[]> {
    return this.database.prepare("SELECT shelfId, bookId, position FROM shelf_books WHERE shelfId = ? ORDER BY position").all(shelfId) as unknown as ShelfBook[];
  }

  listShelfBookDetails(userId: string, shelfId: string): Book[] {
    return (
      this.database
        .prepare(
          `SELECT b.* FROM books b
           JOIN shelf_books sb ON sb.bookId = b.id
           JOIN shelves s ON s.id = sb.shelfId
           WHERE s.userId = ? AND s.id = ?
           ORDER BY sb.position`
        )
        .all(userId, shelfId) as unknown as BookRow[]
    ).map((row) => this.toBook(row));
  }

  async upsertProgress(progress: PlaybackProgress): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO playback_progress (userId, bookId, positionSeconds, durationSeconds, status, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(userId, bookId) DO UPDATE SET
          positionSeconds = excluded.positionSeconds,
          durationSeconds = excluded.durationSeconds,
          status = excluded.status,
          updatedAt = excluded.updatedAt`
      )
      .run(
        progress.userId,
        progress.bookId,
        progress.positionSeconds,
        progress.durationSeconds ?? null,
        progress.status,
        progress.updatedAt
      );
  }

  listProgress(userId: string): PlaybackProgress[] {
    return this.database
      .prepare("SELECT userId, bookId, positionSeconds, durationSeconds, status, updatedAt FROM playback_progress WHERE userId = ?")
      .all(userId) as unknown as PlaybackProgress[];
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
        username TEXT UNIQUE,
        passwordHash TEXT,
        passwordResetRequired INTEGER NOT NULL DEFAULT 0,
        email TEXT,
        plexId TEXT,
        lastLoginAt TEXT,
        plexToken TEXT
      );

      CREATE TABLE IF NOT EXISTS user_invites (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'revoked', 'expired')),
        invitedByUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        createdAt TEXT NOT NULL,
        expiresAt TEXT,
        acceptedAt TEXT,
        acceptedByUserId TEXT REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        sourcePath TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        subtitle TEXT,
        author TEXT NOT NULL,
        narrator TEXT,
        series TEXT,
        seriesOrder REAL,
        description TEXT,
        genres TEXT NOT NULL,
        durationSeconds REAL,
        publicationYear INTEGER,
        coverPath TEXT,
        audioPath TEXT,
        plexKey TEXT,
        plexPartKey TEXT,
        plexFile TEXT,
        addedAt TEXT NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_library_books (
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        addedAt TEXT NOT NULL,
        PRIMARY KEY (userId, bookId)
      );

      CREATE TABLE IF NOT EXISTS shelves (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shelf_books (
        shelfId TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
        bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY (shelfId, bookId)
      );

      CREATE TABLE IF NOT EXISTS playback_progress (
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        positionSeconds REAL NOT NULL,
        durationSeconds REAL,
        status TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (userId, bookId)
      );

      CREATE TABLE IF NOT EXISTS sync_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        finishedAt TEXT NOT NULL,
        scanned INTEGER NOT NULL,
        imported INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        removed INTEGER NOT NULL,
        errors TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
      CREATE INDEX IF NOT EXISTS idx_library_user ON user_library_books(userId);
      CREATE INDEX IF NOT EXISTS idx_shelves_user ON shelves(userId);
      CREATE INDEX IF NOT EXISTS idx_progress_user ON playback_progress(userId);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(userId);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expiresAt);
      CREATE INDEX IF NOT EXISTS idx_invites_token ON user_invites(token);
      CREATE INDEX IF NOT EXISTS idx_invites_status ON user_invites(status);
    `);
    this.addColumnIfMissing("users", "username", "TEXT");
    this.addColumnIfMissing("users", "passwordHash", "TEXT");
    this.addColumnIfMissing("users", "passwordResetRequired", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("users", "email", "TEXT");
    this.addColumnIfMissing("users", "plexId", "TEXT");
    this.addColumnIfMissing("users", "plexToken", "TEXT");
    this.addColumnIfMissing("users", "status", "TEXT NOT NULL DEFAULT 'active'");
    this.addColumnIfMissing("users", "lastLoginAt", "TEXT");
    this.addColumnIfMissing("books", "plexKey", "TEXT");
    this.addColumnIfMissing("books", "plexPartKey", "TEXT");
    this.addColumnIfMissing("books", "plexFile", "TEXT");
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private seedUsers(): void {
    const hasher = new PasswordHasher();
    const configuredAdminPassword = process.env.STORY_STACK_ADMIN_PASSWORD?.trim() || undefined;
    const configuredUserPassword = process.env.STORY_STACK_USER_PASSWORD?.trim() || undefined;
    const adminHash = hasher.hash(configuredAdminPassword ?? "admin");
    const userHash = hasher.hash(configuredUserPassword ?? "user");
    const demoUser = this.database.prepare("SELECT id FROM users WHERE id = 'user_demo'").get();
    if (demoUser) {
      this.database
        .prepare(
          `UPDATE users SET
            name = 'Admin',
            role = 'admin',
            status = 'active',
            username = COALESCE(username, 'admin'),
            passwordHash = ${configuredAdminPassword ? "?" : "COALESCE(passwordHash, ?)"}
           WHERE id = 'user_demo'`
        )
        .run(adminHash);
    } else {
      this.database
        .prepare(
          `INSERT INTO users (id, name, role, status, username, passwordHash)
           VALUES (?, ?, ?, 'active', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
            passwordHash = ${configuredAdminPassword ? "excluded.passwordHash" : "users.passwordHash"}`
        )
        .run("user_admin", "Admin", "admin", "admin", adminHash);
    }
    this.database
      .prepare(
        `INSERT INTO users (id, name, role, status, username, passwordHash)
         VALUES (?, ?, ?, 'active', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          passwordHash = ${configuredUserPassword ? "excluded.passwordHash" : "users.passwordHash"}`
      )
      .run("user_reader", "Reader", "user", "user", userHash);
  }

  private toBook(row: BookRow): Book {
    return {
      id: row.id,
      sourcePath: row.sourcePath,
      title: row.title,
      subtitle: row.subtitle ?? undefined,
      author: row.author,
      narrator: row.narrator ?? undefined,
      series: row.series ?? undefined,
      seriesOrder: row.seriesOrder ?? undefined,
      description: row.description ?? undefined,
      genres: JSON.parse(row.genres) as string[],
      durationSeconds: row.durationSeconds ?? undefined,
      publicationYear: row.publicationYear ?? undefined,
      coverPath: row.coverPath ?? undefined,
      audioPath: row.audioPath ?? undefined,
      plexKey: row.plexKey ?? undefined,
      plexPartKey: row.plexPartKey ?? undefined,
      plexFile: row.plexFile ?? undefined,
      addedAt: row.addedAt,
      hidden: Boolean(row.hidden)
    };
  }

  private getSetting(key: string): string | undefined {
    const row = this.database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setSetting(key: string, value: string): void {
    this.database.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  private expireInvites(now: string): void {
    this.database.prepare("UPDATE user_invites SET status = 'expired' WHERE status = 'pending' AND expiresAt IS NOT NULL AND expiresAt <= ?").run(now);
  }

  private toInvite(row: UserInviteRow): UserInvite {
    return {
      id: row.id,
      token: row.token,
      email: row.email,
      role: row.role,
      status: row.status,
      invitedByUserId: row.invitedByUserId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt ?? undefined,
      acceptedAt: row.acceptedAt ?? undefined,
      acceptedByUserId: row.acceptedByUserId ?? undefined
    };
  }

  private toUser(row: UserRow): User {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      status: row.status,
      username: row.username ?? undefined,
      email: row.email ?? undefined,
      plexId: row.plexId ?? undefined,
      lastLoginAt: row.lastLoginAt ?? undefined,
      passwordConfigured: Boolean(row.passwordHash),
      passwordResetRequired: Boolean(row.passwordResetRequired)
    };
  }

  private evaluateRemoteAccess(input: { mode: RemoteAccessSettings["mode"]; publicUrl: string }): RemoteAccessSettings {
    const publicUrl = input.publicUrl.trim().replace(/\/$/, "");
    const checkedAt = this.getSetting("remote.checkedAt");
    if (input.mode === "local") {
      return { mode: "local", publicUrl, status: "not_configured", message: "Local-only access is enabled.", checkedAt };
    }
    if (!publicUrl) {
      return { mode: input.mode, publicUrl, status: "not_configured", message: "Add a public HTTPS address before inviting remote users.", checkedAt };
    }
    if (isPrivateUrl(publicUrl)) {
      return {
        mode: input.mode,
        publicUrl,
        status: "warning",
        message: "This address looks local. Use a public HTTPS address for access from any network.",
        checkedAt
      };
    }
    if (!publicUrl.startsWith("https://")) {
      return { mode: input.mode, publicUrl, status: "warning", message: "Use HTTPS before sharing Story Stack outside your network.", checkedAt };
    }
    return { mode: input.mode, publicUrl, status: "ready", message: "Remote access address is ready to share.", checkedAt };
  }
}

interface BookRow {
  id: string;
  sourcePath: string;
  title: string;
  subtitle: string | null;
  author: string;
  narrator: string | null;
  series: string | null;
  seriesOrder: number | null;
  description: string | null;
  genres: string;
  durationSeconds: number | null;
  publicationYear: number | null;
  coverPath: string | null;
  audioPath: string | null;
  plexKey: string | null;
  plexPartKey: string | null;
  plexFile: string | null;
  addedAt: string;
  hidden: number;
}

interface SyncRow {
  finishedAt: string;
  scanned: number;
  imported: number;
  updated: number;
  removed: number;
  errors: string;
}

interface UserInviteRow {
  id: string;
  token: string;
  email: string;
  role: UserRole;
  status: UserInvite["status"];
  invitedByUserId: string;
  createdAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
}

interface UserRow {
  id: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  username: string | null;
  email: string | null;
  plexId: string | null;
  lastLoginAt: string | null;
  passwordHash: string | null;
  passwordResetRequired: number;
}

export interface BookUpsertResult {
  id: string;
  status: "imported" | "updated";
}

export interface BookMetadataPatch {
  subtitle?: string;
  author?: string;
  description?: string;
  genres?: string[];
  publicationYear?: number;
  coverPath?: string;
}

export interface BookPlexMatch {
  plexKey: string;
  plexPartKey: string;
  plexFile: string;
}

export interface UserCredentials extends User {
  username: string;
  passwordHash: string;
}

export interface UserSession {
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

function isPrivateUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return true;
  }
}
