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
  DrizzlePublishingDeliveryCancellationAuthorizationRepository,
  DrizzlePublishingDeliveryExecutionReadinessRepository,
  DrizzlePublishingDeliveryRecoveryAuthorizationRepository,
  DrizzlePublishingDeliveryRepository,
} from "./postgres-repository";
import { DurablePublishingDeliveryQueue } from "./queue";
import { PublishingDeliveryService } from "./service";

export const PRODUCTION_PUBLISHING_DELIVERY_REPOSITORY =
  new DrizzlePublishingDeliveryRepository(getDb);
export const PRODUCTION_PUBLISHING_DELIVERY_AUTHORIZATION =
  new DrizzlePublishingDeliveryAuthorizationRepository(getDb);
export const PRODUCTION_PUBLISHING_DELIVERY_CANCELLATION_AUTHORIZATION =
  new DrizzlePublishingDeliveryCancellationAuthorizationRepository(getDb);
export const PRODUCTION_PUBLISHING_DELIVERY_EXECUTION_READINESS =
  new DrizzlePublishingDeliveryExecutionReadinessRepository(getDb);
export const PRODUCTION_PUBLISHING_DELIVERY_RECOVERY_AUTHORIZATION =
  new DrizzlePublishingDeliveryRecoveryAuthorizationRepository(getDb);
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
    undefined,
    PRODUCTION_PUBLISHING_DELIVERY_CANCELLATION_AUTHORIZATION,
    PRODUCTION_PUBLISHING_DELIVERY_RECOVERY_AUTHORIZATION,
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
    undefined,
    PRODUCTION_PUBLISHING_DELIVERY_EXECUTION_READINESS,
  );

export async function executeProductionPublishingDelivery(input: {
  workspaceId: string;
  deliveryId: string;
  workerId: string;
  purpose: "publish" | "reconcile";
}) {
  return PRODUCTION_PUBLISHING_DELIVERY_EXECUTION.executeOne(input);
}
