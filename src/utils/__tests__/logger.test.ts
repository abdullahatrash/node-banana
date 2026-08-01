import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/utils/logger";

describe("operational logger leakage boundary", () => {
  afterEach(async () => {
    await logger.endSession();
    vi.restoreAllMocks();
  });

  it("stores and consoles only allowlisted low-cardinality fields", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    await logger.startSession();

    const canaries = [
      "PROMPT_CANARY",
      "sk-secret-value",
      "Authorization: Bearer private",
      "Cookie=session-secret",
      "https://signed.example/private?token=secret",
      "/Users/private/workflow.json",
      "provider response body",
    ];
    const cyclic: Record<string, unknown> = {
      prompt: canaries[0],
      apiKey: canaries[1],
      headers: { authorization: canaries[2], cookie: canaries[3] },
      url: canaries[4],
      filePath: canaries[5],
      responseBody: canaries[6],
      provider: "openai",
      status: "failed",
      code: "PROVIDER_FAILED",
      attempt: 2,
      retryCount: 1,
      success: false,
      arbitrary: "nested-string-must-drop",
    };
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, "dangerousGetter", {
      enumerable: true,
      get: () => {
        throw new Error("getter-canary");
      },
    });

    logger.error(
      "api.error",
      `Provider failed ${canaries.join(" ")}`,
      cyclic,
      new Error(`stack ${canaries.join(" ")}`),
    );

    const entry = logger.getCurrentSession()?.entries.at(-1);
    expect(entry).toEqual({
      timestamp: expect.any(String),
      level: "error",
      category: "api.error",
      message: "Operational event.",
      context: {
        provider: "openai",
        status: "failed",
        code: "PROVIDER_FAILED",
        attempt: 2,
        retryCount: 1,
        success: false,
      },
    });
    const serialized = JSON.stringify({
      entry,
      consoleError: consoleError.mock.calls,
      consoleLog: consoleLog.mock.calls,
    });
    for (const canary of [...canaries, "nested-string-must-drop", "getter-canary"]) {
      expect(serialized).not.toContain(canary);
    }
    expect(consoleError).toHaveBeenLastCalledWith(entry);
  });

  it("drops strings that merely look like enum values under arbitrary keys", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await logger.startSession();
    logger.info("system", "ignored", {
      arbitrary: "openai",
      provider: "unexpected-secret-provider",
      code: "not-a-safe-code",
      count: Number.POSITIVE_INFINITY,
    });

    expect(logger.getCurrentSession()?.entries.at(-1)).not.toHaveProperty(
      "context",
    );
  });
});
