import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadXAdsAttributionConfig } from "../config";
import type { MarketingAttributionRepository } from "../repository";
import { MarketingAttributionService } from "../service";
import type { MarketingAttributionConsent, MarketingAttributionEvent } from "../types";
import type { XAdsConversionAdapter } from "../x-ads-adapter";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const config = loadXAdsAttributionConfig({ X_ADS_ATTRIBUTION_ENABLED: "true", X_ADS_API_VERSION: "12", X_ADS_PIXEL_ID: "pixel_1", X_ADS_API_KEY: "key", X_ADS_API_SECRET: "secret", X_ADS_ACCESS_TOKEN: "token", X_ADS_ACCESS_TOKEN_SECRET: "token-secret", X_ADS_EVENT_ID_SIGN_UP: "signup", X_ADS_EVENT_ID_TRIAL_STARTED: "trial", X_ADS_EVENT_ID_PURCHASE: "purchase", X_ADS_ACCOUNT_CURRENCY: "USD", NEXT_PUBLIC_PRIVACY_URL: "https://example.com/privacy", X_ADS_PRIVACY_NOTICE_VERSION: "privacy-1", X_ADS_REGION_REVIEW_VERSION: "region-1", X_ADS_API_ACCESS_REVIEW_VERSION: "access-1" });
const consent: MarketingAttributionConsent = { schema: "marketing-attribution-consent/v1", workspaceId: "workspace-1", userId: "user-1", provider: "x_ads", revision: 2, purpose: "advertising_attribution", status: "active", noticeVersion: "privacy-1", regionReviewVersion: "region-1", issuedAt: NOW, expiresAt: new Date(NOW.getTime() + 90 * 86_400_000) };

function setup() {
  const repository = {
    getConsent: vi.fn(async () => consent),
    counts: vi.fn(async () => ({ pending: 0, delivered: 0 })),
    setConsent: vi.fn(),
    enqueue: vi.fn(async (input) => ({ event: input, replayed: false })),
    claim: vi.fn(async () => null),
    consentStillAuthorizes: vi.fn(async () => true),
    cancelClaim: vi.fn(),
    delivered: vi.fn(),
    failed: vi.fn(),
    deleteExpired: vi.fn(),
  };
  const adapter = { deliver: vi.fn(async () => ({ processed: 1, debugId: "debug-1" })) };
  return { repository, adapter, service: new MarketingAttributionService(repository as unknown as MarketingAttributionRepository, config, adapter as unknown as XAdsConversionAdapter) };
}

describe("MarketingAttributionService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hashes normalized email before the durable outbox and pins a stable deduplication key", async () => {
    const { service, repository } = setup();
    await service.enqueue({ workspaceId: "workspace-1", userId: "user-1", email: " Person@Example.com ", eventName: "trial_started", occurredAt: NOW, idempotencyKey: "trial-command-123", now: NOW });
    const admitted = repository.enqueue.mock.calls[0]![0];
    expect(JSON.stringify(admitted)).not.toContain("Person@Example.com");
    expect(admitted.payload.identifiers).toEqual([{ hashed_email: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(admitted.payload.conversion_id).toMatch(/^mac_[a-f0-9]{64}$/);
    expect(admitted.consentRevision).toBe(2);
  });

  it("rejects value leakage outside purchase and validates purchase money", async () => {
    const { service } = setup();
    await expect(service.enqueue({ workspaceId: "workspace-1", userId: "user-1", email: "person@example.com", eventName: "sign_up", occurredAt: NOW, value: "1.00", currency: "USD", idempotencyKey: "signup-command-1", now: NOW })).rejects.toThrow("ATTRIBUTION_VALUE_NOT_ALLOWED");
    await expect(service.enqueue({ workspaceId: "workspace-1", userId: "user-1", email: "person@example.com", eventName: "purchase", occurredAt: NOW, value: "1.999", currency: "usd", idempotencyKey: "purchase-command-1", now: NOW })).rejects.toThrow("ATTRIBUTION_PURCHASE_VALUE_INVALID");
  });

  it("never backfills an event that predates the currently active consent revision", async () => {
    const { service } = setup();
    await expect(service.enqueue({ workspaceId: "workspace-1", userId: "user-1", email: "person@example.com", eventName: "trial_started", occurredAt: new Date(NOW.getTime() - 1), idempotencyKey: "pre-consent-event-1", now: NOW })).rejects.toThrow("ATTRIBUTION_CONSENT_REQUIRED");
  });

  it("rechecks the exact consent revision immediately before external delivery", async () => {
    const { service, repository, adapter } = setup();
    const job = { workspaceId: "workspace-1", id: `mae_${"a".repeat(32)}`, userId: "user-1", provider: "x_ads", eventName: "trial_started", conversionId: `mac_${"b".repeat(64)}`, consentRevision: 2, payload: { conversion_time: NOW.toISOString(), event_id: "trial", identifiers: [{ hashed_email: "c".repeat(64) }], conversion_id: `mac_${"b".repeat(64)}` }, state: "delivering", attempt: 1, maxAttempts: 6, nextAttemptAt: NOW, leaseOwner: "worker", leaseExpiresAt: new Date(NOW.getTime() + 60_000), failureCode: null, occurredAt: NOW, createdAt: NOW, updatedAt: NOW, finishedAt: null, expiresAt: new Date(NOW.getTime() + 30 * 86_400_000) } satisfies MarketingAttributionEvent;
    (repository.claim as ReturnType<typeof vi.fn>).mockResolvedValueOnce(job).mockResolvedValueOnce(null);
    repository.consentStillAuthorizes.mockResolvedValue(false);
    const result = await service.dispatch(2, NOW);
    expect(result.cancelled).toBe(1);
    expect(repository.consentStillAuthorizes).toHaveBeenCalledWith(job, NOW, "privacy-1", "region-1");
    expect(repository.cancelClaim).toHaveBeenCalledWith(job, NOW, "CONSENT_NOT_ACTIVE");
    expect(adapter.deliver).not.toHaveBeenCalled();
  });

  it("allows revocation even while the provider is unconfigured", async () => {
    const repository = setup().repository;
    repository.setConsent.mockResolvedValue({ consent: { ...consent, status: "revoked" }, replayed: false, scrubbedPendingEvents: 3 });
    const disabled = new MarketingAttributionService(repository as unknown as MarketingAttributionRepository, loadXAdsAttributionConfig({}), {} as XAdsConversionAdapter);
    await disabled.setConsent({ workspaceId: "workspace-1", userId: "user-1", status: "revoked", expiresAt: NOW, idempotencyKey: "revoke-command-1", now: NOW });
    expect(repository.setConsent).toHaveBeenCalledWith(expect.objectContaining({ status: "revoked" }));
  });
});
