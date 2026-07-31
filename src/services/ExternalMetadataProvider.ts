import type { Book } from "../domain/types";

export interface MetadataCandidate {
  title?: string;
  subtitle?: string;
  author?: string;
  description?: string;
  genres?: string[];
  publicationYear?: number;
  coverUrl?: string;
}

export interface ExternalMetadataProvider {
  find(book: Book): Promise<MetadataCandidate | undefined>;
}
