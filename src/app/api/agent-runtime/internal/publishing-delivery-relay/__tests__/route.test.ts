import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const relayNext = vi.fn();

vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/agent-runtime/internal-auth", () => ({
  ensureAgentRuntimeInternalAuth: () => null,
}));
vi.mock("@/lib/agent-runtime/publishing-deliveries/production", () => ({
  PRODUCTION_PUBLISHING_DELIVERY_EXECUTION: { relayNext },
}));

describe("Publishing Delivery relay route", () => {
  beforeEach(() => relayNext.mockReset());

  it("delivers a bounded batch of due scheduling intents", async () => {
    relayNext
      .mockResolvedValueOnce({ delivered: true, deliveryId: "delivery_1" })
      .mockResolvedValueOnce({ delivered: true, deliveryId: "delivery_2" })
      .mockResolvedValueOnce({ delivered: false });
    const { POST } = await import("../route");
    const response = await POST(
      new NextRequest(
        "http://localhost/api/agent-runtime/internal/publishing-delivery-relay?batch=10",
        { method: "POST" },
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      delivered: 2,
    });
    expect(relayNext).toHaveBeenCalledTimes(3);
  });

  it("returns only a stable scheduling error", async () => {
    relayNext.mockRejectedValueOnce(
      new Error("postgres://operator-secret@internal.invalid"),
    );
    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/agent-runtime/internal/publishing-delivery-relay",
      ),
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("scheduling is temporarily unavailable");
    expect(body).not.toContain("operator-secret");
  });
});
