import { existsSync, readFileSync } from "node:fs";

export class EnvFileLoader {
  load(filePath = ".env"): void {
    if (!existsSync(filePath)) {
      return;
    }

    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (!parsed || process.env[parsed.key] !== undefined) {
        continue;
      }
      process.env[parsed.key] = parsed.value;
    }
  }

  private parseLine(line: string): EnvEntry | undefined {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return undefined;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      return undefined;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!/^[A-Z0-9_]+$/i.test(key)) {
      return undefined;
    }

    return { key, value: this.unquote(rawValue) };
  }

  private unquote(value: string): string {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }
}

interface EnvEntry {
  key: string;
  value: string;
}
