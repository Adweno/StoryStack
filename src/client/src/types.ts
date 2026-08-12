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
  audioTracks?: BookAudioTrack[];
  chapters?: BookChapter[];
  addedAt: string;
  hidden: boolean;
  inLibrary?: boolean;
  averageRating?: number;
  reviewCount?: number;
}

export interface BookAudioTrack {
  path: string;
  durationSeconds?: number;
}

export interface BookChapter {
  id: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
}

export interface BookBookmark {
  id: string;
  bookId: string;
  userId: string;
  positionSeconds: number;
  title: string;
  createdAt: string;
  updatedAt: string;
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
  lastLoginAt?: string;
  passwordConfigured?: boolean;
  passwordResetRequired?: boolean;
  theme: "dark" | "light";
  reviewsEnabled: boolean;
  metadataEditorEnabled: boolean;
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

export interface RemoteAccessSettings {
  mode: "local" | "manual" | "cloudflare" | "device";
  publicUrl: string;
  status: "not_configured" | "ready" | "warning";
  message: string;
  checkedAt?: string;
}
