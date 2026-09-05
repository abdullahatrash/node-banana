import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type MerchantCheckoutPurpose = "subscription" | "credit_pack" | "channel_onboarding";
export type MerchantCheckoutEvent = {
  provider: string; eventId: string; eventType: "checkout.completed" | "checkout.failed" | "checkout.expired" | "checkout.cancelled";
  checkoutId: string; merchantCheckoutRef: string; merchantEffectRef: string; merchantCustomerRef: string | null; merchantSubscriptionRef: string | null; merchantReceiptRef: string | null; periodStartsAt: Date | null; periodEndsAt: Date | null; occurredAt: Date;
  billingTransaction: MerchantBillingTransactionEvidence | null;
};
export type MerchantBillingTransactionEvidence = { transactionRef: string; amountMinor: number; currency: string; invoiceNumber: string | null };
export type MerchantSubscriptionEvent = {
  provider: string;
  eventId: string;
  eventType: "subscription.payment_completed" | "subscription.active" | "subscription.grace" | "subscription.cancel_at_period_end" | "subscription.cancelled" | "subscription.suspended";
  workspaceId: string;
  merchantCustomerRef: string;
  merchantSubscriptionRef: string;
  merchantTransactionRef: string | null;
  periodStartsAt: Date | null;
  periodEndsAt: Date | null;
  occurredAt: Date;
  billingTransaction: MerchantBillingTransactionEvidence | null;
};
export type MerchantAdjustmentEvent = {
  provider: string;
  eventId: string;
  adjustmentRef: string;
  transactionRef: string;
  merchantSubscriptionRef: string | null;
  merchantCustomerRef: string;
  action: "credit" | "refund" | "chargeback" | "chargeback_reverse" | "chargeback_warning" | "chargeback_warning_reverse" | "credit_reverse";
  status: "pending_approval" | "approved" | "rejected" | "reversed";
  amountMinor: number;
  currency: string;
  reason: string;
  occurredAt: Date;
};
export type MerchantWebhookVerification =
  | { kind: "checkout_event"; event: MerchantCheckoutEvent }
  | { kind: "subscription_event"; event: MerchantSubscriptionEvent }
  | { kind: "adjustment_event"; event: MerchantAdjustmentEvent }
  | { kind: "ignored"; provider: string; eventId: string; reason: string }
  | { kind: "invalid" };

export interface MerchantOfRecordAdapter {
  createCheckout(input: { checkoutId: string; workspaceId: string; purposeKind: MerchantCheckoutPurpose; purposeRef: string; amountMinor: number; taxMinor: number; currency: string; termsDigest: string; commercialSnapshot: Record<string, unknown>; successPath: string; cancelPath: string }): Promise<{ kind: "ready"; merchantCheckoutRef: string; url: string; expiresAt: Date } | { kind: "unavailable" }>;
  recoverCheckout(input: { checkoutId: string; merchantCheckoutRef: string | null }): Promise<{ kind: "pending" } | { kind: "ready"; merchantCheckoutRef: string; url: string; expiresAt: Date } | { kind: "terminal"; event: MerchantCheckoutEvent } | { kind: "unavailable" }>;
  verifyWebhook(input: { body: string; timestamp: string | null; signature: string | null; paddleSignature: string | null; at: Date }): MerchantWebhookVerification;
  createPortal(input: { workspaceId: string; customerRef: string; returnPath: string }): Promise<{ kind: "ready"; url: string; expiresAt: Date } | { kind: "unavailable" }>;
  createInvoiceLink(input: { workspaceId: string; transactionRef: string }): Promise<{ kind: "ready"; url: string; expiresAt: Date } | { kind: "unavailable" }>;
}

const eventSchema = z.object({ provider: z.string().min(1).max(80), eventId: z.string().min(1).max(200), eventType: z.enum(["checkout.completed", "checkout.failed", "checkout.expired", "checkout.cancelled"]), checkoutId: z.string().min(1).max(200), merchantCheckoutRef: z.string().min(1).max(500), merchantEffectRef: z.string().min(1).max(500), merchantCustomerRef: z.string().min(1).max(500).nullable(), merchantSubscriptionRef: z.string().min(1).max(500).nullable(), merchantReceiptRef: z.string().min(1).max(500).nullable(), periodStartsAt: z.string().datetime().nullable(), periodEndsAt: z.string().datetime().nullable(), occurredAt: z.string().datetime(), billingTransaction: z.object({ transactionRef: z.string().min(1).max(500), amountMinor: z.number().int().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/), invoiceNumber: z.string().min(1).max(500).nullable() }).strict().nullable().optional() }).strict();
const checkoutSchema = z.object({ merchantCheckoutRef: z.string().min(1).max(500), url: z.string().url(), expiresAt: z.string().datetime() }).strict();
const recoverySchema = z.discriminatedUnion("state", [z.object({ state: z.literal("pending") }).strict(), z.object({ state: z.literal("ready"), ...checkoutSchema.shape }).strict(), z.object({ state: z.literal("terminal"), event: eventSchema }).strict()]);
const portalSchema = z.object({ url: z.string().url(), expiresAt: z.string().datetime() }).strict();
type Environment = Readonly<Record<string, string | undefined>>;

function sameSignature(expected: string, supplied: string) { const left = Buffer.from(expected); const right = Buffer.from(supplied); return left.length === right.length && timingSafeEqual(left, right); }

