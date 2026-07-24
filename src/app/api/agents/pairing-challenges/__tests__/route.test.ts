import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCreatePairingChallenge = vi.fn();

vi.mock("@/lib/agent-auth", () => ({
  AGENT_AUTH_SERVICE: {
    createPairingChallenge: (...args: unknown[]) =>
      mockCreatePairingChallenge(...args),
  },
}));

import { POST } from "../route";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

it("passes a trusted client key into durable challenge rate limiting", async () => {
  vi.stubEnv("PAIRING_TRUSTED_PROXY", "cloudflare");
  mockCreatePairingChallenge.mockResolvedValue({
    challenge: "nbpc_selector_secret",
    confirmationId: "selector",
    expiresAt: "2026-07-24T12:05:00.000Z",
  });
  const request = new NextRequest(
    "http://localhost:3000/api/agents/pairing-challenges",
    {
      method: "POST",
      headers: {
        "cf-ray": "ray-id",
        "cf-connecting-ip": "198.51.100.20",
      },
      body: JSON.stringify({
        agentName: "Publisher",
        keyName: "Laptop",
        requestedAccess: ["content.read"],
      }),
    },
  );

  const response = await POST(request);
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(mockCreatePairingChallenge).toHaveBeenCalledWith({
    agentName: "Publisher",
    keyName: "Laptop",
    requestedAccess: ["content.read"],
    clientRateLimitKey: "ip:198.51.100.20",
  });
  expect(body.confirmationPath).toBe("/agents/pair/selector");
  expect(body.confirmationPath).not.toContain(body.challenge);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("returns 400 for malformed JSON without calling the service", async () => {
  const response = await POST(
    new NextRequest("http://localhost:3000/api/agents/pairing-challenges", {
      method: "POST",
      body: "{",
    }),
  );

  expect(response.status).toBe(400);
  expect(mockCreatePairingChallenge).not.toHaveBeenCalled();
});
