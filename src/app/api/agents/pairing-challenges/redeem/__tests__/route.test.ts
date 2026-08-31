import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRedeemPairing = vi.fn();

vi.mock("@/lib/agent-auth", () => ({
  AGENT_AUTH_SERVICE: {
    redeemPairing: (...args: unknown[]) => mockRedeemPairing(...args),
  },
}));

import { POST } from "../route";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

it("returns the plaintext key once without sponsor identity or hashes", async () => {
  vi.stubEnv("PAIRING_TRUSTED_PROXY", "vercel");
  mockRedeemPairing.mockResolvedValue({
    agentKey: "nbak_selector_secret",
    principal: {
      id: "principal-1",
      workspaceId: "workspace-1",
      sponsorUserId: "human-secret",
      name: "Publisher",
      status: "active",
    },
    key: {
      id: "key-1",
      name: "Initial key",
      lookupPrefix: "selector",
      expiresAt: null,
    },
  });
  const request = new NextRequest(
    "http://localhost:3000/api/agents/pairing-challenges/redeem",
    {
      method: "POST",
      headers: {
        "x-vercel-id": "iad1::request",
        "x-forwarded-for": "203.0.113.8",
      },
      body: JSON.stringify({ challenge: "nbpc_selector_secret" }),
    },
  );

  const response = await POST(request);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(mockRedeemPairing).toHaveBeenCalledWith({
    challenge: "nbpc_selector_secret",
    clientRateLimitKey: "ip:203.0.113.8",
    keyExpiresAt: undefined,
  });
  expect(body.agentKey).toBe("nbak_selector_secret");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(body)).not.toContain("human-secret");
  expect(JSON.stringify(body)).not.toContain("secretHash");
});

it("rejects a wrong-typed optional expiry", async () => {
  const response = await POST(
    new NextRequest(
      "http://localhost:3000/api/agents/pairing-challenges/redeem",
      {
        method: "POST",
        body: JSON.stringify({
          challenge: "nbpc_selector_secret",
          keyExpiresAt: 123,
        }),
      },
    ),
  );

  expect(response.status).toBe(400);
  expect(mockRedeemPairing).not.toHaveBeenCalled();
});
