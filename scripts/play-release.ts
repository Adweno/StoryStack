#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GooglePlayReleaseService, validateCredentials } from "../src/services/GooglePlayReleaseService.js";

const DEFAULT_PACKAGE_NAME = "com.storystack.story_stack_mobile";
const DEFAULT_BUNDLE = "mobile/story_stack_mobile/build/app/outputs/bundle/release/app-release.aab";

interface CliOptions {
  bundle: string;
  packageName: string;
  track: string;
  notes: string;
  releaseName?: string;
  credentials: string;
  testerGoogleGroups: string[];
  dryRun: boolean;
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    bundle: process.env.PLAY_BUNDLE_PATH ?? DEFAULT_BUNDLE,
    packageName: process.env.PLAY_PACKAGE_NAME ?? DEFAULT_PACKAGE_NAME,
    track: process.env.PLAY_TRACK ?? "internal",
    notes: process.env.PLAY_RELEASE_NOTES ?? "",
    releaseName: process.env.PLAY_RELEASE_NAME,
    credentials: process.env.PLAY_SERVICE_ACCOUNT_FILE ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
    testerGoogleGroups: process.env.PLAY_TESTER_GOOGLE_GROUPS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [],
    dryRun: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--bundle") options.bundle = valueAfter(args, index++, arg);
    else if (arg === "--package") options.packageName = valueAfter(args, index++, arg);
    else if (arg === "--track") options.track = valueAfter(args, index++, arg);
    else if (arg === "--notes") options.notes = valueAfter(args, index++, arg);
    else if (arg === "--name") options.releaseName = valueAfter(args, index++, arg);
    else if (arg === "--credentials") options.credentials = valueAfter(args, index++, arg);
    else if (arg === "--tester-group") options.testerGoogleGroups.push(valueAfter(args, index++, arg));
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run play:release -- --track internal --notes \"What changed\" [--name \"Release name\"]");
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.notes.trim()) throw new Error("Release notes are required. Use --notes or PLAY_RELEASE_NOTES.");
  if (!options.track.trim()) throw new Error("A Play track is required.");
  if (!options.packageName.trim()) throw new Error("A package name is required.");
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const bundlePath = path.resolve(options.bundle);
  const bundle = await readFile(bundlePath);
  if (options.dryRun) {
    console.log(`Validated bundle: ${bundlePath} (${bundle.byteLength} bytes)`);
    console.log(`Target: ${options.packageName} / ${options.track}`);
    return;
  }
  if (!options.credentials) throw new Error("Credentials are required. Set PLAY_SERVICE_ACCOUNT_FILE to a service-account JSON file outside the repository.");
  const credentialsPath = path.resolve(options.credentials);
  if (credentialsPath.startsWith(`${path.resolve(".")}${path.sep}`)) {
    throw new Error("Refusing to read Play credentials from inside the repository. Store them outside the project.");
  }
  const credentials = validateCredentials(JSON.parse(await readFile(credentialsPath, "utf8")));
  const result = await new GooglePlayReleaseService(credentials).publishBundle(bundle, {
    packageName: options.packageName,
    track: options.track,
    versionCode: "0",
    releaseName: options.releaseName,
    releaseNotes: options.notes,
    testerGoogleGroups: options.testerGoogleGroups,
  });
  console.log(`Published version ${result.versionCode} to ${options.track}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
