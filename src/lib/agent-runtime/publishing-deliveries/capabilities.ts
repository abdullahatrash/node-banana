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
  PUBLISHING_DELIVERY_EVENTS_AUTHORIZATION,
  PUBLISHING_DELIVERY_GET_AUTHORIZATION,
  PUBLISHING_DELIVERY_LIST_AUTHORIZATION,
  PUBLISHING_DELIVERY_RELEASE_AUTHORIZATION,
  publishingDeliveryReleaseAuthorizationContractDigest,
} from "./authorization-contract";
import { InvalidPublishingDeliveryCursorError } from "./cursor";
import {
  PUBLISHING_DELIVERY_ERROR_CATALOG,
  PUBLISHING_DELIVERY_ERROR_CONTRACTS,
  PublishingDeliveryServiceError,
} from "./errors";
import { PublishingDeliveryService } from "./service";
import { PUBLISHING_DELIVERY_EFFECT_KEY_PATTERN } from "./keys";
import type { PublishingDeliveryCursorCodec, PublishingDeliveryState } from "./types";

export {
  PUBLISHING_DELIVERY_CAPABILITY_IDENTITIES,
  PUBLISHING_DELIVERY_RELEASE_AUTHORIZATION,
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
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const artifactId = z.string().min(1).max(200).regex(ARTIFACT_ID_PATTERN);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const iso = z.string().datetime({ offset: true });
const effectKey = z.string().regex(PUBLISHING_DELIVERY_EFFECT_KEY_PATTERN);
const failureCode = z.string().min(1).max(80).regex(/^[A-Z][A-Z0-9_]*$/);
const states = z.enum([
  "scheduled",
  "dispatching",
  "confirmation_pending",
  "succeeded",
  "failed",
  "outcome_unknown",
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
  releaseId: id,
  planId: id,
  planRevisionId: id,
  planRevision: z.number().int().min(1),
  planRevisionDigest: digest,
  approvalRequestId: id,
  approvalDecisionId: id,
  targetId: id,
  channelId: id,
  artifactIds: z.array(artifactId).min(1).max(51),
  targetSnapshot,
  targetSnapshotDigest: digest,
  publishAt: iso,
  desiredState: z.literal("publish"),
  state: states,
  effectKey,
  intentDigest: digest.nullable(),
  providerOperationRef: z.string().min(1).max(500).nullable(),
  latestEffectEvidenceDigest: digest.nullable(),
  failureCode: failureCode.nullable(),
  nextEventSequence: z.number().int().min(1),
  nextOutboxGeneration: z.number().int().min(2),
  acceptedAt: iso,
  scheduledAt: iso,
  dispatchStartedAt: iso.nullable(),
  completedAt: iso.nullable(),
  updatedAt: iso,
  externallyCompleted: z.boolean(),
}).strict();
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
  z.object({ ...eventBase, type: z.literal("delivery.accepted"), evidence: z.object({ releaseId: id, approvalRequestId: id, approvalDecisionId: id, targetSnapshotDigest: digest }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("delivery.scheduled"), evidence: z.object({ publishAt: iso }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("effect.prepared"), evidence: z.object({ effectKey, intentDigest: digest }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("effect.not_created"), evidence: z.object({ ...effectEvidence, failureCode }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.retry_scheduled"), evidence: z.object({ ...effectEvidence, failureCode, retryAt: iso }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.confirmation_pending"), evidence: z.object({ ...effectEvidence, providerOperationRef: z.string().min(1).max(500), pollAt: iso }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.succeeded"), evidence: z.object({ ...effectEvidence, providerOperationRef: z.string().min(1).max(500), failureCode: z.null() }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.failed"), evidence: z.object({ ...effectEvidence, providerOperationRef: z.string().min(1).max(500).nullable(), failureCode }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("publication.outcome_unknown"), evidence: z.object({ ...effectEvidence, providerOperationRef: z.null(), failureCode }).strict() }).strict(),
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
