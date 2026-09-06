import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { XAdsAttributionConfig } from "./config";
import { evaluateXAdsAttributionReadiness } from "./config";
import { MarketingAttributionRepository } from "./repository";
import type { MarketingAttributionEventName, XAdsConversionPayload } from "./types";
import { normalizeAndHashEmail, normalizeTwclid, XAdsConversionAdapter, XAdsDeliveryError } from "./x-ads-adapter";

const DAY = 86_400_000;

export class MarketingAttributionService {
  constructor(private readonly repository: MarketingAttributionRepository, private readonly config: XAdsAttributionConfig, private readonly adapter: XAdsConversionAdapter) {}

  async status(workspaceId: string, userId: string, now = new Date()) {
    const [consent, counts] = await Promise.all([this.repository.getConsent(workspaceId, userId), this.repository.counts(workspaceId, userId)]);
    const readiness = evaluateXAdsAttributionReadiness(this.config);
    return { schema: "marketing-attribution-status/v1" as const, readiness, consent, active: Boolean(readiness.available && consent?.status === "active" && consent.expiresAt > now && consent.noticeVersion === readiness.noticeVersion && consent.regionReviewVersion === readiness.regionReviewVersion), counts };
  }

  setConsent(input: { workspaceId: string; userId: string; status: "active" | "revoked"; expiresAt: Date; idempotencyKey: string; now?: Date }) {
    const now = input.now ?? new Date();
    const readiness = evaluateXAdsAttributionReadiness(this.config);
    if (input.status === "active" && !readiness.available) throw new TypeError("ATTRIBUTION_NOT_CONFIGURED");
    if (!Number.isFinite(input.expiresAt.getTime()) || input.status === "active" && (input.expiresAt <= now || input.expiresAt > new Date(now.getTime() + 366 * DAY))) throw new TypeError("ATTRIBUTION_CONSENT_EXPIRY_INVALID");
    return this.repository.setConsent({ workspaceId: input.workspaceId, userId: input.userId, status: input.status, noticeVersion: this.config.noticeVersion || "revoked-unconfigured", regionReviewVersion: this.config.regionReviewVersion || "revoked-unconfigured", expiresAt: input.status === "revoked" ? new Date(now.getTime() + 1) : input.expiresAt, idempotencyKey: input.idempotencyKey, now });
  }

  async enqueue(input: { workspaceId: string; userId: string; email?: string | null; twclid?: string | null; eventName: MarketingAttributionEventName; occurredAt: Date; value?: string; currency?: string; idempotencyKey: string; now?: Date }) {
    const now = input.now ?? new Date();
    const readiness = evaluateXAdsAttributionReadiness(this.config);
    if (!readiness.available) throw new TypeError("ATTRIBUTION_NOT_CONFIGURED");
    if (!Number.isFinite(input.occurredAt.getTime()) || input.occurredAt > new Date(now.getTime() + 60_000) || input.occurredAt < new Date(now.getTime() - 7 * DAY)) throw new TypeError("ATTRIBUTION_EVENT_TIME_INVALID");
    const current = await this.repository.getConsent(input.workspaceId, input.userId);
    if (!current || current.status !== "active" || current.expiresAt <= now || current.noticeVersion !== this.config.noticeVersion || current.regionReviewVersion !== this.config.regionReviewVersion) throw new TypeError("ATTRIBUTION_CONSENT_REQUIRED");
    if (input.occurredAt < current.issuedAt) throw new TypeError("ATTRIBUTION_CONSENT_REQUIRED");
    const identifiers: XAdsConversionPayload["identifiers"] = [];
    const clickId = normalizeTwclid(input.twclid); if (clickId) identifiers.push({ twclid: clickId });
    if (input.email) identifiers.push({ hashed_email: normalizeAndHashEmail(input.email) });
    if (!identifiers.length) throw new TypeError("ATTRIBUTION_IDENTIFIER_REQUIRED");
    if (input.eventName === "purchase") {
      if (!input.value || !/^\d{1,9}(?:\.\d{1,2})?$/.test(input.value) || input.currency !== this.config.accountCurrency) throw new TypeError("ATTRIBUTION_PURCHASE_VALUE_INVALID");
    } else if (input.value || input.currency) throw new TypeError("ATTRIBUTION_VALUE_NOT_ALLOWED");
    const conversionId = `mac_${createHash("sha256").update(`x_ads:${input.workspaceId}:${input.userId}:${input.idempotencyKey}`).digest("hex")}`;
    const payload: XAdsConversionPayload = { conversion_time: input.occurredAt.toISOString(), event_id: this.config.eventIds[input.eventName], identifiers, conversion_id: conversionId, ...(input.eventName === "purchase" ? { value: input.value } : {}) };
    return this.repository.enqueue({ workspaceId: input.workspaceId, userId: input.userId, eventName: input.eventName, payload, consentRevision: current.revision, idempotencyKey: input.idempotencyKey, now, expiresAt: new Date(Math.min(current.expiresAt.getTime(), now.getTime() + this.config.eventRetentionDays * DAY)) });
  }

  async dispatch(limit = 20, now = new Date()) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("ATTRIBUTION_LIMIT_INVALID");
    const readiness = evaluateXAdsAttributionReadiness(this.config);
    if (!readiness.available) return { claimed: 0, delivered: 0, retried: 0, terminal: 0, cancelled: 0, skipped: "ATTRIBUTION_NOT_CONFIGURED" };
    const summary = { claimed: 0, delivered: 0, retried: 0, terminal: 0, cancelled: 0, skipped: null as string | null };
    const workerId = `xads_${randomUUID()}`;
    for (let index = 0; index < limit; index += 1) {
      const job = await this.repository.claim(workerId, now, this.config.receiptRetentionDays); if (!job) break;
      summary.claimed += 1;
      if (!await this.repository.consentStillAuthorizes(job, now, this.config.noticeVersion, this.config.regionReviewVersion)) { await this.repository.cancelClaim(job, now, "CONSENT_NOT_ACTIVE"); summary.cancelled += 1; continue; }
      try { const result = await this.adapter.deliver(job.payload); await this.repository.delivered(job, result, now, this.config.receiptRetentionDays); summary.delivered += 1; }
      catch (error) {
        const failure = error instanceof XAdsDeliveryError ? error : new XAdsDeliveryError("X_ADS_DELIVERY_OUTCOME_UNKNOWN", true, true);
        const state = await this.repository.failed(job, { code: failure.code, retryable: failure.retryable, outcomeUnknown: failure.outcomeUnknown, now, receiptRetentionDays: this.config.receiptRetentionDays });
        if (state === "queued") summary.retried += 1; else if (state !== "lost_lease") summary.terminal += 1;
      }
    }
    return summary;
  }

  deleteExpired(now = new Date(), limit = 500) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new TypeError("ATTRIBUTION_RETENTION_LIMIT_INVALID");
    return this.repository.deleteExpired(now, limit);
  }
}
