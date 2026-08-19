import { describe, expect, it } from "vitest";
import { buildTrackPayload, isRetryableStatus, validateCredentials } from "../src/services/GooglePlayReleaseService";
import { parseArgs } from "../scripts/play-release";

describe("Google Play release tooling", () => {
  it("builds a localized track release payload", () => {
    expect(buildTrackPayload({ packageName: "com.example.app", track: "internal", versionCode: "12", releaseName: "Beta 1", releaseNotes: "Fixes" })).toEqual({
      releases: [{ name: "Beta 1", versionCodes: ["12"], status: "completed", releaseNotes: [{ language: "en-US", text: "Fixes" }] }],
    });
  });

  it("recognizes transient API failures", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
  });

  it("rejects incomplete credentials", () => {
    expect(() => validateCredentials({ client_email: "test@example.com" })).toThrow("client_email and private_key");
  });

  it("parses release arguments without requiring secrets for a dry run", () => {
    expect(parseArgs(["--track", "closed", "--notes", "Test release", "--dry-run"])).toMatchObject({ track: "closed", notes: "Test release", dryRun: true });
  });

  it("requires release notes", () => {
    expect(() => parseArgs(["--track", "internal"])).toThrow("Release notes are required");
  });

  it("accepts optional Google Group tester enrollment", () => {
    expect(parseArgs(["--track", "closed", "--notes", "Test release", "--tester-group", "testers@example.com"]).testerGoogleGroups).toEqual(["testers@example.com"]);
  });
});
