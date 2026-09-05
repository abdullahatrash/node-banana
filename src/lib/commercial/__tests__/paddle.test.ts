import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PaddleMerchantOfRecordAdapter } from "../paddle";

const environment = {
  PADDLE_ENVIRONMENT: "sandbox",
  PADDLE_API_KEY: "pdl_sdbx_apikey_test",
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_client_token",
  PADDLE_WEBHOOK_SECRET: "pdl_ntfset_secret",
  PADDLE_CHECKOUT_URL: "https://checkout.example/checkout/paddle",
  PADDLE_ALLOWED_REDIRECT_HOSTS: "checkout.example,customer-portal.paddle.com",
};
const at = new Date("2026-09-05T12:00:02.000Z");
const transaction = {
  id: "txn_01test",
  status: "completed",
  origin: "api",
  customer_id: "ctm_01test",
  subscription_id: "sub_01test",
  invoice_number: "INV-100",
  currency_code: "USD",
  custom_data: {
    node_banana_integration: "checkout-v1",
    node_banana_checkout_id: "checkout_1",
    node_banana_workspace_id: "workspace_1",
    node_banana_purpose_kind: "subscription",
    node_banana_terms_digest: `sha256:${"a".repeat(64)}`,
    node_banana_total_minor: "1000",
    node_banana_currency: "USD",
  },
  billing_period: { starts_at: "2026-09-05T12:00:00.000Z", ends_at: "2026-10-05T12:00:00.000Z" },
  details: { totals: { total: "1000" } },
  checkout: { url: "https://checkout.example/checkout/paddle?_ptxn=txn_01test" },
};
const checkoutInput = {
  checkoutId: "checkout_1", workspaceId: "workspace_1", purposeKind: "subscription" as const, purposeRef: "pro:1:key", amountMinor: 1000, taxMinor: 0, currency: "USD", termsDigest: `sha256:${"a".repeat(64)}`, commercialSnapshot: { kind: "subscription", planId: "pro", planVersion: 1 }, successPath: "/settings?section=billing&checkout=success", cancelPath: "/settings?section=billing&checkout=cancelled",
};

