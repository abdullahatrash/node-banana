import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/commercial/production", () => ({
  MERCHANT_OF_RECORD: { verifyWebhook: (...args: unknown[]) => mocks.verify(...args) },
  MERCHANT_CHECKOUTS: { applyVerifiedEvent: (...args: unknown[]) => mocks.apply(...args) },
}));

import { POST } from "./route";

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

  it("applies only a verified terminal checkout event", async () => {
    const event = { eventId: "evt_1" };
    mocks.verify.mockReturnValue({ kind: "event", event });
    mocks.apply.mockResolvedValue({ state: "applied" });
    const response = await POST(new NextRequest("http://localhost/api/studio/webhooks/merchant", { method: "POST", body: "{}" }));
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledWith(event);
  });
});
