import { createHash, randomUUID } from "node:crypto";

export class IdFactory {
  random(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }

  stableBookId(sourcePath: string): string {
    const hash = createHash("sha256").update(sourcePath.toLowerCase()).digest("hex").slice(0, 16);
    return `book_${hash}`;
  }
}
