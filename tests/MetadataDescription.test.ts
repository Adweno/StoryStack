import { describe, expect, it } from "vitest";
import { cleanMetadataDescription } from "../src/services/ExternalMetadataProvider";

describe("cleanMetadataDescription", () => {
  it("converts provider HTML into readable text", () => {
    expect(cleanMetadataDescription("<b>Ready</b><br/><i>Player</i> &amp; more")).toBe("Ready\nPlayer & more");
  });

  it("returns undefined for empty markup", () => {
    expect(cleanMetadataDescription("<br/><p></p>")).toBeUndefined();
  });
});
