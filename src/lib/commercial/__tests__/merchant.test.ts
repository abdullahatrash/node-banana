import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ConfiguredMerchantOfRecordAdapter } from "../merchant";

const environment = { MERCHANT_OF_RECORD_BASE_URL: "https://merchant.example/api", MERCHANT_OF_RECORD_API_TOKEN: "token", MERCHANT_OF_RECORD_ALLOWED_HOSTS: "checkout.example", MERCHANT_OF_RECORD_WEBHOOK_SECRET: "secret" };
const event = { provider: "merchant", eventId: "evt_1", eventType: "checkout.completed" as const, checkoutId: "checkout_1", merchantCheckoutRef: "remote_1", merchantEffectRef: "effect_1", merchantCustomerRef: "customer_1", merchantSubscriptionRef: "subscription_1", merchantReceiptRef: "receipt_1", periodStartsAt: "2026-09-01T00:00:00.000Z", periodEndsAt: "2026-10-01T00:00:00.000Z", occurredAt: "2026-09-01T00:00:00.000Z" };

describe("ConfiguredMerchantOfRecordAdapter", () => {
  it("fails closed without production configuration", async () => {
    const fetcher = vi.fn(); const adapter = new ConfiguredMerchantOfRecordAdapter({}, fetcher);
    await expect(adapter.createCheckout({ checkoutId: "c", workspaceId: "w", purposeKind: "credit_pack", purposeRef: "p", amountMinor: 100, taxMinor: 0, currency: "USD", termsDigest: `sha256:${"a".repeat(64)}`, commercialSnapshot: {}, successPath: "/ok", cancelPath: "/cancel" })).resolves.toEqual({ kind: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses a stable idempotency key and an allowlisted HTTPS redirect", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ merchantCheckoutRef: "remote_1", url: "https://checkout.example/session/1", expiresAt: "2026-09-04T12:30:00.000Z" }), { status: 200 }));
    const adapter = new ConfiguredMerchantOfRecordAdapter(environment, fetcher);
    const result = await adapter.createCheckout({ checkoutId: "checkout_1", workspaceId: "workspace_1", purposeKind: "subscription", purposeRef: "plan", amountMinor: 1000, taxMinor: 0, currency: "USD", termsDigest: `sha256:${"a".repeat(64)}`, commercialSnapshot: { planId: "pro" }, successPath: "/ok", cancelPath: "/cancel" });
    expect(result.kind).toBe("ready"); expect(fetcher).toHaveBeenCalledWith(new URL("https://merchant.example/api/checkouts"), expect.objectContaining({ method: "POST", redirect: "error", headers: expect.objectContaining({ "Idempotency-Key": "checkout_1", Authorization: "Bearer token" }) }));
  });

  it("rejects a provider redirect outside the configured host allowlist", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ merchantCheckoutRef: "remote_1", url: "https://attacker.example/session/1", expiresAt: "2026-09-04T12:30:00.000Z" }), { status: 200 }));
    await expect(new ConfiguredMerchantOfRecordAdapter(environment, fetcher).createCheckout({ checkoutId: "checkout_1", workspaceId: "workspace_1", purposeKind: "subscription", purposeRef: "plan", amountMinor: 1000, taxMinor: 0, currency: "USD", termsDigest: `sha256:${"a".repeat(64)}`, commercialSnapshot: {}, successPath: "/ok", cancelPath: "/cancel" })).rejects.toThrow("MERCHANT_REDIRECT_UNSAFE");
  });

  it("accepts only a fresh signature over the exact webhook bytes", () => {
    const body = JSON.stringify(event), timestamp = String(Date.parse("2026-09-01T00:01:00.000Z") / 1000), signature = `hmac-sha256=${createHmac("sha256", "secret").update(`${timestamp}.${body}`).digest("hex")}`;
    const adapter = new ConfiguredMerchantOfRecordAdapter(environment, vi.fn());
    expect(adapter.verifyWebhook({ body, timestamp, signature, paddleSignature: null, at: new Date("2026-09-01T00:02:00.000Z") })).toMatchObject({ kind: "event", event: { eventId: "evt_1" } });
    expect(adapter.verifyWebhook({ body: `${body} `, timestamp, signature, paddleSignature: null, at: new Date("2026-09-01T00:02:00.000Z") })).toEqual({ kind: "invalid" });
    expect(adapter.verifyWebhook({ body, timestamp, signature, paddleSignature: null, at: new Date("2026-09-01T00:20:00.000Z") })).toEqual({ kind: "invalid" });
  });
});
