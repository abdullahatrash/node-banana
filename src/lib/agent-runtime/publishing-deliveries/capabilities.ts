import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import {
  COMMON_DISCOVERY_ERRORS,
  QUERY_EFFECT,
  defineCapability,
} from "@/lib/agent-tools/registry";
import type {
  CapabilityRegistration,
  JsonSchema,
  ResolvedSecurityContext,
} from "@/types/capabilities";
import { z } from "zod";
import { ARTIFACT_ID_PATTERN } from "../artifacts/validation";
import {
  PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES,
  PUBLISHING_DELIVERY_CANCEL_AUTHORIZATION,
  PUBLISHING_DELIVERY_RECONCILE_AUTHORIZATION,
  PUBLISHING_DELIVERY_EVENTS_AUTHORIZATION,
  PUBLISHING_DELIVERY_GET_AUTHORIZATION,
  PUBLISHING_DELIVERY_LIST_AUTHORIZATION,
  PUBLISHING_DELIVERY_RELEASE_AUTHORIZATION,
  PUBLISHING_DELIVERY_RETRY_AUTHORIZATION,
  publishingDeliveryReleaseAuthorizationContractDigest,
  publishingDeliveryCancelAuthorizationContractDigest,
  publishingDeliveryReconcileAuthorizationContractDigest,
  publishingDeliveryRetryAuthorizationContractDigest,
} from "./authorization-contract";
import { InvalidPublishingDeliveryCursorError } from "./cursor";
import {
  PUBLISHING_DELIVERY_ERROR_CATALOG,
  PUBLISHING_DELIVERY_ERROR_CONTRACTS,
  PublishingDeliveryServiceError,
} from "./errors";
import { PublishingDeliveryService } from "./service";
import { PUBLISHING_DELIVERY_EFFECT_KEY_PATTERN } from "./keys";
import type {
  PublishingDeliveryCancellationActor,
  PublishingDeliveryCursorCodec,
  PublishingDeliveryState,
} from "./types";

export {
  PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES,
  PUBLISHING_DELIVERY_RELEASE_AUTHORIZATION,
  PUBLISHING_DELIVERY_CANCEL_AUTHORIZATION,
  PUBLISHING_DELIVERY_RETRY_AUTHORIZATION,
  PUBLISHING_DELIVERY_RECONCILE_AUTHORIZATION,
  publishingDeliveryCancelAuthorizationContractDigest,
  publishingDeliveryRetryAuthorizationContractDigest,
  publishingDeliveryReconcileAuthorizationContractDigest,
  publishingDeliveryReleaseAuthorizationContractDigest,
} from "./authorization-contract";

