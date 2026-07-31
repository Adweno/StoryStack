export interface Book {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  narrator?: string;
  series?: string;
  seriesOrder?: number;
  description?: string;
  genres: string[];
  durationSeconds?: number;
  publicationYear?: number;
  coverPath?: string;
  audioPath?: string;
  plexKey?: string;
  plexPartKey?: string;
  plexFile?: string;
  addedAt: string;
  hidden: boolean;
  inLibrary?: boolean;
}

export interface Shelf {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

export interface PlaybackProgress {
  userId: string;
  bookId: string;
  positionSeconds: number;
  durationSeconds?: number;
  status: "not_started" | "in_progress" | "finished";
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  role: "admin" | "user";
  status?: "active" | "disabled";
  username?: string;
  email?: string;
  plexId?: string;
  lastLoginAt?: string;
}

export interface UserInvite {
  id: string;
  token: string;
  email: string;
  role: "admin" | "user";
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedByUserId: string;
  createdAt: string;
  expiresAt?: string;
  acceptedAt?: string;
  acceptedByUserId?: string;
}

export interface MetadataEnrichmentResult {
  scanned: number;
  matched: number;
  coversAdded: number;
  detailsAdded: number;
  errors: string[];
  finishedAt: string;
}

export interface SyncResult {
  scanned: number;
  imported: number;
  updated: number;
  removed: number;
  errors: string[];
  finishedAt: string;
  path?: string;
}

export interface CatalogSettings {
  libraryPath: string;
}

export interface PlexSettings {
  serverUrl: string;
  sectionKey: string;
}

export interface PlexLibrarySection {
  key: string;
  title: string;
  type: string;
  locations: string[];
}

export interface PlexMatchResult {
  scanned: number;
  matched: number;
  unmatched: number;
  errors: string[];
  finishedAt: string;
}

export interface RemoteAccessSettings {
  mode: "local" | "manual" | "cloudflare";
  publicUrl: string;
  status: "not_configured" | "ready" | "warning";
  message: string;
  checkedAt?: string;
}
