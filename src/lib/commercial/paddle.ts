import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type {
  MerchantCheckoutEvent,
  MerchantOfRecordAdapter,
  MerchantSubscriptionEvent,
  MerchantWebhookVerification,
} from "./merchant";

type Environment = Readonly<Record<string, string | undefined>>;
type CheckoutInput = Parameters<MerchantOfRecordAdapter["createCheckout"]>[0];

const customDataSchema = z.object({
  node_banana_integration: z.literal("checkout-v1"),
  node_banana_checkout_id: z.string().min(1).max(200),
  node_banana_workspace_id: z.string().min(1).max(200),
  node_banana_purpose_kind: z.enum(["subscription", "credit_pack", "channel_onboarding"]),
  node_banana_terms_digest: z.string().min(1).max(200),
  node_banana_total_minor: z.string().regex(/^\d+$/),
  node_banana_currency: z.string().regex(/^[A-Z]{3}$/),
}).passthrough();

const transactionSchema = z.object({
  id: z.string().regex(/^txn_[a-z0-9]+$/),
  status: z.enum(["draft", "ready", "billed", "paid", "completed", "canceled", "past_due"]),
  origin: z.string().nullable().optional(),
  customer_id: z.string().nullable().optional(),
  subscription_id: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  currency_code: z.string().length(3),
  custom_data: z.unknown().nullable().optional(),
  billing_period: z.object({ starts_at: z.string().datetime(), ends_at: z.string().datetime() }).nullable().optional(),
  details: z.object({ totals: z.object({ total: z.string().regex(/^\d+$/) }).passthrough() }).passthrough(),
  checkout: z.object({ url: z.string().url().nullable() }).nullable().optional(),
}).passthrough();

const transactionResponseSchema = z.object({ data: transactionSchema }).passthrough();
const transactionListSchema = z.object({ data: z.array(transactionSchema) }).passthrough();
const portalResponseSchema = z.object({
  data: z.object({ urls: z.object({ general: z.object({ overview: z.string().url() }).passthrough() }).passthrough() }).passthrough(),
}).passthrough();
const invoiceResponseSchema = z.object({ data: z.object({ url: z.string().url() }).passthrough() }).passthrough();
const adjustmentSchema = z.object({
  id: z.string().regex(/^adj_[a-z0-9]+$/),
  action: z.enum(["credit", "refund", "chargeback", "chargeback_reverse", "chargeback_warning", "chargeback_warning_reverse", "credit_reverse"]),
  status: z.enum(["pending_approval", "approved", "rejected", "reversed"]),
  transaction_id: z.string().regex(/^txn_[a-z0-9]+$/),
  subscription_id: z.string().regex(/^sub_[a-z0-9]+$/).nullable(),
  customer_id: z.string().regex(/^ctm_[a-z0-9]+$/),
  currency_code: z.string().length(3),
  reason: z.string().min(1).max(2_000),
  totals: z.object({ total: z.string().regex(/^\d+$/) }).passthrough(),
}).passthrough();
const subscriptionSchema = z.object({
  id: z.string().regex(/^sub_[a-z0-9]+$/),
  status: z.enum(["trialing", "active", "past_due", "paused", "canceled"]),
  customer_id: z.string().regex(/^ctm_[a-z0-9]+$/),
  custom_data: z.unknown().nullable().optional(),
  current_billing_period: z.object({ starts_at: z.string().datetime(), ends_at: z.string().datetime() }).nullable().optional(),
  scheduled_change: z.object({ action: z.enum(["cancel", "pause", "resume"]), effective_at: z.string().datetime() }).passthrough().nullable().optional(),
}).passthrough();
const webhookEnvelopeSchema = z.object({
  event_id: z.string().min(1).max(200),
  event_type: z.string().min(1).max(100),
  occurred_at: z.string().datetime(),
  data: z.unknown(),
}).passthrough();

const PADDLE_API_VERSION = "1";
const CHECKOUT_LIFETIME_MS = 30 * 60_000;

