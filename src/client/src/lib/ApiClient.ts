import type {
  Book,
  CatalogSettings,
  MetadataEnrichmentResult,
  PlaybackProgress,
  PlexLibrarySection,
  PlexMatchResult,
  PlexSettings,
  RemoteAccessSettings,
  Shelf,
  SyncResult,
  User,
  UserInvite
} from "../types";

export class ApiClient {
  async login(username: string, password: string): Promise<User> {
    const data = await this.post<{ user: User }>("/api/auth/login", { username, password });
    return data.user;
  }

  async startPlexLogin(): Promise<PlexPin> {
    const data = await this.post<{ pin: PlexPin }>("/api/auth/plex/start", {});
    return data.pin;
  }

  async pollPlexLogin(pinId: number): Promise<{ pending: true } | { user: User }> {
    return this.post("/api/auth/plex/poll", { pinId });
  }

  async logout(): Promise<void> {
    await this.request("/api/logout", { method: "POST" });
  }

  async me(): Promise<User> {
    return this.get<User>("/api/me");
  }

  async store(query = ""): Promise<Book[]> {
    const data = await this.get<{ books: Book[] }>(`/api/store?q=${encodeURIComponent(query)}`);
    return data.books;
  }

  async library(): Promise<{ books: Book[]; progress: PlaybackProgress[] }> {
    return this.get("/api/library");
  }

  async shelves(): Promise<Shelf[]> {
    const data = await this.get<{ shelves: Shelf[] }>("/api/shelves");
    return data.shelves;
  }

  async shelfBooks(shelfId: string): Promise<Book[]> {
    const data = await this.get<{ books: Book[] }>(`/api/shelves/${encodeURIComponent(shelfId)}/books`);
    return data.books;
  }

  async addToLibrary(bookId: string): Promise<void> {
    await this.post("/api/library", { bookId });
  }

  async removeFromLibrary(bookId: string): Promise<void> {
    await this.request(`/api/library/${encodeURIComponent(bookId)}`, { method: "DELETE" });
  }

  async createShelf(name: string): Promise<Shelf> {
    const data = await this.post<{ shelf: Shelf }>("/api/shelves", { name });
    return data.shelf;
  }

  async addBookToShelf(shelfId: string, bookId: string): Promise<void> {
    await this.post(`/api/shelves/${encodeURIComponent(shelfId)}/books`, { bookId });
  }

  async enrichMetadata(): Promise<MetadataEnrichmentResult> {
    const data = await this.post<{ result: MetadataEnrichmentResult }>("/api/admin/metadata/enrich", {});
    return data.result;
  }

  async catalogSettings(): Promise<{ settings: CatalogSettings; latestSync?: SyncResult }> {
    return this.get("/api/admin/catalog");
  }

  async saveCatalogSettings(settings: CatalogSettings): Promise<CatalogSettings> {
    const data = await this.post<{ settings: CatalogSettings }>("/api/admin/catalog", settings);
    return data.settings;
  }

  async syncCatalog(libraryPath: string): Promise<SyncResult> {
    const data = await this.post<{ result: SyncResult }>("/api/admin/catalog/sync", { libraryPath });
    return data.result;
  }

  async plexSettings(): Promise<PlexSettings> {
    const data = await this.get<{ settings: PlexSettings }>("/api/admin/plex");
    return data.settings;
  }

  async savePlexSettings(settings: PlexSettings): Promise<PlexSettings> {
    const data = await this.post<{ settings: PlexSettings }>("/api/admin/plex", settings);
    return data.settings;
  }

  async plexSections(serverUrl: string): Promise<PlexLibrarySection[]> {
    const data = await this.get<{ sections: PlexLibrarySection[] }>(`/api/admin/plex/sections?serverUrl=${encodeURIComponent(serverUrl)}`);
    return data.sections;
  }

  async matchPlexMedia(): Promise<PlexMatchResult> {
    const data = await this.post<{ result: PlexMatchResult }>("/api/admin/plex/match", {});
    return data.result;
  }

  async users(): Promise<User[]> {
    const data = await this.get<{ users: User[] }>("/api/admin/users");
    return data.users;
  }

  async createUser(input: { name: string; email: string; role: "admin" | "user" }): Promise<User> {
    const data = await this.post<{ user: User }>("/api/admin/users", input);
    return data.user;
  }

  async updateUserRole(userId: string, role: "admin" | "user"): Promise<User> {
    return this.updateUser(userId, { role });
  }

  async updateUserStatus(userId: string, status: "active" | "disabled"): Promise<User> {
    return this.updateUser(userId, { status });
  }

  async updateUser(userId: string, patch: { role?: "admin" | "user"; status?: "active" | "disabled" }): Promise<User> {
    const data = await this.request<{ user: User }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    return data.user;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }

  async saveProgress(bookId: string, positionSeconds: number, durationSeconds?: number): Promise<void> {
    await this.post("/api/progress", { bookId, positionSeconds, durationSeconds });
  }

  async invites(): Promise<UserInvite[]> {
    const data = await this.get<{ invites: UserInvite[] }>("/api/admin/invites");
    return data.invites;
  }

  async createInvite(input: { email: string; role: "admin" | "user"; expiresInDays?: number }): Promise<UserInvite> {
    const data = await this.post<{ invite: UserInvite }>("/api/admin/invites", input);
    return data.invite;
  }

  async revokeInvite(inviteId: string): Promise<void> {
    await this.request(`/api/admin/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
  }

  async invite(token: string): Promise<Pick<UserInvite, "email" | "role" | "expiresAt">> {
    const data = await this.get<{ invite: Pick<UserInvite, "email" | "role" | "expiresAt"> }>(`/api/invites/${encodeURIComponent(token)}`);
    return data.invite;
  }

  async acceptInvite(token: string, input: { name: string; password: string }): Promise<User> {
    const data = await this.post<{ user: User }>(`/api/invites/${encodeURIComponent(token)}/accept`, input);
    return data.user;
  }

  async remoteAccessSettings(): Promise<RemoteAccessSettings> {
    const data = await this.get<{ settings: RemoteAccessSettings }>("/api/admin/remote-access");
    return data.settings;
  }

  async saveRemoteAccessSettings(settings: { mode: RemoteAccessSettings["mode"]; publicUrl: string }): Promise<RemoteAccessSettings> {
    const data = await this.post<{ settings: RemoteAccessSettings }>("/api/admin/remote-access", settings);
    return data.settings;
  }

  private async get<T>(url: string): Promise<T> {
    const response = await fetch(url);
    return this.parse<T>(response);
  }

  private async post<T = unknown>(url: string, body: unknown): Promise<T> {
    return this.request<T>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  private async request<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    return this.parse<T>(response);
  }

  private async parse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Request failed.");
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}

export interface PlexPin {
  id: number;
  code: string;
  authUrl: string;
}
