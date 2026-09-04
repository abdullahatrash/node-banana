import type { MarketingAttributionEventName, MarketingAttributionReadiness } from "./types";

const safeId = /^[A-Za-z0-9_-]{1,100}$/;
const safeVersion = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export interface XAdsAttributionConfig {
  enabled: boolean;
  apiVersion: string;
  pixelId: string;
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  eventIds: Record<MarketingAttributionEventName, string>;
  accountCurrency: string;
  privacyNoticeUrl: string;
  noticeVersion: string;
  regionReviewVersion: string;
  apiAccessReviewVersion: string;
  eventRetentionDays: number;
  receiptRetentionDays: number;
}

type Environment = Record<string, string | undefined>;
function trimmed(env: Environment, key: string): string { return env[key]?.trim() ?? ""; }
function days(env: Environment, key: string, fallback: number, maximum: number): number {
  const value = Number.parseInt(trimmed(env, key), 10);
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : fallback;
}

export function loadXAdsAttributionConfig(env: Environment = process.env): XAdsAttributionConfig {
  return {
    enabled: trimmed(env, "X_ADS_ATTRIBUTION_ENABLED") === "true",
    apiVersion: trimmed(env, "X_ADS_API_VERSION") || "12",
    pixelId: trimmed(env, "X_ADS_PIXEL_ID"),
    apiKey: trimmed(env, "X_ADS_API_KEY"),
    apiSecret: trimmed(env, "X_ADS_API_SECRET"),
    accessToken: trimmed(env, "X_ADS_ACCESS_TOKEN"),
    accessTokenSecret: trimmed(env, "X_ADS_ACCESS_TOKEN_SECRET"),
    eventIds: {
      sign_up: trimmed(env, "X_ADS_EVENT_ID_SIGN_UP"),
      trial_started: trimmed(env, "X_ADS_EVENT_ID_TRIAL_STARTED"),
      purchase: trimmed(env, "X_ADS_EVENT_ID_PURCHASE"),
    },
    accountCurrency: trimmed(env, "X_ADS_ACCOUNT_CURRENCY").toUpperCase(),
    privacyNoticeUrl: trimmed(env, "NEXT_PUBLIC_PRIVACY_URL"),
    noticeVersion: trimmed(env, "X_ADS_PRIVACY_NOTICE_VERSION"),
    regionReviewVersion: trimmed(env, "X_ADS_REGION_REVIEW_VERSION"),
    apiAccessReviewVersion: trimmed(env, "X_ADS_API_ACCESS_REVIEW_VERSION"),
    eventRetentionDays: days(env, "X_ADS_EVENT_RETENTION_DAYS", 30, 90),
    receiptRetentionDays: days(env, "X_ADS_RECEIPT_RETENTION_DAYS", 365, 730),
  };
}

export function evaluateXAdsAttributionReadiness(config: XAdsAttributionConfig): MarketingAttributionReadiness {
  const blockers: string[] = [];
  if (!config.enabled) blockers.push("OPERATOR_DISABLED");
  if (!/^\d{1,3}$/.test(config.apiVersion)) blockers.push("API_VERSION_INVALID");
  if (!safeId.test(config.pixelId)) blockers.push("PIXEL_ID_MISSING");
  if (!config.apiKey || !config.apiSecret || !config.accessToken || !config.accessTokenSecret) blockers.push("OAUTH_CREDENTIALS_MISSING");
  if (Object.values(config.eventIds).some((value) => !safeId.test(value))) blockers.push("CONVERSION_EVENT_IDS_MISSING");
  if (!/^[A-Z]{3}$/.test(config.accountCurrency)) blockers.push("ACCOUNT_CURRENCY_MISSING");
  let privacyNoticeUrl: string | null = null;
  try { const url = new URL(config.privacyNoticeUrl); if (url.protocol !== "https:") throw new Error(); privacyNoticeUrl = url.toString(); } catch { blockers.push("PRIVACY_NOTICE_URL_INVALID"); }
  if (!safeVersion.test(config.noticeVersion)) blockers.push("PRIVACY_NOTICE_REVIEW_MISSING");
  if (!safeVersion.test(config.regionReviewVersion)) blockers.push("REGION_REVIEW_MISSING");
  if (!safeVersion.test(config.apiAccessReviewVersion)) blockers.push("ADS_API_ACCESS_REVIEW_MISSING");
  return { provider: "x_ads", available: blockers.length === 0, deliveryMode: "server_conversion_api", browserPixelLoaded: false, privacyNoticeUrl, noticeVersion: config.noticeVersion || null, regionReviewVersion: config.regionReviewVersion || null, blockers };
}
