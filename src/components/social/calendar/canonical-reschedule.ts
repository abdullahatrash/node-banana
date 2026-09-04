import { StudioApiError } from "@/lib/studio/client";
import { reschedulePublishingPlanTarget } from "@/lib/social/client";
import type { CanonicalCalendarBinding } from "@/lib/product-surfaces/calendar-projection";

export async function canonicalCalendarReschedule(input: {
  source: CanonicalCalendarBinding;
  scheduledAt: string;
  confirmReleasedDelivery: () => boolean;
  idempotencyKey?: string;
  execute?: typeof reschedulePublishingPlanTarget;
}) {
  const execute = input.execute ?? reschedulePublishingPlanTarget;
  const idempotencyKey = input.idempotencyKey ?? `calendar-${input.source.planId}-${input.source.targetId}-${crypto.randomUUID()}`;
  const request = (confirmCancelReleasedDelivery: boolean) => execute({
    source: input.source,
    scheduledAt: input.scheduledAt,
    confirmCancelReleasedDelivery,
    idempotencyKey,
  });
  try {
    return await request(false);
  } catch (error) {
    if (!(error instanceof StudioApiError) || error.code !== "EXPLICIT_CANCELLATION_REQUIRED") throw error;
    if (!input.confirmReleasedDelivery()) throw error;
    return request(true);
  }
}
