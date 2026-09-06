import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const configured = vi.fn(() => true);
const enqueue = vi.fn();
const dispatch = vi.fn();
const reconcile = vi.fn();
const deleteExpired = vi.fn();
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => configured() }));
vi.mock("@/lib/marketing-attribution/production", () => ({ getMarketingAttributionService: () => ({ enqueue, dispatch, deleteExpired }), getMarketingAttributionCommercialReconciler: () => ({ reconcile }) }));

import { GET, POST } from "./route";

describe("internal marketing attribution worker", () => {
  beforeEach(() => {
    vi.clearAllMocks(); configured.mockReturnValue(true);
    process.env.STUDIO_INTERNAL_API_SECRET = "studio-secret";
    process.env.CRON_SECRET = "cron-secret";
    enqueue.mockResolvedValue({ replayed: false, event: { id: "event-1" } });
    dispatch.mockResolvedValue({ claimed: 0, skipped: "ATTRIBUTION_NOT_CONFIGURED" });
    reconcile.mockResolvedValue({ eligible: 0, skipped: "ATTRIBUTION_NOT_CONFIGURED" });
    deleteExpired.mockResolvedValue({ receipts: 1, events: 1, mutations: 1 });
  });

  it("authenticates before disclosing database state", async () => {
    configured.mockReturnValue(false);
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/marketing-attribution", { method: "POST", headers: { "x-studio-internal-secret": "wrong" }, body: "{}" }));
    expect(response.status).toBe(401);
    expect(configured).not.toHaveBeenCalled();
  });

  it("admits only a strict trusted-server conversion command", async () => {
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/marketing-attribution", { method: "POST", headers: { "x-studio-internal-secret": "studio-secret", "content-type": "application/json" }, body: JSON.stringify({ action: "enqueue", workspaceId: "workspace-1", userId: "user-1", email: "person@example.com", eventName: "trial_started", occurredAt: "2026-09-04T12:00:00.000Z", idempotencyKey: "trial-command-1" }) }));
    expect(response.status).toBe(200);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-1", userId: "user-1", eventName: "trial_started", occurredAt: new Date("2026-09-04T12:00:00.000Z") }));
  });

  it("runs bounded dispatch and retention through cron bearer authentication", async () => {
    const dispatched = await GET(new NextRequest("http://localhost/api/studio/internal/marketing-attribution?limit=500", { headers: { authorization: "Bearer cron-secret" } }));
    expect(dispatched.status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith(500);
    expect(dispatch).toHaveBeenCalledWith(100);
    const retained = await GET(new NextRequest("http://localhost/api/studio/internal/marketing-attribution?action=retention&limit=900", { headers: { authorization: "Bearer cron-secret" } }));
    expect(retained.status).toBe(200);
    expect(deleteExpired).toHaveBeenCalledWith(expect.any(Date), 900);
  });

  it("exposes bounded producer reconciliation to trusted operators", async () => {
    const response = await POST(new NextRequest("http://localhost/api/studio/internal/marketing-attribution", { method: "POST", headers: { "x-studio-internal-secret": "studio-secret", "content-type": "application/json" }, body: JSON.stringify({ action: "reconcile", limit: 37 }) }));
    expect(response.status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith(37);
  });
});
