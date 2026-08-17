import type { Book } from "../domain/types";
import { cleanMetadataDescription, type ExternalMetadataProvider, type MetadataCandidate } from "./ExternalMetadataProvider";

const GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes";

export class GoogleBooksMetadataProvider implements ExternalMetadataProvider {
  constructor(private readonly fetcher: Fetcher = (...args) => fetch(...args)) {}

  async find(book: Book): Promise<MetadataCandidate | undefined> {
    const query = this.buildQuery(book);
    const url = `${GOOGLE_BOOKS_URL}?q=${encodeURIComponent(query)}&maxResults=5&printType=books`;
    const response = await this.fetcher(url);
    if (!response.ok) {
      throw new Error(`Google Books lookup failed for ${book.title}.`);
    }
    const data = (await response.json()) as GoogleBooksResponse;
    const item = data.items?.find((candidate) => this.isLikelyMatch(book, candidate.volumeInfo)) ?? data.items?.[0];
    return item ? this.toCandidate(item.volumeInfo) : undefined;
  }

  private buildQuery(book: Book): string {
    return `intitle:${quote(book.title)}`;
  }

  private isLikelyMatch(book: Book, volume: GoogleVolumeInfo): boolean {
    const sourceTitle = normalize(book.title);
    const candidateTitle = normalize(volume.title);
    const titleMatches = candidateTitle.includes(sourceTitle) || sourceTitle.includes(candidateTitle);
    if (isMissingAuthor(book.author)) {
      return titleMatches;
    }
    const authorTokens = normalize(book.author)
      .split(" ")
      .filter((token) => token.length >= 3 && !["and", "the"].includes(token));
    const authorMatches = volume.authors?.some((candidate) => {
      const candidateTokens = normalize(candidate).split(" ");
      return authorTokens.some((token) => candidateTokens.includes(token));
    });
    return titleMatches && Boolean(authorMatches);
  }

  private toCandidate(volume: GoogleVolumeInfo): MetadataCandidate {
    return {
      title: volume.title,
      subtitle: volume.subtitle,
      author: volume.authors?.join(", "),
      description: cleanMetadataDescription(volume.description),
      genres: volume.categories ?? (volume.mainCategory ? [volume.mainCategory] : undefined),
      publicationYear: parseYear(volume.publishedDate),
      coverUrl: bestCoverUrl(volume.imageLinks),
      provider: "Google Books"
    };
  }
}

function quote(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

function normalize(value = ""): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isMissingAuthor(author: string): boolean {
  return normalize(author) === "" || normalize(author) === "unknown author";
}

function parseYear(value?: string): number | undefined {
  const year = value?.match(/\d{4}/)?.[0];
  return year ? Number(year) : undefined;
}

function bestCoverUrl(imageLinks?: GoogleImageLinks): string | undefined {
  const url = imageLinks?.extraLarge ?? imageLinks?.large ?? imageLinks?.medium ?? imageLinks?.small ?? imageLinks?.thumbnail ?? imageLinks?.smallThumbnail;
  return url?.replace(/^http:/, "https:");
}

type Fetcher = typeof fetch;

interface GoogleBooksResponse {
  items?: Array<{ volumeInfo: GoogleVolumeInfo }>;
}

interface GoogleVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  categories?: string[];
  mainCategory?: string;
  publishedDate?: string;
  imageLinks?: GoogleImageLinks;
}

interface GoogleImageLinks {
  smallThumbnail?: string;
  thumbnail?: string;
  small?: string;
  medium?: string;
  large?: string;
  extraLarge?: string;
}
