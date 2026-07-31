export type UserRole = "admin" | "user";
export type UserTheme = "dark" | "light";
export type ListeningStatus = "not_started" | "in_progress" | "finished";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  status?: UserStatus;
  username?: string;
  email?: string;
  plexId?: string;
  lastLoginAt?: string;
  passwordConfigured?: boolean;
  passwordResetRequired?: boolean;
  theme: UserTheme;
  reviewsEnabled: boolean;
}

export type UserStatus = "active" | "disabled";

export interface UserInvite {
  id: string;
  token: string;
  email: string;
  role: UserRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedByUserId: string;
  createdAt: string;
  expiresAt?: string;
  acceptedAt?: string;
  acceptedByUserId?: string;
}

export interface Book {
  id: string;
  sourcePath: string;
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
}

export interface BookReview {
  id: string;
  bookId: string;
  userId: string;
  userName: string;
  rating: number;
  review: string;
  createdAt: string;
  updatedAt: string;
  isMine?: boolean;
}

export interface UserLibraryBook {
  userId: string;
  bookId: string;
  addedAt: string;
}

export interface Shelf {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

export interface ShelfBook {
  shelfId: string;
  bookId: string;
  position: number;
}

export interface PlaybackProgress {
  userId: string;
  bookId: string;
  positionSeconds: number;
  durationSeconds?: number;
  status: ListeningStatus;
  updatedAt: string;
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

export interface MetadataEnrichmentResult {
  scanned: number;
  matched: number;
  coversAdded: number;
  detailsAdded: number;
  errors: string[];
  finishedAt: string;
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
