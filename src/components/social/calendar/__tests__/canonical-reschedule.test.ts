import { describe, expect, it, vi } from "vitest";
import { StudioApiError } from "@/lib/studio/client";
import { canonicalCalendarReschedule } from "../canonical-reschedule";

describe("canonicalCalendarReschedule", () => {
  it("routes rescheduling through the canonical plan endpoint contract", async () => {
    const execute = vi.fn(async () => ({ kind: "rescheduled" as const, revision: { id: "revision_2", revision: 5 }, supersededApprovalId: "approval_1", requiresApproval: true as const }));
    await expect(canonicalCalendarReschedule({ postId: "post_1", scheduledAt: "2026-09-06T10:00:00.000Z", idempotencyKey: "calendar-request-1", confirmReleasedDelivery: () => false, execute })).resolves.toMatchObject({ kind: "rescheduled" });
    expect(execute).toHaveBeenCalledWith({ postId: "post_1", scheduledAt: "2026-09-06T10:00:00.000Z", confirmCancelReleasedDelivery: false, idempotencyKey: "calendar-request-1" });
  });

  it("requires explicit confirmation before retrying a released Delivery cancellation", async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new StudioApiError(409, "confirmation", { code: "EXPLICIT_CANCELLATION_REQUIRED" }))
      .mockResolvedValueOnce({ kind: "rescheduled", revision: { id: "revision_2", revision: 5 }, supersededApprovalId: null, requiresApproval: true });
    const confirmReleasedDelivery = vi.fn(() => true);
    await canonicalCalendarReschedule({ postId: "post_1", scheduledAt: "2026-09-06T10:00:00.000Z", idempotencyKey: "calendar-request-1", confirmReleasedDelivery, execute });
    expect(confirmReleasedDelivery).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ confirmCancelReleasedDelivery: true }));
  });
});