describe("PaddleMerchantOfRecordAdapter", () => {
  it("fails closed when sandbox key and client-token families do not match", async () => {
    const fetcher = vi.fn();
    const adapter = new PaddleMerchantOfRecordAdapter({ ...environment, PADDLE_API_KEY: "pdl_live_apikey_wrong" }, fetcher);
    await expect(adapter.createCheckout(checkoutInput)).resolves.toEqual({ kind: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("creates an automatic, tax-inclusive custom transaction and returns the app checkout", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: transaction }), { status: 201 }));
    const adapter = new PaddleMerchantOfRecordAdapter(environment, fetcher, () => new Date("2026-09-05T12:00:00.000Z"));
    await expect(adapter.createCheckout(checkoutInput)).resolves.toEqual({
      kind: "ready",
      merchantCheckoutRef: "txn_01test",
      url: "https://checkout.example/checkout/paddle?transactionId=txn_01test&successPath=%2Fsettings%3Fsection%3Dbilling%26checkout%3Dsuccess&cancelPath=%2Fsettings%3Fsection%3Dbilling%26checkout%3Dcancelled",
      expiresAt: new Date("2026-09-05T12:30:00.000Z"),
    });
    const [, request] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(fetcher.mock.calls[0][0].toString()).toBe("https://sandbox-api.paddle.com/transactions");
    expect(request.headers).toMatchObject({ Authorization: "Bearer pdl_sdbx_apikey_test", "Paddle-Version": "1" });
    expect(request.headers).not.toHaveProperty("Idempotency-Key");
    expect(JSON.parse(String(request.body))).toMatchObject({
      collection_mode: "automatic",
      items: [{ quantity: 1, price: { unit_price: { amount: "1000", currency_code: "USD" }, tax_mode: "internal", billing_cycle: { interval: "month", frequency: 1 }, product: { tax_category: "saas" } } }],
      custom_data: { node_banana_checkout_id: "checkout_1", node_banana_total_minor: "1000" },
    });
  });

  it("recovers an uncertain create by finding the provider transaction instead of creating again", async () => {
    const ready = { ...transaction, status: "ready", customer_id: null, subscription_id: null, invoice_number: null, billing_period: null };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [ready] }), { status: 200 }));
    const adapter = new PaddleMerchantOfRecordAdapter(environment, fetcher, () => new Date("2026-09-05T12:00:00.000Z"));
    await expect(adapter.recoverCheckout({ checkoutId: "checkout_1", merchantCheckoutRef: null })).resolves.toMatchObject({ kind: "ready", merchantCheckoutRef: "txn_01test" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0].toString()).toBe("https://sandbox-api.paddle.com/transactions?per_page=30");
  });

  it("verifies exact Paddle bytes, accepts rotating h1 values, and maps a completed initial transaction", () => {
    const body = JSON.stringify({ event_id: "evt_01test", event_type: "transaction.completed", occurred_at: "2026-09-05T12:00:01.000Z", data: transaction });
    const timestamp = Math.floor(at.getTime() / 1000) - 2;
    const valid = createHmac("sha256", environment.PADDLE_WEBHOOK_SECRET).update(`${timestamp}:${body}`).digest("hex");
    const adapter = new PaddleMerchantOfRecordAdapter(environment, vi.fn());
    expect(adapter.verifyWebhook({ body, timestamp: null, signature: null, paddleSignature: `ts=${timestamp};h1=${"0".repeat(64)};h1=${valid}`, at })).toMatchObject({ kind: "event", event: { provider: "paddle", eventId: "evt_01test", checkoutId: "checkout_1", merchantReceiptRef: "INV-100" } });
    expect(adapter.verifyWebhook({ body: `${body} `, timestamp: null, signature: null, paddleSignature: `ts=${timestamp};h1=${valid}`, at })).toEqual({ kind: "invalid" });
  });

  it("acknowledges recurring renewals without replaying the original checkout", () => {
    const renewal = { ...transaction, id: "txn_renewal", origin: "subscription_recurring" };
    const body = JSON.stringify({ event_id: "evt_renewal", event_type: "transaction.completed", occurred_at: "2026-09-05T12:00:01.000Z", data: renewal });
    const timestamp = Math.floor(at.getTime() / 1000);
    const signature = createHmac("sha256", environment.PADDLE_WEBHOOK_SECRET).update(`${timestamp}:${body}`).digest("hex");
    const adapter = new PaddleMerchantOfRecordAdapter(environment, vi.fn());
    expect(adapter.verifyWebhook({ body, timestamp: null, signature: null, paddleSignature: `ts=${timestamp};h1=${signature}`, at })).toEqual({ kind: "ignored", provider: "paddle", eventId: "evt_renewal", reason: "recurring_or_adjustment_transaction" });
  });

  it("rejects a signed event when Paddle totals do not match the immutable local quote", () => {
    const body = JSON.stringify({ event_id: "evt_bad_total", event_type: "transaction.completed", occurred_at: "2026-09-05T12:00:01.000Z", data: { ...transaction, details: { totals: { total: "999" } } } });
    const timestamp = Math.floor(at.getTime() / 1000);
    const signature = createHmac("sha256", environment.PADDLE_WEBHOOK_SECRET).update(`${timestamp}:${body}`).digest("hex");
    const adapter = new PaddleMerchantOfRecordAdapter(environment, vi.fn());
    expect(adapter.verifyWebhook({ body, timestamp: null, signature: null, paddleSignature: `ts=${timestamp};h1=${signature}`, at })).toEqual({ kind: "invalid" });
  });

  it("creates a short-lived customer portal session and validates its host", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { urls: { general: { overview: "https://customer-portal.paddle.com/session/1" } } } }), { status: 201 }));
    const adapter = new PaddleMerchantOfRecordAdapter(environment, fetcher, () => new Date("2026-09-05T12:00:00.000Z"));
    await expect(adapter.createPortal({ workspaceId: "workspace_1", customerRef: "ctm_01test", returnPath: "/billing" })).resolves.toEqual({ kind: "ready", url: "https://customer-portal.paddle.com/session/1", expiresAt: new Date("2026-09-05T12:30:00.000Z") });
  });
});
