import { describe, expect, it } from "vitest";
import { hasConfiguredSecret, readConfiguredSecret } from "../configured-secret";

describe("configured secret detection", () => {
  it.each([
    undefined,
    null,
    "",
    "   ",
    "your_replicate_api_key_here",
    "YOUR-API-TOKEN-HERE",
    "replace_me",
    "change-me",
    "<replicate-token>",
    "${REPLICATE_API_KEY}",
  ])("rejects missing and placeholder values: %s", (value) => {
    expect(readConfiguredSecret(value)).toBeNull();
    expect(hasConfiguredSecret(value)).toBe(false);
  });

  it.each([
    "r8_live_token",
    "test-replicate-key",
    "a-real-looking-secret-value",
  ])("preserves non-placeholder values without logging or transforming them: %s", (value) => {
    expect(readConfiguredSecret(`  ${value}  `)).toBe(value);
    expect(hasConfiguredSecret(value)).toBe(true);
  });
});
