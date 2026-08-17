import type { Book } from "../domain/types";
import { cleanMetadataDescription, type ExternalMetadataProvider, type MetadataCandidate } from "./ExternalMetadataProvider";

const AUDIBLE_CATALOG_URL = "https://api.audible.com/1.0/catalog/products";

/** Best-effort lookup against Audible's public catalog endpoint. */
export class AudibleMetadataProvider implements ExternalMetadataProvider {
  constructor(private readonly fetcher: Fetcher = (...args) => fetch(...args)) {}

  async find(book: Book): Promise<MetadataCandidate | undefined> {
    const query = book.title;
    const responseGroups = "contributors,product_desc,product_extended_attrs,product_attrs,category_ladders";
    const url = `${AUDIBLE_CATALOG_URL}?keywords=${encodeURIComponent(query)}&num_results=10&products_sort_by=Relevance&response_groups=${responseGroups}`;
    const response = await this.fetcher(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Audible lookup failed for ${book.title}.`);
    }
    const data = (await response.json()) as AudibleResponse;
    const product = data.products?.find((item) => isLikelyMatch(book, item));
    return product ? toCandidate(product) : undefined;
  }
}

function isLikelyMatch(book: Book, product: AudibleProduct): boolean {
  const title = normalize(book.title);
  const candidate = normalize(product.title);
  if (!candidate || !(candidate.includes(title) || title.includes(candidate))) return false;
  if (!book.author || normalize(book.author) === "unknown author") return true;
  const sourceAuthorTokens = authorTokens(book.author);
  if (sourceAuthorTokens.length === 0) return true;
  return product.authors?.some((item) => {
    const candidateAuthorTokens = authorTokens(item.name);
    return sourceAuthorTokens.some((token) => candidateAuthorTokens.includes(token));
  }) ?? false;
}

function authorTokens(value = ""): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !["and", "the"].includes(token));
}

function toCandidate(product: AudibleProduct): MetadataCandidate {
  return {
    title: product.title,
    subtitle: product.subtitle,
    author: product.authors?.map((item) => item.name).join(", "),
    narrator: product.narrators?.map((item) => item.name).join(", "),
    description: cleanMetadataDescription(product.publisher_summary),
    genres: product.category_ladders
      ?.flatMap((group) => group.ladder.map((item) => item.name))
      .filter(Boolean),
    publicationYear: parseYear(product.release_date),
    coverUrl: product.product_images?.['500'] ?? audibleCoverUrl(product.asin),
    sourceUrl: product.web_url
  };
}

function audibleCoverUrl(asin?: string): string | undefined {
  return asin ? `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg` : undefined;
}

function normalize(value = ""): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseYear(value?: string): number | undefined {
  const year = value?.match(/\d{4}/)?.[0];
  return year ? Number(year) : undefined;
}

type Fetcher = typeof fetch;

interface AudibleResponse {
  products?: AudibleProduct[];
}

interface AudibleProduct {
  asin?: string;
  title: string;
  subtitle?: string;
  authors?: Array<{ name: string }>;
  narrators?: Array<{ name: string }>;
  publisher_summary?: string;
  release_date?: string;
  web_url?: string;
  product_images?: Record<string, string>;
  category_ladders?: Array<{ ladder: Array<{ name: string }> }>;
}