export class PaddleMerchantOfRecordAdapter implements MerchantOfRecordAdapter {
  constructor(
    private readonly environment: Environment = process.env,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createCheckout(input: CheckoutInput) {
    if (!this.configuration()) return { kind: "unavailable" as const };
    const response = await this.authorized(new URL("transactions", this.apiBase()), {
      method: "POST",
      body: JSON.stringify(this.transactionPayload(input)),
    });
    const transaction = transactionResponseSchema.parse(await response.json()).data;
    this.assertOwnedTransaction(transaction, input.checkoutId);
    return this.readyCheckout(transaction.id, input.successPath, input.cancelPath);
  }

  async recoverCheckout(input: Parameters<MerchantOfRecordAdapter["recoverCheckout"]>[0]) {
    if (!this.configuration()) return { kind: "unavailable" as const };
    const transaction = input.merchantCheckoutRef
      ? await this.getTransaction(input.merchantCheckoutRef)
      : await this.findTransaction(input.checkoutId);
    if (!transaction) return { kind: "pending" as const };
    this.assertOwnedTransaction(transaction, input.checkoutId);
    const event = this.terminalEvent(transaction, `recovery:${transaction.id}`, this.now());
    if (event) return { kind: "terminal" as const, event };
    if (["draft", "ready", "billed"].includes(transaction.status)) {
      return this.readyCheckout(transaction.id, "/settings?section=billing&checkout=success", "/settings?section=billing&checkout=cancelled");
    }
    return { kind: "pending" as const };
  }

  verifyWebhook(input: Parameters<MerchantOfRecordAdapter["verifyWebhook"]>[0]): MerchantWebhookVerification {
    const secret = this.environment.PADDLE_WEBHOOK_SECRET?.trim();
    if (!secret || !input.paddleSignature) return { kind: "invalid" };
    const signature = parsePaddleSignature(input.paddleSignature);
    if (!signature) return { kind: "invalid" };
    const toleranceSeconds = webhookToleranceSeconds(this.environment.PADDLE_WEBHOOK_TOLERANCE_SECONDS);
    if (Math.abs(input.at.getTime() - signature.timestamp * 1_000) > toleranceSeconds * 1_000) return { kind: "invalid" };
    const expected = createHmac("sha256", secret).update(`${signature.timestamp}:${input.body}`).digest("hex");
    if (!signature.hashes.some((hash) => sameHexDigest(expected, hash))) return { kind: "invalid" };

    let envelope: z.infer<typeof webhookEnvelopeSchema>;
    try {
      const parsed = webhookEnvelopeSchema.safeParse(JSON.parse(input.body));
      if (!parsed.success) return { kind: "invalid" };
      envelope = parsed.data;
    } catch {
      return { kind: "invalid" };
    }

    if (envelope.event_type.startsWith("subscription.")) {
      const subscription = subscriptionSchema.safeParse(envelope.data);
      if (!subscription.success) return { kind: "invalid" };
      const customData = customDataSchema.safeParse(subscription.data.custom_data);
      if (!customData.success || customData.data.node_banana_purpose_kind !== "subscription") return { kind: "ignored", provider: "paddle", eventId: envelope.event_id, reason: "foreign_subscription" };
      const event = paddleSubscriptionStatusEvent(subscription.data, customData.data, envelope.event_id, new Date(envelope.occurred_at));
      return { kind: "subscription_event", event };
    }
    if (envelope.event_type.startsWith("adjustment.")) {
      const adjustment = adjustmentSchema.safeParse(envelope.data);
      if (!adjustment.success) return { kind: "invalid" };
      const amountMinor = safeMinorUnits(adjustment.data.totals.total);
      if (amountMinor === null) return { kind: "invalid" };
      return { kind: "adjustment_event", event: {
        provider: "paddle",
        eventId: envelope.event_id,
        adjustmentRef: adjustment.data.id,
        transactionRef: adjustment.data.transaction_id,
        merchantSubscriptionRef: adjustment.data.subscription_id,
        merchantCustomerRef: adjustment.data.customer_id,
        action: adjustment.data.action,
        status: adjustment.data.status,
        amountMinor,
        currency: adjustment.data.currency_code.toUpperCase(),
        reason: adjustment.data.reason,
        occurredAt: new Date(envelope.occurred_at),
      } };
    }
    if (!envelope.event_type.startsWith("transaction.")) {
      return { kind: "ignored", provider: "paddle", eventId: envelope.event_id, reason: "unsupported_entity" };
    }
    const transaction = transactionSchema.safeParse(envelope.data);
    if (!transaction.success) return { kind: "invalid" };
    const customData = customDataSchema.safeParse(transaction.data.custom_data);
    if (!customData.success) {
      return { kind: "ignored", provider: "paddle", eventId: envelope.event_id, reason: "foreign_transaction" };
    }
    if (transaction.data.origin === "subscription_recurring" && envelope.event_type === "transaction.completed") {
      if (customData.data.node_banana_purpose_kind !== "subscription" || !transaction.data.customer_id || !transaction.data.subscription_id || !transaction.data.billing_period || !this.transactionTotalsMatch(transaction.data, customData.data)) return { kind: "invalid" };
      const amountMinor = safeMinorUnits(transaction.data.details.totals.total);
      if (amountMinor === null) return { kind: "invalid" };
      return { kind: "subscription_event", event: {
        provider: "paddle",
        eventId: envelope.event_id,
        eventType: "subscription.payment_completed",
        workspaceId: customData.data.node_banana_workspace_id,
        merchantCustomerRef: transaction.data.customer_id,
        merchantSubscriptionRef: transaction.data.subscription_id,
        merchantTransactionRef: transaction.data.id,
        periodStartsAt: new Date(transaction.data.billing_period.starts_at),
        periodEndsAt: new Date(transaction.data.billing_period.ends_at),
        occurredAt: new Date(envelope.occurred_at),
        billingTransaction: { transactionRef: transaction.data.id, amountMinor, currency: transaction.data.currency_code.toUpperCase(), invoiceNumber: transaction.data.invoice_number || null },
      } };
    }
    if (transaction.data.origin && transaction.data.origin !== "api") {
      return { kind: "ignored", provider: "paddle", eventId: envelope.event_id, reason: "non_checkout_transaction" };
    }
    if (!["transaction.completed", "transaction.canceled"].includes(envelope.event_type)) {
      return { kind: "ignored", provider: "paddle", eventId: envelope.event_id, reason: "non_terminal_transaction" };
    }
    if (!this.transactionTotalsMatch(transaction.data, customData.data)) return { kind: "invalid" };
    const event = this.terminalEvent(transaction.data, envelope.event_id, new Date(envelope.occurred_at));
    return event ? { kind: "checkout_event", event } : { kind: "invalid" };
  }

  async createPortal(input: Parameters<MerchantOfRecordAdapter["createPortal"]>[0]) {
    if (!this.configuration()) return { kind: "unavailable" as const };
    const customerRef = z.string().regex(/^ctm_[a-z0-9]+$/).parse(input.customerRef);
    const response = await this.authorized(new URL(`customers/${encodeURIComponent(customerRef)}/portal-sessions`, this.apiBase()), {
      method: "POST",
      body: JSON.stringify({}),
    });
    const url = portalResponseSchema.parse(await response.json()).data.urls.general.overview;
    this.assertRedirect(url);
    return { kind: "ready" as const, url, expiresAt: new Date(this.now().getTime() + CHECKOUT_LIFETIME_MS) };
  }

  async createInvoiceLink(input: Parameters<MerchantOfRecordAdapter["createInvoiceLink"]>[0]) {
    if (!this.configuration()) return { kind: "unavailable" as const };
    const id = z.string().regex(/^txn_[a-z0-9]+$/).parse(input.transactionRef);
    const url = new URL(`transactions/${encodeURIComponent(id)}/invoice`, this.apiBase());
    url.searchParams.set("disposition", "inline");
    const response = await this.authorized(url, { method: "GET" });
    const invoiceUrl = invoiceResponseSchema.parse(await response.json()).data.url;
    this.assertInvoiceRedirect(invoiceUrl);
    return { kind: "ready" as const, url: invoiceUrl, expiresAt: new Date(this.now().getTime() + 60 * 60_000) };
  }

  private transactionPayload(input: CheckoutInput) {
    const totalMinor = input.amountMinor + input.taxMinor;
    const recurring = input.purposeKind === "subscription";
    const name = productName(input);
    return {
      items: [{
        quantity: 1,
        price: {
          name,
          description: `${name} · ${input.termsDigest}`,
          unit_price: { amount: String(totalMinor), currency_code: input.currency.toUpperCase() },
          tax_mode: "internal",
          billing_cycle: recurring ? { interval: "month", frequency: 1 } : null,
          product: {
            name,
            description: `Tasmeem AI ${input.purposeKind.replaceAll("_", " ")}`,
            tax_category: input.purposeKind === "channel_onboarding" ? "implementation-services" : "saas",
          },
        },
      }],
      collection_mode: "automatic",
      custom_data: {
        node_banana_integration: "checkout-v1",
        node_banana_checkout_id: input.checkoutId,
        node_banana_workspace_id: input.workspaceId,
        node_banana_purpose_kind: input.purposeKind,
        node_banana_terms_digest: input.termsDigest,
        node_banana_total_minor: String(totalMinor),
        node_banana_currency: input.currency.toUpperCase(),
      },
      checkout: { url: this.checkoutBase().toString() },
    };
  }

  private terminalEvent(transaction: z.infer<typeof transactionSchema>, eventId: string, occurredAt: Date): MerchantCheckoutEvent | null {
    const customData = customDataSchema.safeParse(transaction.custom_data);
    if (!customData.success || !this.transactionTotalsMatch(transaction, customData.data)) return null;
    if (transaction.status !== "completed" && transaction.status !== "canceled") return null;
    const amountMinor = safeMinorUnits(transaction.details.totals.total);
    if (amountMinor === null) return null;
    return {
      provider: "paddle",
      eventId,
      eventType: transaction.status === "completed" ? "checkout.completed" : "checkout.cancelled",
      checkoutId: customData.data.node_banana_checkout_id,
      merchantCheckoutRef: transaction.id,
      merchantEffectRef: transaction.id,
      merchantCustomerRef: transaction.customer_id ?? null,
      merchantSubscriptionRef: transaction.subscription_id ?? null,
      merchantReceiptRef: transaction.invoice_number ?? transaction.id,
      periodStartsAt: transaction.billing_period ? new Date(transaction.billing_period.starts_at) : null,
      periodEndsAt: transaction.billing_period ? new Date(transaction.billing_period.ends_at) : null,
      occurredAt,
      billingTransaction: transaction.status === "completed" ? { transactionRef: transaction.id, amountMinor, currency: transaction.currency_code.toUpperCase(), invoiceNumber: transaction.invoice_number || null } : null,
    };
  }

  private transactionTotalsMatch(transaction: z.infer<typeof transactionSchema>, customData: z.infer<typeof customDataSchema>) {
    return transaction.currency_code.toUpperCase() === customData.node_banana_currency
      && transaction.details.totals.total === customData.node_banana_total_minor;
  }

  private async getTransaction(transactionId: string) {
    const id = z.string().regex(/^txn_[a-z0-9]+$/).parse(transactionId);
    const response = await this.authorized(new URL(`transactions/${encodeURIComponent(id)}`, this.apiBase()), { method: "GET" });
    return transactionResponseSchema.parse(await response.json()).data;
  }

  private async findTransaction(checkoutId: string) {
    const response = await this.authorized(new URL("transactions?per_page=30", this.apiBase()), { method: "GET" });
    const transactions = transactionListSchema.parse(await response.json()).data;
    return transactions.find((transaction) => customDataSchema.safeParse(transaction.custom_data).data?.node_banana_checkout_id === checkoutId) ?? null;
  }

  private readyCheckout(transactionId: string, successPath: string, cancelPath: string) {
    const url = this.checkoutBase();
    url.searchParams.set("transactionId", transactionId);
    url.searchParams.set("successPath", safeReturnPath(successPath));
    url.searchParams.set("cancelPath", safeReturnPath(cancelPath));
    this.assertRedirect(url.toString());
    return { kind: "ready" as const, merchantCheckoutRef: transactionId, url: url.toString(), expiresAt: new Date(this.now().getTime() + CHECKOUT_LIFETIME_MS) };
  }

  private configuration() {
    const apiKey = this.environment.PADDLE_API_KEY?.trim();
    const checkoutUrl = this.environment.PADDLE_CHECKOUT_URL?.trim();
    const clientToken = this.environment.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim();
    if (!apiKey || !checkoutUrl || !clientToken) return null;
    if (this.environment.PADDLE_ENVIRONMENT === "sandbox" && (!apiKey.includes("_sdbx_") || !clientToken.startsWith("test_"))) return null;
    if (this.environment.PADDLE_ENVIRONMENT === "live" && (!apiKey.includes("_live_") || !clientToken.startsWith("live_"))) return null;
    if (!(["sandbox", "live"] as const).includes(this.environment.PADDLE_ENVIRONMENT as "sandbox" | "live")) return null;
    try { this.checkoutBase(); } catch { return null; }
    return { apiKey };
  }

  private apiBase() {
    return new URL(this.environment.PADDLE_ENVIRONMENT === "sandbox" ? "https://sandbox-api.paddle.com/" : "https://api.paddle.com/");
  }

  private checkoutBase() {
    const url = new URL(this.environment.PADDLE_CHECKOUT_URL!);
    if (url.username || url.password || url.hash || (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1")) throw new Error("PADDLE_CHECKOUT_URL_UNSAFE");
    return url;
  }

  private async authorized(url: URL, init: RequestInit) {
    const configuration = this.configuration();
    if (!configuration) throw new Error("PADDLE_NOT_CONFIGURED");
    const response = await this.fetcher(url, {
      ...init,
      headers: { Authorization: `Bearer ${configuration.apiKey}`, "Content-Type": "application/json", "Paddle-Version": PADDLE_API_VERSION, ...init.headers },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`PADDLE_HTTP_${response.status}`);
    return response;
  }

  private assertOwnedTransaction(transaction: z.infer<typeof transactionSchema>, checkoutId: string) {
    const customData = customDataSchema.parse(transaction.custom_data);
    if (customData.node_banana_checkout_id !== checkoutId || !this.transactionTotalsMatch(transaction, customData)) throw new Error("PADDLE_TRANSACTION_MISMATCH");
  }

  private assertRedirect(value: string) {
    const url = new URL(value);
    const allowed = new Set((this.environment.PADDLE_ALLOWED_REDIRECT_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
    if (url.protocol !== "https:" || !allowed.has(url.hostname.toLowerCase())) throw new Error("MERCHANT_REDIRECT_UNSAFE");
  }

  private assertInvoiceRedirect(value: string) {
    const url = new URL(value);
    const allowed = new Set((this.environment.PADDLE_ALLOWED_INVOICE_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
    if (url.protocol !== "https:" || !allowed.has(url.hostname.toLowerCase())) throw new Error("MERCHANT_INVOICE_REDIRECT_UNSAFE");
  }
}

function parsePaddleSignature(value: string) {
  const pairs = value.split(";").map((part) => part.trim().split("=", 2));
  const timestampText = pairs.find(([key]) => key === "ts")?.[1];
  const timestamp = Number(timestampText);
  const hashes = pairs.filter(([key, hash]) => key === "h1" && /^[a-f0-9]{64}$/.test(hash ?? "")).map(([, hash]) => hash!);
  return Number.isSafeInteger(timestamp) && timestamp > 0 && hashes.length ? { timestamp, hashes } : null;
}

function sameHexDigest(expected: string, supplied: string) {
  const left = Buffer.from(expected, "hex"), right = Buffer.from(supplied, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function webhookToleranceSeconds(value: string | undefined) {
  const parsed = Number(value ?? "5");
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 300 ? parsed : 5;
}

function safeMinorUnits(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function productName(input: CheckoutInput) {
  const snapshot = input.commercialSnapshot;
  const reference = typeof snapshot.planId === "string" ? snapshot.planId : typeof snapshot.packId === "string" ? snapshot.packId : typeof snapshot.orderId === "string" ? snapshot.orderId : input.purposeRef;
  return `Tasmeem AI ${input.purposeKind.replaceAll("_", " ")} · ${reference}`.slice(0, 200);
}

function safeReturnPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) throw new Error("PADDLE_RETURN_PATH_UNSAFE");
  return value;
}

function paddleSubscriptionStatusEvent(subscription: z.infer<typeof subscriptionSchema>, customData: z.infer<typeof customDataSchema>, eventId: string, occurredAt: Date): MerchantSubscriptionEvent {
  const period = subscription.current_billing_period;
  let eventType: MerchantSubscriptionEvent["eventType"];
  if (subscription.status === "past_due") eventType = "subscription.grace";
  else if (subscription.status === "paused") eventType = "subscription.suspended";
  else if (subscription.status === "canceled") eventType = "subscription.cancelled";
  else if (subscription.scheduled_change?.action === "cancel") eventType = "subscription.cancel_at_period_end";
  else eventType = "subscription.active";
  return {
    provider: "paddle",
    eventId,
    eventType,
    workspaceId: customData.node_banana_workspace_id,
    merchantCustomerRef: subscription.customer_id,
    merchantSubscriptionRef: subscription.id,
    merchantTransactionRef: null,
    periodStartsAt: period ? new Date(period.starts_at) : null,
    periodEndsAt: period ? new Date(period.ends_at) : null,
    occurredAt,
    billingTransaction: null,
  };
}
