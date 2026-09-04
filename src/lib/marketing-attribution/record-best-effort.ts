import "server-only";
import { getMarketingAttributionService } from "./production";
import type { MarketingAttributionEventName } from "./types";

export async function recordMarketingAttributionBestEffort(input: { workspaceId: string; userId: string; email: string | null | undefined; eventName: MarketingAttributionEventName; occurredAt: Date; value?: string; currency?: string; idempotencyKey: string }): Promise<"queued" | "not_eligible" | "failed"> {
  try {
    await getMarketingAttributionService().enqueue(input);
    return "queued";
  } catch (error) {
    if (error instanceof TypeError && ["ATTRIBUTION_NOT_CONFIGURED", "ATTRIBUTION_CONSENT_REQUIRED", "ATTRIBUTION_IDENTIFIER_REQUIRED"].includes(error.message)) return "not_eligible";
    return "failed";
  }
}
