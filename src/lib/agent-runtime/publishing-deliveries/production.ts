import { getDb } from "@/lib/db";
import { PRODUCTION_PUBLISHING_APPROVAL_REVISIONS } from
  "../publishing-approvals/production";
import {
  AesGcmPublishingDeliveryCursorCodec,
  publishingDeliveryCursorKeysFromEnvironment,
} from "./cursor";
import { PublishingDeliveryExecutionService } from "./execution";
import { PublishingPlatformRegistry } from "./platform-registry";
import {
  DrizzlePublishingDeliveryAuthorizationRepository,
  DrizzlePublishingDeliveryRepository,
} from "./postgres-repository";
import { DurablePublishingDeliveryQueue } from "./queue";
import { PublishingDeliveryService } from "./service";

export const PRODUCTION_PUBLISHING_DELIVERY_REPOSITORY =
  new DrizzlePublishingDeliveryRepository(getDb);
export const PRODUCTION_PUBLISHING_DELIVERY_AUTHORIZATION =
  new DrizzlePublishingDeliveryAuthorizationRepository(getDb);
export const PRODUCTION_PUBLISHING_DELIVERY_CURSOR =
  new AesGcmPublishingDeliveryCursorCodec(
    publishingDeliveryCursorKeysFromEnvironment,
  );
export const PRODUCTION_PUBLISHING_DELIVERY_SERVICE =
  new PublishingDeliveryService(
    PRODUCTION_PUBLISHING_DELIVERY_REPOSITORY,
    PRODUCTION_PUBLISHING_APPROVAL_REVISIONS,
    PRODUCTION_PUBLISHING_APPROVAL_REVISIONS,
    PRODUCTION_PUBLISHING_DELIVERY_AUTHORIZATION,
  );

/**
 * Live Platform Adapters are registered only when their credential and retained
 * Artifact boundaries are available. The deterministic fake is test-only and
 * is never allowed to claim a real publication in production.
 */
export const PRODUCTION_PUBLISHING_PLATFORM_REGISTRY =
  new PublishingPlatformRegistry();

export const PRODUCTION_PUBLISHING_DELIVERY_EXECUTION =
  new PublishingDeliveryExecutionService(
    PRODUCTION_PUBLISHING_DELIVERY_REPOSITORY,
    new DurablePublishingDeliveryQueue(),
    PRODUCTION_PUBLISHING_PLATFORM_REGISTRY,
  );

export async function executeProductionPublishingDelivery(input: {
  workspaceId: string;
  deliveryId: string;
  workerId: string;
}) {
  return PRODUCTION_PUBLISHING_DELIVERY_EXECUTION.executeOne(input);
}
