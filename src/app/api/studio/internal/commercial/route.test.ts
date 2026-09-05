import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  outcome: vi.fn(),
}));

vi.mock("@/lib/studio/internal-auth", () => ({ ensureInternalStudioOrCronAuth: () => null }));
vi.mock("@/lib/commercial/production", () => ({
  COMMERCIAL: {
    verifyReferralRecipient: mocks.verify,
    recordReferralPayoutOutcome: mocks.outcome,
  },
}));

import { POST } from "./route";

const digest = `sha256:${"a".repeat(64)}`;
function request(body: unknown) {
  return new NextRequest("http://localhost/api/studio/internal/commercial", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("internal referral commercial commands", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records verified recipient evidence without accepting raw bank details", async () => {
    mocks.verify.mockResolvedValue({ revision: 2, verificationState: "verified" });
    const command = { action: "verify_referral_recipient", workspaceId: "workspace-1", userId: "user-1", decision: "verified", payoutProvider: "payout-provider", providerRecipientRef: "recipient-ref", taxEvidenceRef: "tax-ref", evidenceDigest: digest, reviewerRef: "system:payout-provider", idempotencyKey: "recipient-event-1" };
    const response = await POST(request(command));
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ providerRecipientRef: "recipient-ref", evidenceDigest: digest }));
  });

  it("converts provider occurrence time before applying a payout outcome", async () => {
    mocks.outcome.mockResolvedValue({ payoutRequestId: "payout-1", state: "paid", sequence: 2 });
    const response = await POST(request({ action: "record_referral_payout_outcome", workspaceId: "workspace-1", payoutRequestId: "payout-1", toState: "paid", providerEventRef: "provider-event-1", merchantPayoutRef: "transfer-1", evidenceDigest: digest, occurredAt: "2026-09-05T12:00:00.000Z", idempotencyKey: "payout-event-1" }));
    expect(response.status).toBe(200);
    expect(mocks.outcome).toHaveBeenCalledWith(expect.objectContaining({ occurredAt: new Date("2026-09-05T12:00:00.000Z") }));
  });
});
