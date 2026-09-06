import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), apply: vi.fn(), applySubscription: vi.fn(), recordCheckout: vi.fn(), recordSubscription: vi.fn(), applyAdjustment: vi.fn(), applyVerifiedAdjustment: vi.fn() }));
vi.mock("@/lib/commercial/production", () => ({
  MERCHANT_OF_RECORD: { verifyWebhook: (...args: unknown[]) => mocks.verify(...args) },
  MERCHANT_CHECKOUTS: { applyVerifiedEvent: (...args: unknown[]) => mocks.apply(...args) },
  MERCHANT_SUBSCRIPTIONS: { applyVerifiedEvent: (...args: unknown[]) => mocks.applySubscription(...args) },
  MERCHANT_FINANCIALS: { recordCheckout: (...args: unknown[]) => mocks.recordCheckout(...args), recordSubscription: (...args: unknown[]) => mocks.recordSubscription(...args), applyAdjustment: (...args: unknown[]) => mocks.applyAdjustment(...args) },
  MERCHANT_ADJUSTMENT_INBOX: { applyVerifiedEvent: (...args: unknown[]) => mocks.applyVerifiedAdjustment(...args) },
}));

import { POST } from "./route";
import { MerchantFinancialEvidenceError } from "@/lib/commercial/financial-evidence";

describe("merchant webhook route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the raw Paddle signature and rejects invalid verification", async () => {
    mocks.verify.mockReturnValue({ kind: "invalid" });
    const response = await POST(new NextRequest("http://localhost/api/studio/webhooks/merchant", { method: "POST", headers: { "paddle-signature": "ts=1;h1=abc" }, body: "{ exact bytes }" }));
    expect(response.status).toBe(401);
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ body: "{ exact bytes }", paddleSignature: "ts=1;h1=abc" }));
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("acknowledges a valid irrelevant event without applying a checkout effect", async () => {
    mocks.verify.mockReturnValue({ kind: "ignored", provider: "paddle", eventId: "evt_renewal", reason: "recurring_or_adjustment_transaction" });
    const response = await POST(new NextRequest("http://localhost/api/studio/webhooks/merchant", { method: "POST", body: "{}" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, result: { state: "ignored", reason: "recurring_or_adjustment_transaction" } });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("delegates a verified terminal checkout as one fulfillment operation", async () => {
    const event = { eventId: "evt_1" };
    mocks.verify.mockReturnValue({ kind: "checkout_event", event });
    mocks.apply.mockResolvedValue({ state: "applied" });
    const response = await POST(new NextRequest("http://localhost/api/studio/webhooks/merchant", { method: "POST", body: "{}" }));
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith(event);
    expect(mocks.recordCheckout).not.toHaveBeenCalled();
  });

  it("routes verified subscription events to the lifecycle projector", async () => {
    const event = { eventId: "evt_subscription" };
    mocks.verify.mockReturnValue({ kind: "subscription_event", event });
    mocks.applySubscription.mockResolvedValue({ state: "applied" });
    mocks.recordSubscription.mockResolvedValue({ state: "recorded" });
    const response = await POST(new NextRequest("http://localhost/api/studio/webhooks/merchant", { method: "POST", body: "{}" }));
    expect(response.status).toBe(200);
    expect(mocks.applySubscription).toHaveBeenCalledWith(event);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("projects a signed adjustment without invoking checkout fulfillment", async () => {
    const event = { eventId: "evt_adjustment" };
    mocks.verify.mockReturnValue({ kind: "adjustment_event", event });
    mocks.applyVerifiedAdjustment.mockResolvedValue({ state: "applied" });
    const response = await POST(new NextRequest("http://localhost/api/studio/webhooks/merchant", { method: "POST", body: "{}" }));
    expect(response.status).toBe(200);
    expect(mocks.applyVerifiedAdjustment).toHaveBeenCalledWith(event);
    expect(mocks.applyAdjustment).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.applySubscription).not.toHaveBeenCalled();
  });

  it("durably accepts an adjustment that arrived before its transaction dependency", async () => {
    const event = { eventId: "evt_adjustment_early", transactionRef: "txn_later" };
    mocks.verify.mockReturnValue({ kind: "adjustment_event", event });
    mocks.applyVerifiedAdjustment.mockResolvedValueOnce({ state: "pending_dependency" });

    const response = await POST(new NextRequest("http://localhost/api/studio/webhooks/merchant", { method: "POST", body: "{}" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ success: true, result: { state: "pending_dependency" } });
    expect(mocks.applyAdjustment).not.toHaveBeenCalled();
  });

  it("rejects the same provider event ID when its signed facts conflict", async () => {
    const event = { eventId: "evt_adjustment_replayed", transactionRef: "txn_changed" };
    mocks.verify.mockReturnValue({ kind: "adjustment_event", event });
    mocks.applyVerifiedAdjustment.mockRejectedValueOnce(new MerchantFinancialEvidenceError("ADJUSTMENT_INBOX_REPLAY_CONFLICT"));

    const response = await POST(new NextRequest("http://localhost/api/studio/webhooks/merchant", { method: "POST", body: "{}" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ success: false, code: "ADJUSTMENT_INBOX_REPLAY_CONFLICT" });
  });
});
