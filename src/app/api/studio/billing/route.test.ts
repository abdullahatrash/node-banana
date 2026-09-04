import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { authorize, startTrial, record } = vi.hoisted(() => ({ authorize: vi.fn(), startTrial: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/studio/authz", () => ({ authorizeStudioRequest: (...args: unknown[]) => authorize(...args), authzErrorResponse: (result: { status: number; error: string }) => NextResponse.json({ success: false, error: result.error }, { status: result.status }) }));
vi.mock("@/lib/commercial/production", () => ({ COMMERCIAL: { startTrial, summary: vi.fn(), acceptQuote: vi.fn(), createReferralCode: vi.fn() } }));
vi.mock("@/lib/marketing-attribution/record-best-effort", () => ({ recordMarketingAttributionBestEffort: (...args: unknown[]) => record(...args) }));

import { POST } from "./route";

describe("billing trial attribution producer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ authorized: true, userId: "user-1", workspaceId: "workspace-1", contentSession: { user: { email: "person@example.com" } } });
    startTrial.mockResolvedValue({ subscriptionState: "trialing", trialId: "trial-1", subscriptionEventId: "subscription-event-1", occurredAt: "2026-09-04T12:00:00.000Z" });
    record.mockResolvedValue("not_eligible");
  });

  it("records trial-start only after the commercial transaction succeeds", async () => {
    const response = await POST(new NextRequest("http://localhost/api/studio/billing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start_trial", planId: "pro", planVersion: 1, idempotencyKey: "trial-command-1" }) }), undefined);
    expect(response.status).toBe(200);
    expect(startTrial).toHaveBeenCalledBefore(record);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-1", userId: "user-1", email: "person@example.com", eventName: "trial_started", occurredAt: new Date("2026-09-04T12:00:00.000Z"), idempotencyKey: "xads:trial:subscription-event-1" }));
  });
});
