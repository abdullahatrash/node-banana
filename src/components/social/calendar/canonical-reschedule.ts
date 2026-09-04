import { StudioApiError } from "@/lib/studio/client";
import { reschedulePublishingPlanTarget } from "@/lib/social/client";

export async function canonicalCalendarReschedule(input: {
  postId: string;
  scheduledAt: string;
  confirmReleasedDelivery: () => boolean;
  idempotencyKey?: string;
  execute?: typeof reschedulePublishingPlanTarget;
}) {
  const execute = input.execute ?? reschedulePublishingPlanTarget;
  const idempotencyKey = input.idempotencyKey ?? `calendar-${input.postId}-${crypto.randomUUID()}`;
  const request = (confirmCancelReleasedDelivery: boolean) => execute({
    postId: input.postId,
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
