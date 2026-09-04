export const MARKETING_ATTRIBUTION_PROVIDER = "x_ads" as const;
export const MARKETING_ATTRIBUTION_PURPOSE = "advertising_attribution" as const;

export type MarketingAttributionEventName = "sign_up" | "trial_started" | "purchase";
export type MarketingAttributionEventState = "queued" | "delivering" | "delivered" | "cancelled" | "failed_known" | "outcome_unknown";

export interface MarketingAttributionConsent {
  schema: "marketing-attribution-consent/v1";
  workspaceId: string;
  userId: string;
  provider: typeof MARKETING_ATTRIBUTION_PROVIDER;
  revision: number;
  purpose: typeof MARKETING_ATTRIBUTION_PURPOSE;
  status: "active" | "revoked";
  noticeVersion: string;
  regionReviewVersion: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface XAdsConversionPayload {
  conversion_time: string;
  event_id: string;
  identifiers: Array<{ twclid: string } | { hashed_email: string }>;
  conversion_id: string;
  value?: string;
}

export interface MarketingAttributionEvent {
  workspaceId: string;
  id: string;
  userId: string;
  provider: typeof MARKETING_ATTRIBUTION_PROVIDER;
  eventName: MarketingAttributionEventName;
  conversionId: string;
  consentRevision: number;
  payload: XAdsConversionPayload;
  state: MarketingAttributionEventState;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  failureCode: string | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  expiresAt: Date;
}

export interface MarketingAttributionReadiness {
  provider: typeof MARKETING_ATTRIBUTION_PROVIDER;
  available: boolean;
  deliveryMode: "server_conversion_api";
  browserPixelLoaded: false;
  privacyNoticeUrl: string | null;
  noticeVersion: string | null;
  regionReviewVersion: string | null;
  blockers: string[];
}
