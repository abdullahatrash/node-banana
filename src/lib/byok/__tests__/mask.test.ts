import { describe, expect, it } from "vitest";
import { maskProviderKey } from "../mask";

describe("maskProviderKey", () => {
  it("keeps a short recognizable prefix and last 4 chars for a typical key", () => {
    expect(maskProviderKey("sk-abcdefghijklmnopqrstuvwxyzabc4")).toBe(
      "sk-…abc4",
    );
  });

  it("masks a Gemini-style key the same way", () => {
    expect(maskProviderKey("AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe")).toBe(
      "AIz…ewQe",
    );
  });

  it("never reveals more than the mask for very short keys", () => {
    const hint = maskProviderKey("short1");
    expect(hint).not.toContain("short1");
    expect(hint).toBe("••••••");
  });

  it("never contains the raw key as a substring for any input", () => {
    const raw = "sk-test-1234567890abcdef";
    expect(maskProviderKey(raw)).not.toContain(raw);
  });
});
