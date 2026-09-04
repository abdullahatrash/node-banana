import { describe, expect, it, vi } from "vitest";
import { loadXAdsAttributionConfig } from "../config";
import { MarketingAttributionCommercialReconciler, type MarketingAttributionCommercialSourcePort } from "../commercial-reconciliation";
import type { MarketingAttributionService } from "../service";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const config = loadXAdsAttributionConfig({ X_ADS_ATTRIBUTION_ENABLED: "true", X_ADS_API_VERSION: "12", X_ADS_PIXEL_ID: "pixel_1", X_ADS_API_KEY: "key", X_ADS_API_SECRET: "secret", X_ADS_ACCESS_TOKEN: "token", X_ADS_ACCESS_TOKEN_SECRET: "token-secret", X_ADS_EVENT_ID_SIGN_UP: "signup", X_ADS_EVENT_ID_TRIAL_STARTED: "trial", X_ADS_EVENT_ID_PURCHASE: "purchase", X_ADS_ACCOUNT_CURRENCY: "USD", NEXT_PUBLIC_PRIVACY_URL: "https://example.com/privacy", X_ADS_PRIVACY_NOTICE_VERSION: "privacy-1", X_ADS_REGION_REVIEW_VERSION: "region-1", X_ADS_API_ACCESS_REVIEW_VERSION: "access-1" });

describe("commercial marketing-attribution reconciliation", () => {
  it("recovers missing trial and purchase producers from exact durable source facts", async () => {
    const listEligible = vi.fn(async () => [
      { workspaceId: "workspace-1", userId: "user-1", email: "person@example.com", eventName: "trial_started" as const, occurredAt: NOW, value: null, currency: null, idempotencyKey: "xads:trial:event-1" },
      { workspaceId: "workspace-1", userId: "user-1", email: "person@example.com", eventName: "purchase" as const, occurredAt: NOW, value: "49.00", currency: "USD", idempotencyKey: "xads:purchase:merchant:event-2" },
    ]);
    const enqueue = vi.fn().mockResolvedValueOnce({ replayed: false }).mockResolvedValueOnce({ replayed: true });
    const reconciler = new MarketingAttributionCommercialReconciler({ listEligible } satisfies MarketingAttributionCommercialSourcePort, { enqueue } as unknown as MarketingAttributionService, config);
    await expect(reconciler.reconcile(25, NOW)).resolves.toEqual({ eligible: 2, queued: 1, replayed: 1, noLongerEligible: 0, failed: 0, skipped: null });
    expect(listEligible).toHaveBeenCalledWith({ now: NOW, oldestAt: new Date(NOW.getTime() - 7 * 86_400_000), noticeVersion: "privacy-1", regionReviewVersion: "region-1", limit: 25 });
    expect(enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ eventName: "trial_started", value: undefined, currency: undefined, now: NOW }));
    expect(enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ eventName: "purchase", value: "49.00", currency: "USD", now: NOW }));
  });

  it("does not read commercial sources while attribution is disabled", async () => {
    const listEligible = vi.fn();
    const reconciler = new MarketingAttributionCommercialReconciler({ listEligible } satisfies MarketingAttributionCommercialSourcePort, { enqueue: vi.fn() } as unknown as MarketingAttributionService, loadXAdsAttributionConfig({}));
    await expect(reconciler.reconcile(100, NOW)).resolves.toMatchObject({ eligible: 0, skipped: "ATTRIBUTION_NOT_CONFIGURED" });
    expect(listEligible).not.toHaveBeenCalled();
  });
});
