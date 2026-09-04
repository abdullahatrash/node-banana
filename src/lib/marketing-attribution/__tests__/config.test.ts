import { describe, expect, it } from "vitest";
import { evaluateXAdsAttributionReadiness, loadXAdsAttributionConfig } from "../config";

const configured = { X_ADS_ATTRIBUTION_ENABLED: "true", X_ADS_API_VERSION: "12", X_ADS_PIXEL_ID: "pixel_1", X_ADS_API_KEY: "key", X_ADS_API_SECRET: "secret", X_ADS_ACCESS_TOKEN: "token", X_ADS_ACCESS_TOKEN_SECRET: "token-secret", X_ADS_EVENT_ID_SIGN_UP: "signup", X_ADS_EVENT_ID_TRIAL_STARTED: "trial", X_ADS_EVENT_ID_PURCHASE: "purchase", X_ADS_ACCOUNT_CURRENCY: "USD", NEXT_PUBLIC_PRIVACY_URL: "https://example.com/privacy", X_ADS_PRIVACY_NOTICE_VERSION: "privacy-2026-09", X_ADS_REGION_REVIEW_VERSION: "mena-transfer-2026-09", X_ADS_API_ACCESS_REVIEW_VERSION: "ads-role-2026-09" };

describe("X Ads attribution configuration", () => {
  it("fails closed and reports every missing control without exposing secrets", () => {
    const readiness = evaluateXAdsAttributionReadiness(loadXAdsAttributionConfig({}));
    expect(readiness.available).toBe(false);
    expect(readiness.browserPixelLoaded).toBe(false);
    expect(readiness.blockers).toContain("OPERATOR_DISABLED");
    expect(readiness.blockers).toContain("OAUTH_CREDENTIALS_MISSING");
    expect(JSON.stringify(readiness)).not.toContain("accessToken");
  });

  it("becomes available only with distinct credentials and review evidence", () => {
    const readiness = evaluateXAdsAttributionReadiness(loadXAdsAttributionConfig(configured));
    expect(readiness).toMatchObject({ available: true, deliveryMode: "server_conversion_api", privacyNoticeUrl: "https://example.com/privacy" });
    expect(readiness.blockers).toEqual([]);
  });

  it("does not accept social-publishing X credentials as ad credentials", () => {
    const readiness = evaluateXAdsAttributionReadiness(loadXAdsAttributionConfig({ ...configured, X_ADS_API_KEY: "", X_ADS_API_SECRET: "", X_API_KEY: "publisher", X_API_SECRET: "publisher-secret" }));
    expect(readiness.blockers).toContain("OAUTH_CREDENTIALS_MISSING");
  });
});
