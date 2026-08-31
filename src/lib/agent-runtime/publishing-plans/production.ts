import { getDb } from "@/lib/db";
import { PRODUCTION_ARTIFACT_SERVICE } from "@/lib/agent-runtime/artifacts";
import { PRODUCTION_BUDGET_SERVICE } from "@/lib/agent-runtime/budgets";
import {
  AesGcmPublishingPlanCursorCodec,
  publishingPlanCursorKeysFromEnvironment,
} from "./cursor";
import { DrizzlePublishingPlanRepository } from "./postgres-repository";
import {
  ArtifactServicePublishingPlanSnapshots,
  DrizzlePublishingPlanValidationContexts,
  ProductionPublishingPlanRuntimePolicy,
  SocialAccountPublishingPlanSnapshots,
} from "./production-adapters";
import { PublishingPlanRevisionService } from "./service";
import { PublishingPlanValidator } from "./validation";

export const PRODUCTION_PUBLISHING_PLAN_REPOSITORY =
  new DrizzlePublishingPlanRepository(getDb);
export const PRODUCTION_PUBLISHING_PLAN_ARTIFACT_SNAPSHOTS =
  new ArtifactServicePublishingPlanSnapshots(PRODUCTION_ARTIFACT_SERVICE);
export const PRODUCTION_PUBLISHING_PLAN_CHANNEL_SNAPSHOTS =
  new SocialAccountPublishingPlanSnapshots();
export const PRODUCTION_PUBLISHING_PLAN_VALIDATION_CONTEXTS =
  new DrizzlePublishingPlanValidationContexts(getDb);
export const PRODUCTION_PUBLISHING_PLAN_RUNTIME_POLICY =
  new ProductionPublishingPlanRuntimePolicy(PRODUCTION_BUDGET_SERVICE);
export const PRODUCTION_PUBLISHING_PLAN_VALIDATOR =
  new PublishingPlanValidator(
    PRODUCTION_PUBLISHING_PLAN_ARTIFACT_SNAPSHOTS,
    PRODUCTION_PUBLISHING_PLAN_CHANNEL_SNAPSHOTS,
    PRODUCTION_PUBLISHING_PLAN_RUNTIME_POLICY,
    PRODUCTION_PUBLISHING_PLAN_VALIDATION_CONTEXTS,
  );
export const PRODUCTION_PUBLISHING_PLAN_SERVICE =
  new PublishingPlanRevisionService(
    PRODUCTION_PUBLISHING_PLAN_REPOSITORY,
    PRODUCTION_PUBLISHING_PLAN_VALIDATOR,
  );
export const PRODUCTION_PUBLISHING_PLAN_CURSOR =
  new AesGcmPublishingPlanCursorCodec(
    publishingPlanCursorKeysFromEnvironment,
  );
