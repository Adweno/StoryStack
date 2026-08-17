import type { Book } from "../domain/types";

export interface MetadataCandidate {
  title?: string;
  subtitle?: string;
  author?: string;
  narrator?: string;
  description?: string;
  genres?: string[];
  publicationYear?: number;
  coverUrl?: string;
  sourceUrl?: string;
  provider?: string;
}

/** Convert provider rich text into readable plain text before it reaches the UI or database. */
export function cleanMetadataDescription(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = decodeHtmlEntities(
    value
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*\/\s*(p|div|li|blockquote)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || undefined;
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };
  return value.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return entities[body.toLowerCase()] ?? entity;
  });
}

export interface ExternalMetadataProvider {
  find(book: Book): Promise<MetadataCandidate | undefined>;
}