export class ConfiguredMerchantOfRecordAdapter implements MerchantOfRecordAdapter {
  constructor(private readonly environment: Environment = process.env, private readonly fetcher: typeof fetch = fetch) {}
  async createCheckout(input: Parameters<MerchantOfRecordAdapter["createCheckout"]>[0]) {
    const response = await this.call("checkouts", { method: "POST", headers: { "Idempotency-Key": input.checkoutId }, body: JSON.stringify(input) });
    if (!response) return { kind: "unavailable" as const };
    const parsed = checkoutSchema.parse(await response.json()); this.assertRedirect(parsed.url);
    return { kind: "ready" as const, merchantCheckoutRef: parsed.merchantCheckoutRef, url: parsed.url, expiresAt: new Date(parsed.expiresAt) };
  }
  async recoverCheckout(input: Parameters<MerchantOfRecordAdapter["recoverCheckout"]>[0]) {
    const url = this.endpoint(`checkouts/by-idempotency-key/${encodeURIComponent(input.checkoutId)}`); if (!url) return { kind: "unavailable" as const };
    if (input.merchantCheckoutRef) url.searchParams.set("merchantCheckoutRef", input.merchantCheckoutRef);
    const response = await this.authorized(url, { method: "GET" }); if (!response) return { kind: "unavailable" as const };
    const parsed = recoverySchema.parse(await response.json());
    if (parsed.state === "pending") return { kind: "pending" as const };
    if (parsed.state === "terminal") return { kind: "terminal" as const, event: hydrateEvent(parsed.event) };
    this.assertRedirect(parsed.url);
    return { kind: "ready" as const, merchantCheckoutRef: parsed.merchantCheckoutRef, url: parsed.url, expiresAt: new Date(parsed.expiresAt) };
  }
  verifyWebhook(input: Parameters<MerchantOfRecordAdapter["verifyWebhook"]>[0]) {
    const secret = this.environment.MERCHANT_OF_RECORD_WEBHOOK_SECRET?.trim(); if (!secret || !input.timestamp || !input.signature || !/^hmac-sha256=[a-f0-9]{64}$/.test(input.signature)) return { kind: "invalid" as const };
    const timestamp = Number(input.timestamp); if (!Number.isFinite(timestamp) || Math.abs(input.at.getTime() - timestamp * 1_000) > 5 * 60_000) return { kind: "invalid" as const };
    const expected = `hmac-sha256=${createHmac("sha256", secret).update(`${input.timestamp}.${input.body}`).digest("hex")}`;
    if (!sameSignature(expected, input.signature)) return { kind: "invalid" as const };
    try { const parsed = eventSchema.safeParse(JSON.parse(input.body)); return parsed.success ? { kind: "checkout_event" as const, event: hydrateEvent(parsed.data) } : { kind: "invalid" as const }; } catch { return { kind: "invalid" as const }; }
  }
  async createPortal(input: Parameters<MerchantOfRecordAdapter["createPortal"]>[0]) {
    const response = await this.call("portal", { method: "POST", headers: { "Idempotency-Key": `portal:${input.workspaceId}:${input.customerRef}` }, body: JSON.stringify(input) });
    if (!response) return { kind: "unavailable" as const };
    const parsed = portalSchema.parse(await response.json()); this.assertRedirect(parsed.url); return { kind: "ready" as const, url: parsed.url, expiresAt: new Date(parsed.expiresAt) };
  }
  async createInvoiceLink(input: Parameters<MerchantOfRecordAdapter["createInvoiceLink"]>[0]) {
    const response = await this.call(`transactions/${encodeURIComponent(input.transactionRef)}/invoice`, { method: "POST", body: JSON.stringify({ workspaceId: input.workspaceId }) });
    if (!response) return { kind: "unavailable" as const };
    const parsed = portalSchema.parse(await response.json()); this.assertRedirect(parsed.url); return { kind: "ready" as const, url: parsed.url, expiresAt: new Date(parsed.expiresAt) };
  }
  private endpoint(path: string) { const raw = this.environment.MERCHANT_OF_RECORD_BASE_URL?.trim(); if (!raw) return null; try { const base = new URL(raw.endsWith("/") ? raw : `${raw}/`); if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") return null; return new URL(path, base); } catch { return null; } }
  private async call(path: string, init: RequestInit) { const url = this.endpoint(path); return url ? this.authorized(url, init) : null; }
  private async authorized(url: URL, init: RequestInit) { const token = this.environment.MERCHANT_OF_RECORD_API_TOKEN?.trim(); if (!token) return null; const response = await this.fetcher(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(`MERCHANT_OF_RECORD_HTTP_${response.status}`); return response; }
  private assertRedirect(value: string) { const url = new URL(value); const allowed = new Set((this.environment.MERCHANT_OF_RECORD_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)); if (url.protocol !== "https:" || !allowed.size || !allowed.has(url.hostname.toLowerCase())) throw new Error("MERCHANT_REDIRECT_UNSAFE"); }
}

export class UnavailableMerchantOfRecordAdapter implements MerchantOfRecordAdapter {
  async createCheckout() { return { kind: "unavailable" as const }; }
  async recoverCheckout() { return { kind: "unavailable" as const }; }
  verifyWebhook() { return { kind: "invalid" as const }; }
  async createPortal() { return { kind: "unavailable" as const }; }
  async createInvoiceLink() { return { kind: "unavailable" as const }; }
}

function hydrateEvent(value: z.infer<typeof eventSchema>): MerchantCheckoutEvent { return { ...value, billingTransaction: value.billingTransaction ?? null, periodStartsAt: value.periodStartsAt ? new Date(value.periodStartsAt) : null, periodEndsAt: value.periodEndsAt ? new Date(value.periodEndsAt) : null, occurredAt: new Date(value.occurredAt) }; }
