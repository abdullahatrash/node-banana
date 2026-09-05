import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { licensedTrendProviderSigningMessage } from "@/lib/product-surfaces/licensed-trend-provider-contract";

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockReceive = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
}));
vi.mock("@/lib/product-surfaces/licensed-trend-provider-inbox", () => ({
  LicensedTrendProviderInboxError: class LicensedTrendProviderInboxError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  PRODUCTION_LICENSED_TREND_PROVIDER_INBOX: { receive: (...args: unknown[]) => mockReceive(...args) },
}));

const providerKey = "licensed.partner";
const keyId = "partner-2026";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

function request(input?: { payload?: unknown; signature?: string }) {
  const payload = input?.payload ?? {
    schema: "licensed-trend-provider-event/v1",
    action: "set_catalog_state",
    catalogId: "catalog-1",
    state: "paused",
  };
  const body = JSON.stringify(payload);
  const occurredAt = new Date(Date.now() - 60_000).toISOString();
  const eventDigest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const signature = input?.signature ?? sign(null, Buffer.from(licensedTrendProviderSigningMessage({
    providerKey,
    eventId: "event-1",
    sequence: 1,
    occurredAt,
    eventDigest,
  })), privateKey).toString("base64url");
  return new NextRequest(`http://localhost:3000/api/studio/webhooks/licensed-trends/${providerKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-trend-event-id": "event-1",
      "x-trend-sequence": "1",
      "x-trend-occurred-at": occurredAt,
      "x-trend-key-id": keyId,
      "x-trend-signature": signature,
    },
    body,
  });
}

const context = { params: Promise.resolve({ providerKey }) };

describe("licensed trend provider webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockReceive.mockResolvedValue({ kind: "accepted", event: { state: "queued" } });
    process.env.LICENSED_TREND_PROVIDER_PUBLIC_KEYS_JSON = JSON.stringify({
      [providerKey]: { [keyId]: publicKey.export({ format: "pem", type: "spki" }).toString() },
    });
  });

  it("accepts a verified event without processing provider effects inline", async () => {
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ success: true, result: { kind: "accepted", state: "queued" } });
    expect(mockReceive).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({ providerKey, eventId: "event-1", sequence: 1 }),
      payload: expect.objectContaining({ action: "set_catalog_state" }),
    }));
  });

  it("returns a replay receipt for the same immutable event", async () => {
    mockReceive.mockResolvedValue({ kind: "replayed", event: { state: "succeeded" } });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect((await response.json()).result).toEqual({ kind: "replayed", state: "succeeded" });
  });

  it("rejects invalid signatures before touching the inbox", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ signature: "a".repeat(86) }), context);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("LICENSED_TREND_PROVIDER_SIGNATURE_INVALID");
    expect(mockReceive).not.toHaveBeenCalled();
  });

  it("fails closed when persistence is unavailable", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("DATABASE_REQUIRED");
  });
});
