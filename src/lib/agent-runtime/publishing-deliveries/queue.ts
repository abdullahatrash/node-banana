import { start } from "workflow/api";
import { executeRuntimePublishingDelivery } from
  "@/../workflows/runtime-publishing-delivery";
import type { PublishingDeliveryQueue } from "./execution";
import { publishingDeliveryOutboxDedupeKey } from "./keys";

export class DurablePublishingDeliveryQueue
  implements PublishingDeliveryQueue
{
  async schedule(input: Parameters<PublishingDeliveryQueue["schedule"]>[0]) {
    const prefix =
      `publishing-delivery:${input.workspaceId}:${input.deliveryId}:v`;
    const generation = input.dedupeKey.slice(prefix.length);
    if (
      (input.purpose !== "publish" && input.purpose !== "reconcile") ||
      !input.dedupeKey.startsWith(prefix) ||
      !/^[1-9][0-9]*$/.test(generation) ||
      input.dedupeKey !== publishingDeliveryOutboxDedupeKey(
        input.workspaceId,
        input.deliveryId,
        Number(generation),
      )
    ) {
      throw new Error("Publishing Delivery dispatch identity is invalid.");
    }
    await start(executeRuntimePublishingDelivery, [
      {
        workspaceId: input.workspaceId,
        deliveryId: input.deliveryId,
        purpose: input.purpose,
      },
    ]);
  }
}
