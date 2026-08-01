import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/utils/logger";
import { safeGenerationLog } from "../safe-generation-log";

function generationSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : generationSources(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("legacy generation logging boundary", () => {
  afterEach(async () => {
    await logger.endSession();
    vi.restoreAllMocks();
  });

  it("has no direct console sink in production generation routes", () => {
    const root = resolve(process.cwd(), "src/app/api/generate");
    for (const file of generationSources(root)) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /console\.(?:log|warn|error|info|debug)\s*\(/,
      );
    }
  });

  it("drops raw provider bodies, URLs, credentials, and Error values", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await logger.startSession();
    const canaries = [
      "PROMPT_CANARY",
      "r8_api_key_canary",
      "Authorization: Bearer secret",
      "Cookie=session-secret",
      "https://signed.example/output?token=secret",
      JSON.stringify({ providerBody: "raw-provider-canary" }),
    ];

    safeGenerationLog.log(...canaries);
    safeGenerationLog.warn({ headers: canaries, responseBody: canaries[5] });
    safeGenerationLog.error(new Error(canaries.join(" ")), ...canaries);

    const serialized = JSON.stringify({
      entries: logger.getCurrentSession()?.entries,
      consoleError: consoleError.mock.calls,
      consoleLog: consoleLog.mock.calls,
      consoleWarn: consoleWarn.mock.calls,
    });
    for (const canary of canaries) expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain("raw-provider-canary");
  });
});
