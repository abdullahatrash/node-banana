import "server-only";
import { createHash } from "node:crypto";
import { TwitterApi } from "twitter-api-v2";
import type { XAdsAttributionConfig } from "./config";
import type { XAdsConversionPayload } from "./types";

export interface XAdsDeliveryResult { processed: number; debugId: string | null }
export interface XAdsConversionTransport { send(url: string, body: { conversions: XAdsConversionPayload[] }): Promise<unknown> }

export class XAdsDeliveryError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, public readonly outcomeUnknown: boolean) { super(code); }
}

export function normalizeAndHashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) throw new TypeError("ATTRIBUTION_EMAIL_INVALID");
  return createHash("sha256").update(normalized).digest("hex");
}

export function normalizeTwclid(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{6,200}$/.test(candidate) ? candidate : null;
}

export class TwitterApiXAdsTransport implements XAdsConversionTransport {
  private readonly client: TwitterApi;
  constructor(config: XAdsAttributionConfig) {
    this.client = new TwitterApi({ appKey: config.apiKey, appSecret: config.apiSecret, accessToken: config.accessToken, accessSecret: config.accessTokenSecret });
  }
  send(url: string, body: { conversions: XAdsConversionPayload[] }): Promise<unknown> {
    return this.client.post(url, body, { forceBodyMode: "json" });
  }
}

export class XAdsConversionAdapter {
  constructor(private readonly config: XAdsAttributionConfig, private readonly transport?: XAdsConversionTransport) {}
  async deliver(payload: XAdsConversionPayload): Promise<XAdsDeliveryResult> {
    const url = `https://ads-api.x.com/${encodeURIComponent(this.config.apiVersion)}/measurement/conversions/${encodeURIComponent(this.config.pixelId)}`;
    let raw: unknown;
    try { raw = await (this.transport ?? new TwitterApiXAdsTransport(this.config)).send(url, { conversions: [payload] }); }
    catch (error) {
      const status = typeof error === "object" && error && "code" in error ? Number((error as { code?: unknown }).code) : NaN;
      if (status === 429) throw new XAdsDeliveryError("X_ADS_TEMPORARILY_UNAVAILABLE", true, false);
      if (status >= 500) throw new XAdsDeliveryError("X_ADS_TEMPORARILY_UNAVAILABLE", true, true);
      if (status >= 400 && status < 500) throw new XAdsDeliveryError("X_ADS_REQUEST_REJECTED", false, false);
      throw new XAdsDeliveryError("X_ADS_DELIVERY_OUTCOME_UNKNOWN", true, true);
    }
    const data = typeof raw === "object" && raw && "data" in raw ? (raw as { data?: unknown }).data : null;
    const processed = typeof data === "object" && data && "conversions_processed" in data ? Number((data as { conversions_processed?: unknown }).conversions_processed) : NaN;
    const debugId = typeof data === "object" && data && typeof (data as { debug_id?: unknown }).debug_id === "string" ? (data as { debug_id: string }).debug_id.slice(0, 200) : null;
    if (processed !== 1) throw new XAdsDeliveryError("X_ADS_RESPONSE_INVALID", true, true);
    return { processed, debugId };
  }
}