const lifecycle = {
  status: "active",
  introducedAt: "2026-08-09T00:00:00.000Z",
  recommended: true,
} as const;
const releaseEffect = {
  mutation: "runtime-state",
  visibility: "private",
  timing: "durable-async",
  reversibility: "conditional",
  maySpendProviderBudget: false,
} as const;
const cancelEffect = {
  mutation: "runtime-state",
  visibility: "private",
  timing: "immediate",
  reversibility: "conditional",
  maySpendProviderBudget: false,
} as const;
const retryEffect = {
  mutation: "external-system",
  visibility: "publicly-visible",
  timing: "durable-async",
  reversibility: "irreversible",
  maySpendProviderBudget: true,
} as const;
const reconcileEffect = {
  mutation: "runtime-state",
  visibility: "private",
  timing: "durable-async",
  reversibility: "conditional",
  maySpendProviderBudget: false,
} as const;
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const artifactId = z.string().min(1).max(200).regex(ARTIFACT_ID_PATTERN);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const iso = z.string().datetime({ offset: true });
const effectKey = z.string().regex(PUBLISHING_DELIVERY_EFFECT_KEY_PATTERN);
const failureCode = z.string().min(1).max(80).regex(/^[A-Z][A-Z0-9_]*$/);
const states = z.enum([
  "scheduled",
  "dispatching",
  "blocked",
  "confirmation_pending",
  "succeeded",
  "failed_transient",
  "failed_terminal",
  "outcome_unknown",
  "cancelled",
]);
const resources = {
  channelIds: z.array(id).min(1).max(50),
  artifactIds: z.array(artifactId).min(1).max(200),
};
const acceptedRef = z.object({
  id,
  targetId: id,
  channelId: id,
  publishAt: iso,
  state: z.literal("scheduled"),
  effectKey,
  acceptedAt: iso,
  scheduledAt: iso,
  externallyCompleted: z.literal(false),
}).strict();
const durableAcceptance = z.object({
  schema: z.literal("publishing-delivery-durable-acceptance/v1"),
  releaseId: id,
  approvalRequestId: id,
  approvalDecisionId: id,
  deliveries: z.array(acceptedRef).min(1).max(50),
  acceptedAt: iso,
  durable: z.literal(true),
  externallyCompleted: z.literal(false),
}).strict();
const cancellation = z.object({
  schema: z.literal("publishing-delivery-cancellation/v1"),
  cancellationId: id,
  deliveryId: id,
  desiredState: z.literal("cancel"),
  stateAtRequest: states,
  outcome: z.enum(["prevented", "conditional", "unknown", "too_late"]),
  externallyCompletedAtRequest: z.boolean().nullable(),
  requestedAt: iso,
  durable: z.literal(true),
  externallyReversed: z.literal(false),
}).strict();
const retryAcceptance = z.object({
  schema: z.literal("publishing-delivery-retry/v1"),
  retryId: id,
  sourceDeliveryId: id,
  sourceEvidenceDigest: digest,
  delivery: acceptedRef,
  requestedAt: iso,
  durable: z.literal(true),
  externallyCompleted: z.literal(false),
}).strict();
const reconciliationAcceptance = z.object({
  schema: z.literal("publishing-delivery-reconciliation/v1"),
  reconciliationId: id,
  deliveryId: id,
  sourceEvidenceDigest: digest,
  effectKey,
  effectGeneration: z.number().int().min(1),
  status: z.enum(["queued", "completed"]),
  resolution: z.enum([
    "succeeded",
    "failed_transient",
    "failed_terminal",
    "still_unknown",
    "operator_required",
  ]).nullable(),
  requestedAt: iso,
  completedAt: iso.nullable(),
  durable: z.literal(true),
  externallyCompleted: z.boolean().nullable(),
}).strict();
const normalizedTarget = z.object({
  targetId: id,
  channelId: id,
  contentArtifactId: artifactId,
  mediaArtifactIds: z.array(artifactId).max(50),
  settings: z.object({ type: z.enum(["person", "organization"]) }).strict(),
  timing: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("now"), publishAt: iso }).strict(),
    z.object({ kind: z.literal("scheduled"), publishAt: iso }).strict(),
  ]),
}).strict();
const targetValidation = z.object({
  targetId: id,
  channel: z.object({
    id,
    platform: z.literal("linkedin"),
    authorKind: z.enum(["person", "organization"]),
    snapshotDigest: digest,
    capabilityVersion: digest,
  }).strict(),
  artifacts: z.array(z.object({
    id: artifactId,
    digest,
    snapshotDigest: digest,
    kind: z.enum(["text", "image"]),
    mediaType: z.enum(["text/plain; charset=utf-8", "image/jpeg", "image/png", "image/gif"]),
    sizeBytes: z.number().int().nonnegative().max(52_428_800),
  }).strict()).min(1).max(51),
  settingsDigest: digest,
  publishAt: iso,
  policyEvidenceDigest: digest,
  policyStateDigest: digest,
  blockerCodes: z.tuple([]),
}).strict();
const targetSnapshot = z.object({
  schema: z.literal("publishing-delivery-target-snapshot/v1"),
  target: normalizedTarget,
  validation: targetValidation,
  targetDigest: digest,
}).strict();
const delivery = z.object({
  id,
  workspaceId: id,
  releaseId: id.nullable(),
  sourceDeliveryId: id.nullable(),
  retryId: id.nullable(),
  planId: id,
  planRevisionId: id,
  planRevision: z.number().int().min(1),
  planRevisionDigest: digest,
  approvalRequestId: id,
  approvalDecisionId: id,
  requestingPrincipalId: id,
  requestingKeyId: id,
  targetId: id,
  channelId: id,
  artifactIds: z.array(artifactId).min(1).max(51),
  targetSnapshot,
  targetSnapshotDigest: digest,
  publishAt: iso,
  desiredState: z.enum(["publish", "cancel"]),
  state: states,
  effectKey,
  effectGeneration: z.number().int().min(1),
  intentDigest: digest.nullable(),
  providerAdapterContractDigest: digest.nullable(),
  providerOperationRef: z.string().min(1).max(500).nullable(),
  nextEffectAttempt: z.number().int().min(1),
  latestEffectEvidenceDigest: digest.nullable(),
  failureCode: failureCode.nullable(),
  failureClass: z.enum(["transient", "terminal"]).nullable(),
  failureRetryable: z.boolean().nullable(),
  failureEffectDisposition: z.enum([
    "not_created",
    "provider_failed_known",
    "ambiguous",
  ]).nullable(),
  readinessBlockCode: z.enum([
    "CHANNEL_UNAVAILABLE",
    "CREDENTIAL_UNAVAILABLE",
    "EXECUTION_AUTHORIZATION_REVOKED",
    "APPROVAL_NO_LONGER_VALID",
    "VALIDATION_STALE",
  ]).nullable(),
  readinessEvidenceDigest: digest.nullable(),
  readinessBlockedAt: iso.nullable(),
  readinessRetryAt: iso.nullable(),
  readinessBlockCount: z.number().int().nonnegative(),
  nextEventSequence: z.number().int().min(1),
  nextOutboxGeneration: z.number().int().min(2),
  acceptedAt: iso,
  scheduledAt: iso,
  dispatchStartedAt: iso.nullable(),
  effectContactStartedAt: iso.nullable(),
  completedAt: iso.nullable(),
  updatedAt: iso,
  externallyCompleted: z.boolean().nullable(),
}).strict().refine((value) =>
  (value.releaseId !== null && value.sourceDeliveryId === null && value.retryId === null) ||
  (value.releaseId === null && value.sourceDeliveryId !== null && value.retryId !== null),
{ message: "Publishing Delivery origin must be exactly release or retry." });
const deliveryPage = z.object({
  schema: z.literal("publishing-delivery-page/v1"),
  items: z.array(delivery).max(100),
  nextCursor: z.string().min(1).max(2_048).nullable(),
}).strict();
const eventBase = {
  schema: z.literal("publishing-delivery-event/v1"),
  id,
  workspaceId: id,
  deliveryId: id,
  sequence: z.number().int().min(1),
  occurredAt: iso,
};
const effectEvidence = { effectKey, evidenceDigest: digest };
const retainedEvent = z.discriminatedUnion("type", [
  z.object({ ...eventBase, type: z.literal("delivery.blocked"), evidence: z.object({ failureCode: z.enum(["CHANNEL_UNAVAILABLE", "CREDENTIAL_UNAVAILABLE", "EXECUTION_AUTHORIZATION_REVOKED", "APPROVAL_NO_LONGER_VALID", "VALIDATION_STALE"]), evidenceDigest: digest, retryAt: iso, blockCount: z.number().int().min(1) }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("delivery.resumed"), evidence: z.object({ priorFailureCode: z.enum(["CHANNEL_UNAVAILABLE", "CREDENTIAL_UNAVAILABLE", "EXECUTION_AUTHORIZATION_REVOKED", "APPROVAL_NO_LONGER_VALID", "VALIDATION_STALE"]), priorEvidenceDigest: digest, readinessEvidenceDigest: digest }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("delivery.accepted"), evidence: z.discriminatedUnion("origin", [
    z.object({ origin: z.literal("release"), releaseId: id, sourceDeliveryId: z.null(), retryId: z.null(), approvalRequestId: id, approvalDecisionId: id, targetSnapshotDigest: digest }).strict(),
    z.object({ origin: z.literal("retry"), releaseId: z.null(), sourceDeliveryId: id, retryId: id, approvalRequestId: id, approvalDecisionId: id, targetSnapshotDigest: digest }).strict(),
  ]) }).strict(),
  z.object({ ...eventBase, type: z.literal("delivery.scheduled"), evidence: z.object({ publishAt: iso }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("effect.prepared"), evidence: z.object({ effectKey, effectGeneration: z.number().int().min(1), intentDigest: digest, providerAdapterContractDigest: digest }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("effect.contact_started"), evidence: z.object({ effectKey, effectGeneration: z.number().int().min(1), intentDigest: digest, providerAdapterContractDigest: digest, readinessEvidenceDigest: digest }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("delivery.cancellation_requested"), evidence: z.object({ cancellationId: id, actorKind: z.enum(["agent", "human"]), effectDisposition: z.enum(["not_created", "contact_started", "provider_accepted", "terminal"]) }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("delivery.cancelled"), evidence: z.object({ cancellationId: id, effectKey, effectDisposition: z.literal("not_created") }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("effect.not_created"), evidence: z.object({ ...effectEvidence, effectGeneration: z.number().int().min(1), failureCode, failureClass: z.enum(["transient", "terminal"]), retryable: z.boolean(), effectDisposition: z.literal("not_created") }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.retry_scheduled"), evidence: z.object({ ...effectEvidence, failureCode, retryAt: iso }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.confirmation_pending"), evidence: z.object({ ...effectEvidence, providerOperationRef: z.string().min(1).max(500), pollAt: iso }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.succeeded"), evidence: z.object({ ...effectEvidence, providerOperationRef: z.string().min(1).max(500), failureCode: z.null() }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.failed"), evidence: z.object({ ...effectEvidence, providerOperationRef: z.string().min(1).max(500).nullable(), failureCode }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.failed_transient"), evidence: z.object({ ...effectEvidence, effectGeneration: z.number().int().min(1), providerOperationRef: z.string().min(1).max(500).nullable(), failureCode, failureClass: z.literal("transient"), retryable: z.literal(true), effectDisposition: z.enum(["not_created", "provider_failed_known"]) }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.failed_terminal"), evidence: z.object({ ...effectEvidence, effectGeneration: z.number().int().min(1), providerOperationRef: z.string().min(1).max(500).nullable(), failureCode, failureClass: z.literal("terminal"), retryable: z.literal(false), effectDisposition: z.enum(["not_created", "provider_failed_known"]) }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.outcome_unknown"), evidence: z.object({ ...effectEvidence, providerOperationRef: z.string().min(1).max(500).nullable(), failureCode }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("delivery.retry_requested"), evidence: z.object({ retryId: id, sourceDeliveryId: id, approvalRequestId: id, approvalDecisionId: id, sourceEffectKey: effectKey, sourceEffectGeneration: z.number().int().min(1), sourceEvidenceDigest: digest, deliveryId: id, effectKey }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("delivery.reconciliation_requested"), evidence: z.object({ reconciliationId: id, effectKey, effectGeneration: z.number().int().min(1), sourceEvidenceDigest: digest }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("delivery.reconciled"), evidence: z.object({ reconciliationId: id, effectKey, effectGeneration: z.number().int().min(1), sourceEvidenceDigest: digest, evidenceDigest: digest, resolution: z.enum(["succeeded", "failed_transient", "failed_terminal", "still_unknown", "operator_required"]), providerOperationRef: z.string().min(1).max(500).nullable(), failureCode: failureCode.nullable(), retryable: z.boolean().nullable() }).strict() }).strict(),
]);
const eventPage = z.object({
  schema: z.literal("publishing-delivery-event-page/v1"),
  items: z.array(retainedEvent).max(100),
  nextAfterSequence: z.number().int().min(1).nullable(),
}).strict();

function schema(value: z.ZodType): JsonSchema {
  return z.toJSONSchema(value, { target: "draft-7" }) as JsonSchema;
}

function agent(context: ResolvedSecurityContext | undefined) {
  if (!context || context.kind !== "agent") {
    throw new CapabilityFailure({
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Publishing Delivery capability is not authorized.",
    });
  }
  return context;
}

function recoveryActor(
  context: ResolvedSecurityContext | undefined,
): { workspaceId: string; actor: PublishingDeliveryCancellationActor } {
  if (!context) {
    throw new CapabilityFailure({
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Publishing Delivery cancellation is not authorized.",
    });
  }
  return context.kind === "agent"
    ? {
        workspaceId: context.workspaceId,
        actor: {
          kind: "agent",
          principalId: context.principalId,
          keyId: context.keyId,
        },
      }
    : {
        workspaceId: context.workspaceId,
        actor: { kind: "human", userId: context.userId },
      };
}

function authorizationEvidence(context: {
  authorizationAdmission?: { operatorTraceRef?: string };
}): string {
  const value = context.authorizationAdmission?.operatorTraceRef?.trim();
  if (!value) {
    throw new CapabilityFailure({
      code: "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
      category: "internal",
      message: "Release authorization evidence is unavailable.",
      retryable: true,
    });
  }
  return value;
}

function cancellationAdmissionEvidence(context: {
  authorizationAdmission?: { operatorTraceRef?: string };
}): string {
  const value = context.authorizationAdmission?.operatorTraceRef?.trim();
  if (!value) {
    throw new CapabilityFailure({
      code: "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED",
      category: "authorization",
      message: "Cancellation authorization evidence is unavailable.",
    });
  }
  return value;
}

function recoveryAdmissionEvidence(context: {
  authorizationAdmission?: { operatorTraceRef?: string };
}): string {
  const value = context.authorizationAdmission?.operatorTraceRef?.trim();
  if (!value) {
    throw new CapabilityFailure({
      code: "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Publishing Delivery recovery authorization evidence is unavailable.",
    });
  }
  return value;
}

async function domain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InvalidPublishingDeliveryCursorError) {
      throw new CapabilityFailure({
        code: "PUBLISHING_DELIVERY_INVALID_INPUT",
        category: "validation",
        message: error.message,
      });
    }
    if (!(error instanceof PublishingDeliveryServiceError)) throw error;
    const contract = PUBLISHING_DELIVERY_ERROR_CATALOG[error.code];
    throw new CapabilityFailure({
      code: error.code,
      category: contract.category,
      message: error.message,
      retryable: contract.retryable,
      details: error.details,
    });
  }
}

function filterDigest(input: {
  planRevisionId?: string;
  state?: PublishingDeliveryState;
  targetId?: string;
  channelIds: string[];
  artifactIds: string[];
}): string {
  return canonicalDigest({
    schema: "publishing-delivery-list-filter/v1",
    planRevisionId: input.planRevisionId ?? null,
    state: input.state ?? null,
    targetId: input.targetId ?? null,
    channelIds: [...input.channelIds].sort(),
    artifactIds: [...input.artifactIds].sort(),
  });
}

export function createPublishingDeliveryRegistrations(
  service: PublishingDeliveryService,
  cursorCodec?: PublishingDeliveryCursorCodec,
): CapabilityRegistration[] {
  return [
    defineCapability({
      identity: PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.release,
      audience: "agent",
      summary: "Release one exact approved Publishing Plan Revision into durable per-target scheduling intent.",
      lifecycle,
      input: z.object({
        approvalRequestId: id,
        ...resources,
        idempotencyKey: z.string().min(8).max(200).regex(/^[!-~]+$/),
      }).strict(),
      outputSchema: schema(durableAcceptance),
      effect: releaseEffect,
      approval: { mode: "required-before-effect" },
      idempotency: { mode: "key-required" },
      authorization: PUBLISHING_DELIVERY_RELEASE_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_DELIVERY_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() => service.release({
          ...input,
          workspaceId: principal.workspaceId,
          principalId: principal.principalId,
          keyId: principal.keyId,
          authorizationEvidenceRef: authorizationEvidence(context),
          authorizationContractDigest: publishingDeliveryReleaseAuthorizationContractDigest(),
        }));
      },
    }),
    defineCapability({
      identity: PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.cancel,
      audience: "shared",
      summary: "Durably request cancellation of one future Publishing Delivery without claiming external reversal.",
      lifecycle,
      input: z.object({ deliveryId: id, ...resources }).strict(),
      outputSchema: schema(cancellation),
      effect: cancelEffect,
      approval: { mode: "none" },
      idempotency: { mode: "intrinsic" },
      authorization: PUBLISHING_DELIVERY_CANCEL_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_DELIVERY_ERROR_CONTRACTS],
      handler: (input, context) => {
        const caller = recoveryActor(context.securityContext);
        return domain(() => service.cancel({
          ...input,
          workspaceId: caller.workspaceId,
          actor: caller.actor,
          authorizationEvidenceRef: cancellationAdmissionEvidence(context),
          authorizationContractDigest:
            publishingDeliveryCancelAuthorizationContractDigest(),
        }));
      },
    }),
    defineCapability({
      identity: PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.retry,
      audience: "shared",
      summary: "Create one derived Delivery for a provider-proven known failure under a fresh exact Approval.",
      lifecycle,
      input: z.object({
        deliveryId: id,
        approvalRequestId: id,
        expectedFailureEvidenceDigest: digest,
        idempotencyKey: z.string().min(8).max(200).regex(/^[!-~]+$/),
        ...resources,
      }).strict(),
      outputSchema: schema(retryAcceptance),
      effect: retryEffect,
      approval: { mode: "required-before-effect" },
      idempotency: { mode: "key-required" },
      authorization: PUBLISHING_DELIVERY_RETRY_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_DELIVERY_ERROR_CONTRACTS],
      handler: (input, context) => {
        const caller = recoveryActor(context.securityContext);
        return domain(() => service.retry({
          ...input,
          workspaceId: caller.workspaceId,
          actor: caller.actor,
          authorizationEvidenceRef: recoveryAdmissionEvidence(context),
          authorizationContractDigest:
            publishingDeliveryRetryAuthorizationContractDigest(),
        }));
      },
    }),
    defineCapability({
      identity: PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.reconcile,
      audience: "shared",
      summary: "Observe one exact ambiguous Publishing Delivery effect without launching another public effect.",
      lifecycle,
      input: z.object({
        deliveryId: id,
        expectedUnknownEvidenceDigest: digest,
        ...resources,
      }).strict(),
      outputSchema: schema(reconciliationAcceptance),
      effect: reconcileEffect,
      approval: { mode: "none" },
      idempotency: { mode: "intrinsic" },
      authorization: PUBLISHING_DELIVERY_RECONCILE_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_DELIVERY_ERROR_CONTRACTS],
      handler: (input, context) => {
        const caller = recoveryActor(context.securityContext);
        return domain(() => service.reconcile({
          ...input,
          workspaceId: caller.workspaceId,
          actor: caller.actor,
          authorizationEvidenceRef: recoveryAdmissionEvidence(context),
          authorizationContractDigest:
            publishingDeliveryReconcileAuthorizationContractDigest(),
        }));
      },
    }),
    defineCapability({
      identity: PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.get,
      audience: "agent",
      summary: "Inspect one requester-scoped Publishing Delivery and its current external-completion state.",
      lifecycle,
      input: z.object({ deliveryId: id, ...resources }).strict(),
      outputSchema: schema(delivery),
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: PUBLISHING_DELIVERY_GET_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_DELIVERY_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() => service.get({
          workspaceId: principal.workspaceId,
          principalId: principal.principalId,
          deliveryId: input.deliveryId,
          authorizedChannelIds: input.channelIds,
          authorizedArtifactIds: input.artifactIds,
        }));
      },
    }),
    defineCapability({
      identity: PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.list,
      audience: "agent",
      summary: "List requester-scoped Publishing Deliveries with a sealed cursor.",
      lifecycle,
      input: z.object({
        ...resources,
        planRevisionId: id.optional(),
        state: states.optional(),
        targetId: id.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).max(2_048).optional(),
      }).strict(),
      outputSchema: schema(deliveryPage),
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: PUBLISHING_DELIVERY_LIST_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_DELIVERY_ERROR_CONTRACTS],
      handler: async (input, context) => {
        const principal = agent(context.securityContext);
        const filters = {
          ...(input.planRevisionId ? { planRevisionId: input.planRevisionId } : {}),
          ...(input.state ? { state: input.state } : {}),
          ...(input.targetId ? { targetId: input.targetId } : {}),
        };
        const digestValue = filterDigest({ ...input, ...filters });
        if (input.cursor && !cursorCodec) {
          throw new CapabilityFailure({ code: "PUBLISHING_DELIVERY_INVALID_INPUT", category: "validation", message: "Publishing Delivery cursor is invalid or unavailable." });
        }
        const before = input.cursor
          ? cursorCodec!.open({ cursor: input.cursor, workspaceId: principal.workspaceId, principalId: principal.principalId, filterDigest: digestValue })
          : undefined;
        const values = await domain(() => service.list({
          workspaceId: principal.workspaceId,
          principalId: principal.principalId,
          filters,
          authorizedChannelIds: input.channelIds,
          authorizedArtifactIds: input.artifactIds,
          before,
          limit: input.limit + 1,
        }));
        const items = values.slice(0, input.limit);
        const last = items.at(-1);
        return {
          schema: "publishing-delivery-page/v1" as const,
          items,
          nextCursor: values.length > input.limit && last && cursorCodec
            ? cursorCodec.seal({ workspaceId: principal.workspaceId, principalId: principal.principalId, filterDigest: digestValue, position: { acceptedAt: new Date(last.acceptedAt), id: last.id } })
            : null,
        };
      },
    }),
    defineCapability({
      identity: PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES.events,
      audience: "agent",
      summary: "List retained scheduling and terminal evidence for one requester-scoped Publishing Delivery.",
      lifecycle,
      input: z.object({
        deliveryId: id,
        ...resources,
        afterSequence: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
      }).strict(),
      outputSchema: schema(eventPage),
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: PUBLISHING_DELIVERY_EVENTS_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_DELIVERY_ERROR_CONTRACTS],
      handler: async (input, context) => {
        const principal = agent(context.securityContext);
        const values = await domain(() => service.listEvents({
          workspaceId: principal.workspaceId,
          principalId: principal.principalId,
          deliveryId: input.deliveryId,
          authorizedChannelIds: input.channelIds,
          authorizedArtifactIds: input.artifactIds,
          afterSequence: input.afterSequence,
          limit: input.limit + 1,
        }));
        const items = values.slice(0, input.limit);
        return {
          schema: "publishing-delivery-event-page/v1" as const,
          items,
          nextAfterSequence: values.length > input.limit ? items.at(-1)!.sequence : null,
        };
      },
    }),
  ];
}
