import { describe, expect, it, vi } from "vitest";
import { loadXAdsAttributionConfig } from "../config";
import { normalizeAndHashEmail, normalizeTwclid, XAdsConversionAdapter } from "../x-ads-adapter";

const config = loadXAdsAttributionConfig({ X_ADS_API_VERSION: "12", X_ADS_PIXEL_ID: "pixel_1", X_ADS_API_KEY: "key", X_ADS_API_SECRET: "secret", X_ADS_ACCESS_TOKEN: "token", X_ADS_ACCESS_TOKEN_SECRET: "token-secret" });
const payload = { conversion_time: "2026-09-04T12:00:00.000Z", event_id: "signup", identifiers: [{ hashed_email: "a".repeat(64) }], conversion_id: `mac_${"b".repeat(64)}` };

describe("X Ads conversion adapter", () => {
  it("normalizes and hashes email before persistence or delivery", () => {
    expect(normalizeAndHashEmail("  Test@X.com ")).toBe("5806dc6b2f04fb728708a8f7b81c14edcd4fba36f77914cf0c9368d9a3a25f76");
    expect(() => normalizeAndHashEmail("not-an-email")).toThrow("ATTRIBUTION_EMAIL_INVALID");
    expect(normalizeTwclid(" abc_123 ")).toBe("abc_123");
    expect(normalizeTwclid("bad click id")).toBeNull();
  });

  it("pins the official HTTPS host and validates processed count", async () => {
    const send = vi.fn(async () => ({ data: { conversions_processed: 1, debug_id: "debug-1" } }));
    const result = await new XAdsConversionAdapter(config, { send }).deliver(payload);
    expect(send).toHaveBeenCalledWith("https://ads-api.x.com/12/measurement/conversions/pixel_1", { conversions: [payload] });
    expect(result).toEqual({ processed: 1, debugId: "debug-1" });
  });

  it("distinguishes definitive rejection from unknown delivery outcome", async () => {
    await expect(new XAdsConversionAdapter(config, { send: vi.fn(async () => { throw { code: 400 }; }) }).deliver(payload)).rejects.toMatchObject({ code: "X_ADS_REQUEST_REJECTED", retryable: false, outcomeUnknown: false });
    await expect(new XAdsConversionAdapter(config, { send: vi.fn(async () => { throw { code: 503 }; }) }).deliver(payload)).rejects.toMatchObject({ code: "X_ADS_TEMPORARILY_UNAVAILABLE", retryable: true, outcomeUnknown: true });
    await expect(new XAdsConversionAdapter(config, { send: vi.fn(async () => { throw new Error("socket reset"); }) }).deliver(payload)).rejects.toMatchObject({ code: "X_ADS_DELIVERY_OUTCOME_UNKNOWN", retryable: true, outcomeUnknown: true });
  });
});
