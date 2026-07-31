// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnvFileLoader } from "../src/services/EnvFileLoader";

const touchedKeys = ["STORY_STACK_TEST_HOST", "STORY_STACK_TEST_PORT"];

afterEach(() => {
  for (const key of touchedKeys) {
    delete process.env[key];
  }
});

describe("EnvFileLoader", () => {
  it("loads simple key-value config from an env file", async () => {
    const folder = path.join(os.tmpdir(), `story-stack-env-${crypto.randomUUID()}`);
    const envPath = path.join(folder, ".env");
    await mkdir(folder, { recursive: true });
    await writeFile(envPath, "STORY_STACK_TEST_HOST=0.0.0.0\nSTORY_STACK_TEST_PORT=\"4100\"\n");

    new EnvFileLoader().load(envPath);

    expect(process.env.STORY_STACK_TEST_HOST).toBe("0.0.0.0");
    expect(process.env.STORY_STACK_TEST_PORT).toBe("4100");
  });

  it("does not overwrite environment values that already exist", async () => {
    const folder = path.join(os.tmpdir(), `story-stack-env-${crypto.randomUUID()}`);
    const envPath = path.join(folder, ".env");
    process.env.STORY_STACK_TEST_PORT = "5000";
    await mkdir(folder, { recursive: true });
    await writeFile(envPath, "STORY_STACK_TEST_PORT=4100\n");

    new EnvFileLoader().load(envPath);

    expect(process.env.STORY_STACK_TEST_PORT).toBe("5000");
  });
});
