import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { ARTIFACT_ID_PATTERN } from "../artifacts/validation";
import type { getDb } from "@/lib/db";
import {
  agentAuthorizationDecisions,
  agentKeys,
  agentPrincipals,
  runtimePublishingApprovalConsumptions,
  runtimePublishingApprovalDecisions,
  runtimePublishingApprovalRequests,
  runtimePublishingDeliveries,
  runtimePublishingDeliveryEvents,
  runtimePublishingDeliveryExecutionLeases,
  runtimePublishingDeliveryOutboxIntents,
  runtimePublishingDeliveryReleaseReceipts,
  runtimePublishingDeliveryReleases,
} from "@/lib/db/schema";
import {
  lockCurrentPublishingApprovalRevision,
  selectPublishingApprovalRequest,
  verifyCurrentPublishingPlanEvidence,
} from "../publishing-approvals/postgres-repository";
import {
  publishingApprovalReleaseAuthorizationContractDigest,
} from "../publishing-approvals/authorization-contract";
import type {
  PublishingApprovalRequestRecord,
} from "../publishing-approvals/types";
import type {
  PublishingPlanRevisionRecord,
} from "../publishing-plans/types";
import { publishingPlanLinkedInCapabilityVersion } from
  "../publishing-plans/production-digests";
import type {
  PublishingDeliveryAcceptedRef,
  PublishingDeliveryAuthorizationPort,
  PublishingDeliveryAuthorizationSession,
  PublishingDeliveryEvent,
  PublishingDeliveryExecutionLeaseRecord,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryReleaseRecord,
  PublishingDeliveryRepository,
} from "./types";
import {
  publishingDeliveryAcceptedRef,
  validPublishingDeliveryAuthorizationSession,
  validPublishingDeliveryValidationSession,
} from "./validation";
import {
  publishingDeliveryEffectKey,
  publishingDeliveryOutboxDedupeKey,
} from "./keys";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ReleaseRow = typeof runtimePublishingDeliveryReleases.$inferSelect;
type DeliveryRow = typeof runtimePublishingDeliveries.$inferSelect;
type EventRow = typeof runtimePublishingDeliveryEvents.$inferSelect;
type OutboxRow = typeof runtimePublishingDeliveryOutboxIntents.$inferSelect;
type LeaseRow = typeof runtimePublishingDeliveryExecutionLeases.$inferSelect;

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const RELEASE_AUTHORIZATION_TTL_MS = 15 * 60_000;

class PublishingDeliveryTransactionRollback extends Error {}

function requireWrittenRecord<T>(value: T | null): T {
  if (!value) throw new PublishingDeliveryTransactionRollback();
  return value;
}

function dbDate(value: unknown): Date | null {
  const result = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(result.getTime()) ? result : null;
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function safeIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = dbDate(value);
  return Boolean(date && date.toISOString() === value);
}

function safeRef(value: unknown, max = 500): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function validTargetSnapshot(row: DeliveryRow): boolean {
  const snapshot = row.targetSnapshot as unknown;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const value = snapshot as Record<string, unknown>;
  if (!exactKeys(value, ["schema", "target", "targetDigest", "validation"]) ||
    value.schema !== "publishing-delivery-target-snapshot/v1" ||
    typeof value.targetDigest !== "string" || !DIGEST.test(value.targetDigest) ||
    !value.target || typeof value.target !== "object" || Array.isArray(value.target) ||
    !value.validation || typeof value.validation !== "object" || Array.isArray(value.validation)) {
    return false;
  }
  const target = value.target as Record<string, unknown>;
  const validation = value.validation as Record<string, unknown>;
  if (!exactKeys(target, [
    "targetId", "channelId", "contentArtifactId", "mediaArtifactIds", "settings", "timing",
  ]) || !exactKeys(validation, [
    "targetId", "channel", "artifacts", "settingsDigest", "publishAt",
    "policyEvidenceDigest", "policyStateDigest", "blockerCodes",
  ]) || target.targetId !== row.targetId || target.channelId !== row.channelId ||
    validation.targetId !== row.targetId || !Array.isArray(validation.blockerCodes) ||
    validation.blockerCodes.length !== 0 || typeof validation.settingsDigest !== "string" ||
    !DIGEST.test(validation.settingsDigest) || typeof validation.policyEvidenceDigest !== "string" ||
    !DIGEST.test(validation.policyEvidenceDigest) || typeof validation.policyStateDigest !== "string" ||
    !DIGEST.test(validation.policyStateDigest) || !safeIso(validation.publishAt) ||
    !Array.isArray(validation.artifacts) || validation.artifacts.length < 1 ||
    validation.artifacts.length > 51 || !Array.isArray(target.mediaArtifactIds) ||
    !target.settings || typeof target.settings !== "object" || Array.isArray(target.settings) ||
    !exactKeys(target.settings as Record<string, unknown>, ["type"]) ||
    !["person", "organization"].includes(String((target.settings as Record<string, unknown>).type)) ||
    !target.timing || typeof target.timing !== "object" || Array.isArray(target.timing) ||
    !exactKeys(target.timing as Record<string, unknown>, ["kind", "publishAt"]) ||
    !["now", "scheduled"].includes(String((target.timing as Record<string, unknown>).kind)) ||
    !safeIso((target.timing as Record<string, unknown>).publishAt) ||
    !validation.channel || typeof validation.channel !== "object" ||
    Array.isArray(validation.channel)) return false;
  const channel = validation.channel as Record<string, unknown>;
  if (!exactKeys(channel, ["id", "platform", "authorKind", "snapshotDigest", "capabilityVersion"]) ||
    channel.id !== row.channelId || channel.platform !== "linkedin" ||
    !["person", "organization"].includes(String(channel.authorKind)) ||
    channel.authorKind !== (target.settings as Record<string, unknown>).type ||
    typeof channel.snapshotDigest !== "string" || !DIGEST.test(channel.snapshotDigest) ||
    channel.capabilityVersion !== publishingPlanLinkedInCapabilityVersion() ||
    validation.settingsDigest !== canonicalDigest(target.settings)) return false;
  const artifactsValid = validation.artifacts.every((artifact, index) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return false;
    const evidence = artifact as Record<string, unknown>;
    return exactKeys(evidence, ["id", "digest", "snapshotDigest", "kind", "mediaType", "sizeBytes"]) &&
      typeof evidence.id === "string" && ARTIFACT_ID_PATTERN.test(evidence.id) &&
      typeof evidence.digest === "string" && DIGEST.test(evidence.digest) &&
      typeof evidence.snapshotDigest === "string" && DIGEST.test(evidence.snapshotDigest) &&
      (index === 0
        ? evidence.kind === "text" && evidence.mediaType === "text/plain; charset=utf-8"
        : evidence.kind === "image" &&
          ["image/jpeg", "image/png", "image/gif"].includes(String(evidence.mediaType))) &&
      typeof evidence.sizeBytes === "number" && Number.isSafeInteger(evidence.sizeBytes) &&
      evidence.sizeBytes >= 0 && evidence.sizeBytes <= 52_428_800;
  });
  if (!artifactsValid) return false;
  const targetArtifactManifest = [target.contentArtifactId, ...target.mediaArtifactIds];
  const evidenceArtifactManifest = validation.artifacts.map((artifact) =>
    (artifact as Record<string, unknown>).id as string);
  return sameOrder(targetArtifactManifest as string[], evidenceArtifactManifest) &&
    (target.timing as Record<string, unknown>).publishAt === validation.publishAt &&
    (target.timing as Record<string, unknown>).publishAt === row.publishAt.toISOString() &&
    canonicalDigest({ target: value.target, validation: value.validation }) === value.targetDigest;
}

function safeIds(value: unknown, max = 200): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > max ||
    value.some((item) => typeof item !== "string" || !ID.test(item)) ||
    new Set(value).size !== value.length) return null;
  return [...value] as string[];
}

function safeArtifactIds(value: unknown, max = 200): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > max ||
    value.some((item) => typeof item !== "string" || !ARTIFACT_ID_PATTERN.test(item)) ||
    new Set(value).size !== value.length) return null;
  return [...value] as string[];
}

function safeResources(value: unknown): { channelIds: string[]; artifactIds: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "artifactIds,channelIds") return null;
  const record = value as Record<string, unknown>;
  const channelIds = safeIds(record.channelIds, 50);
  const artifactIds = safeArtifactIds(record.artifactIds, 200);
  return channelIds && artifactIds ? { channelIds, artifactIds } : null;
}

function targetArtifactIds(delivery: DeliveryRow): string[] | null {
  const ids = safeArtifactIds(delivery.artifactIds, 51);
  if (!ids || !validTargetSnapshot(delivery)) return null;
  const target = delivery.targetSnapshot.target;
  const expected = [target.contentArtifactId, ...target.mediaArtifactIds];
  return sameOrder(ids, expected) ? ids : null;
}

function validDeliveryLifecycle(row: DeliveryRow): boolean {
  if (!Number.isSafeInteger(row.nextEventSequence) || row.nextEventSequence < 3 ||
    !Number.isSafeInteger(row.nextOutboxGeneration) || row.nextOutboxGeneration < 2 ||
    row.scheduledAt < row.acceptedAt || row.updatedAt < row.acceptedAt ||
    (row.dispatchStartedAt !== null && row.dispatchStartedAt < row.acceptedAt) ||
    (row.completedAt !== null && row.completedAt < row.acceptedAt) ||
    (row.providerOperationRef !== null && !safeRef(row.providerOperationRef)) ||
    (row.failureCode !== null && !/^[A-Z][A-Z0-9_]{0,79}$/.test(row.failureCode))) return false;
  const hasIntent = row.intentDigest !== null;
  const hasEvidence = row.latestEffectEvidenceDigest !== null;
  switch (row.state) {
    case "scheduled":
      return row.providerOperationRef === null && row.completedAt === null &&
        ((!hasIntent && !hasEvidence && row.failureCode === null && row.dispatchStartedAt === null) ||
          (hasIntent && hasEvidence && row.failureCode !== null && row.dispatchStartedAt !== null));
    case "dispatching":
      return hasIntent && !hasEvidence && row.providerOperationRef === null &&
        row.failureCode === null && row.dispatchStartedAt !== null && row.completedAt === null;
    case "confirmation_pending":
      return hasIntent && hasEvidence && row.providerOperationRef !== null &&
        row.failureCode === null && row.dispatchStartedAt !== null && row.completedAt === null;
    case "succeeded":
      return hasIntent && hasEvidence && row.providerOperationRef !== null &&
        row.failureCode === null && row.dispatchStartedAt !== null && row.completedAt !== null;
    case "failed":
      return hasEvidence && row.failureCode !== null && row.completedAt !== null &&
        ((hasIntent && row.dispatchStartedAt !== null) ||
          (!hasIntent && row.providerOperationRef === null && row.dispatchStartedAt === null));
    case "outcome_unknown":
      return hasIntent && hasEvidence && row.providerOperationRef === null &&
        row.failureCode !== null && row.dispatchStartedAt !== null && row.completedAt !== null;
    default:
      return false;
  }
}

export function rehydratePublishingDelivery(row: DeliveryRow): PublishingDeliveryRecord | null {
  const artifactIds = targetArtifactIds(row);
  if (!artifactIds || !ID.test(row.id) || !ID.test(row.workspaceId) ||
    !ID.test(row.releaseId) || !ID.test(row.planId) || !ID.test(row.planRevisionId) ||
    row.planRevision < 1 || !DIGEST.test(row.planRevisionDigest) ||
    !ID.test(row.approvalRequestId) || !ID.test(row.approvalDecisionId) ||
    !ID.test(row.targetId) || !ID.test(row.channelId) ||
    !DIGEST.test(row.targetSnapshotDigest) || !validDeliveryLifecycle(row) ||
    canonicalDigest(row.targetSnapshot) !== row.targetSnapshotDigest ||
    row.targetSnapshot.target.targetId !== row.targetId ||
    row.targetSnapshot.target.channelId !== row.channelId ||
    row.targetSnapshot.validation.targetId !== row.targetId ||
    row.targetSnapshot.validation.channel.id !== row.channelId ||
    row.desiredState !== "publish" || ![
      "scheduled", "dispatching", "confirmation_pending", "succeeded", "failed",
      "outcome_unknown",
    ].includes(row.state) ||
    row.effectKey !== publishingDeliveryEffectKey(row.workspaceId, row.id) ||
    (row.intentDigest !== null && !DIGEST.test(row.intentDigest)) ||
    (row.latestEffectEvidenceDigest !== null && !DIGEST.test(row.latestEffectEvidenceDigest))) {
    return null;
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    releaseId: row.releaseId,
    planId: row.planId,
    planRevisionId: row.planRevisionId,
    planRevision: row.planRevision,
    planRevisionDigest: row.planRevisionDigest,
    approvalRequestId: row.approvalRequestId,
    approvalDecisionId: row.approvalDecisionId,
    targetId: row.targetId,
    channelId: row.channelId,
    artifactIds,
    targetSnapshot: structuredClone(row.targetSnapshot),
    targetSnapshotDigest: row.targetSnapshotDigest,
    publishAt: row.publishAt,
    desiredState: "publish",
    state: row.state as PublishingDeliveryRecord["state"],
    effectKey: row.effectKey,
    intentDigest: row.intentDigest,
    providerOperationRef: row.providerOperationRef,
    latestEffectEvidenceDigest: row.latestEffectEvidenceDigest,
    failureCode: row.failureCode,
    nextEventSequence: row.nextEventSequence,
    nextOutboxGeneration: row.nextOutboxGeneration,
    acceptedAt: row.acceptedAt,
    scheduledAt: row.scheduledAt,
    dispatchStartedAt: row.dispatchStartedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

function acceptedRef(value: unknown): PublishingDeliveryAcceptedRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "acceptedAt,channelId,effectKey,externallyCompleted,id,publishAt,scheduledAt,state,targetId") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !ID.test(row.id) ||
    typeof row.targetId !== "string" || !ID.test(row.targetId) ||
    typeof row.channelId !== "string" || !ID.test(row.channelId) ||
    typeof row.effectKey !== "string" || row.state !== "scheduled" ||
    row.externallyCompleted !== false || !safeIso(row.publishAt) ||
    !safeIso(row.acceptedAt) || !safeIso(row.scheduledAt)) return null;
  return row as unknown as PublishingDeliveryAcceptedRef;
}

function releaseRecord(
  row: ReleaseRow,
  deliveries?: PublishingDeliveryRecord[],
): PublishingDeliveryReleaseRecord | null {
  const resources = safeResources(row.authorizedResources);
  const refs = Array.isArray(row.acceptedDeliveries)
    ? row.acceptedDeliveries.map(acceptedRef)
    : [];
  if (!resources || refs.length < 1 || refs.some((ref) => !ref) ||
    !ID.test(row.id) || !ID.test(row.workspaceId) || !ID.test(row.planId) ||
    !ID.test(row.planRevisionId) || row.planRevision < 1 ||
    !DIGEST.test(row.planRevisionDigest) || !ID.test(row.approvalRequestId) ||
    !ID.test(row.approvalDecisionId) || !ID.test(row.consumingPrincipalId) ||
    !ID.test(row.consumingKeyId) || row.capability !== "publishing_plan_revisions.release@1" ||
    row.authorizationContractDigest !== publishingApprovalReleaseAuthorizationContractDigest() ||
    !safeRef(row.authorizationEvidenceRef, 200) ||
    !DIGEST.test(row.validationEvidenceDigest) ||
    !DIGEST.test(row.validationCurrentStateDigest) ||
    row.authorizationIssuedAt >= row.authorizationExpiresAt ||
    row.createdAt < row.authorizationIssuedAt || row.createdAt >= row.authorizationExpiresAt) {
    return null;
  }
  const acceptedDeliveries = refs as PublishingDeliveryAcceptedRef[];
  if (deliveries) {
    const relational = deliveries.map(publishingDeliveryAcceptedRef);
    if (canonicalDigest(relational) !== canonicalDigest(acceptedDeliveries)) return null;
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    planId: row.planId,
    planRevisionId: row.planRevisionId,
    planRevision: row.planRevision,
    planRevisionDigest: row.planRevisionDigest,
    approvalRequestId: row.approvalRequestId,
    approvalDecisionId: row.approvalDecisionId,
    consumingPrincipalId: row.consumingPrincipalId,
    consumingKeyId: row.consumingKeyId,
    capability: "publishing_plan_revisions.release@1",
    authorizationContractDigest: row.authorizationContractDigest,
    authorizationEvidenceRef: row.authorizationEvidenceRef,
    authorizedResources: resources,
    authorizationIssuedAt: row.authorizationIssuedAt,
    authorizationExpiresAt: row.authorizationExpiresAt,
    validationSessionId: row.validationSessionId,
    validationEvidenceDigest: row.validationEvidenceDigest,
    validationCurrentStateDigest: row.validationCurrentStateDigest,
    acceptedDeliveries,
    createdAt: row.createdAt,
  };
}

export function rehydratePublishingDeliveryEvent(row: EventRow): PublishingDeliveryEvent | null {
  const base = {
    schema: "publishing-delivery-event/v1" as const,
    id: row.id,
    workspaceId: row.workspaceId,
    deliveryId: row.deliveryId,
    sequence: row.sequence,
    occurredAt: row.occurredAt,
  };
  if (!ID.test(row.id) || !ID.test(row.workspaceId) || !ID.test(row.deliveryId) ||
    row.sequence < 1 || !row.evidence || typeof row.evidence !== "object" ||
    Array.isArray(row.evidence)) return null;
  const evidence = row.evidence as Record<string, unknown>;
  switch (row.type) {
    case "delivery.accepted":
      if (!exactKeys(evidence, [
        "releaseId", "approvalRequestId", "approvalDecisionId", "targetSnapshotDigest",
      ]) || typeof evidence.releaseId !== "string" || !ID.test(evidence.releaseId) ||
        typeof evidence.approvalRequestId !== "string" || !ID.test(evidence.approvalRequestId) ||
        typeof evidence.approvalDecisionId !== "string" || !ID.test(evidence.approvalDecisionId) ||
        typeof evidence.targetSnapshotDigest !== "string" ||
        !DIGEST.test(evidence.targetSnapshotDigest)) return null;
      return { ...base, type: row.type, evidence: {
        releaseId: evidence.releaseId,
        approvalRequestId: evidence.approvalRequestId,
        approvalDecisionId: evidence.approvalDecisionId,
        targetSnapshotDigest: evidence.targetSnapshotDigest,
      } };
    case "delivery.scheduled":
      if (!exactKeys(evidence, ["publishAt"]) || !safeIso(evidence.publishAt)) return null;
      return { ...base, type: row.type, evidence: { publishAt: evidence.publishAt } };
    case "effect.not_created":
      if (!exactKeys(evidence, ["effectKey", "evidenceDigest", "failureCode"]) ||
        !safeRef(evidence.effectKey) || typeof evidence.evidenceDigest !== "string" ||
        !DIGEST.test(evidence.evidenceDigest) || typeof evidence.failureCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,79}$/.test(evidence.failureCode)) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        evidenceDigest: evidence.evidenceDigest,
        failureCode: evidence.failureCode,
      } };
    case "effect.prepared":
      if (!exactKeys(evidence, ["effectKey", "intentDigest"]) || !safeRef(evidence.effectKey) ||
        typeof evidence.intentDigest !== "string" || !DIGEST.test(evidence.intentDigest)) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey, intentDigest: evidence.intentDigest,
      } };
    case "publication.confirmation_pending":
      if (!exactKeys(evidence, [
        "effectKey", "providerOperationRef", "evidenceDigest", "pollAt",
      ]) || !safeRef(evidence.effectKey) || !safeRef(evidence.providerOperationRef) ||
        typeof evidence.evidenceDigest !== "string" || !DIGEST.test(evidence.evidenceDigest) ||
        !safeIso(evidence.pollAt)) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        providerOperationRef: evidence.providerOperationRef,
        evidenceDigest: evidence.evidenceDigest,
        pollAt: evidence.pollAt,
      } };
    case "publication.retry_scheduled":
      if (!exactKeys(evidence, ["effectKey", "evidenceDigest", "failureCode", "retryAt"]) ||
        !safeRef(evidence.effectKey) ||
        typeof evidence.evidenceDigest !== "string" || !DIGEST.test(evidence.evidenceDigest) ||
        typeof evidence.failureCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,79}$/.test(evidence.failureCode) ||
        !safeIso(evidence.retryAt)) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        evidenceDigest: evidence.evidenceDigest,
        failureCode: evidence.failureCode,
        retryAt: evidence.retryAt,
      } };
    case "publication.succeeded":
    case "publication.failed":
      if (!exactKeys(evidence, [
        "effectKey", "providerOperationRef", "evidenceDigest", "failureCode",
      ]) || !safeRef(evidence.effectKey) || typeof evidence.evidenceDigest !== "string" ||
        !DIGEST.test(evidence.evidenceDigest) ||
        (evidence.providerOperationRef !== null && !safeRef(evidence.providerOperationRef)) ||
        (row.type === "publication.succeeded" &&
          (!safeRef(evidence.providerOperationRef) || evidence.failureCode !== null)) ||
        (row.type === "publication.failed" &&
          (typeof evidence.failureCode !== "string" ||
            !/^[A-Z][A-Z0-9_]{0,79}$/.test(evidence.failureCode)))) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        providerOperationRef: evidence.providerOperationRef,
        evidenceDigest: evidence.evidenceDigest,
        failureCode: evidence.failureCode,
      } } as PublishingDeliveryEvent;
    case "publication.outcome_unknown":
      if (!exactKeys(evidence, [
        "effectKey", "providerOperationRef", "evidenceDigest", "failureCode",
      ]) || !safeRef(evidence.effectKey) || evidence.providerOperationRef !== null ||
        typeof evidence.evidenceDigest !== "string" || !DIGEST.test(evidence.evidenceDigest) ||
        typeof evidence.failureCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,79}$/.test(evidence.failureCode)) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        providerOperationRef: null,
        evidenceDigest: evidence.evidenceDigest,
        failureCode: evidence.failureCode,
      } };
    default:
      return null;
  }
}

export function rehydratePublishingDeliveryOutbox(row: OutboxRow): PublishingDeliveryOutboxIntentRecord | null {
  if (!ID.test(row.id) || !ID.test(row.workspaceId) || !ID.test(row.deliveryId) ||
    row.generation < 1 || row.deliveryAttempts < 0 ||
    row.dedupeKey !== publishingDeliveryOutboxDedupeKey(
      row.workspaceId,
      row.deliveryId,
      row.generation,
    ) ||
    !["pending", "claimed", "delivered"].includes(row.state) ||
    (row.state === "pending" && (row.deliveryToken !== null || row.claimedAt !== null ||
      row.deliveredAt !== null)) ||
    (row.state === "claimed" && (!safeRef(row.deliveryToken, 200) ||
      row.claimedAt === null || row.deliveredAt !== null || row.deliveryAttempts < 1)) ||
    (row.state === "delivered" && (row.deliveryToken !== null || row.claimedAt === null ||
      row.deliveredAt === null || row.deliveredAt < row.claimedAt || row.deliveryAttempts < 1))) {
    return null;
  }
  return { ...row, state: row.state as PublishingDeliveryOutboxIntentRecord["state"] };
}

export function rehydratePublishingDeliveryLease(row: LeaseRow): PublishingDeliveryExecutionLeaseRecord | null {
  if (!ID.test(row.workspaceId) || !ID.test(row.deliveryId) || row.fence <= BigInt(0) ||
    !safeRef(row.workerId, 500) || !safeRef(row.leaseToken, 200) ||
    row.expiresAt <= row.acquiredAt || row.renewedAt < row.acquiredAt ||
    (row.releasedAt !== null && row.releasedAt < row.acquiredAt)) return null;
  return { ...row };
}

function exactDeliveryRows(input: {
  approval: PublishingApprovalRequestRecord;
  revision: PublishingPlanRevisionRecord;
  release: PublishingDeliveryReleaseRecord;
  deliveries: PublishingDeliveryRecord[];
  firstEvents: PublishingDeliveryEvent[];
  outbox: PublishingDeliveryOutboxIntentRecord[];
}): boolean {
  const { approval, revision, release, deliveries, firstEvents, outbox } = input;
  if (deliveries.length !== approval.targetIds.length ||
    firstEvents.length !== deliveries.length * 2 || outbox.length !== deliveries.length ||
    new Set(deliveries.map((delivery) => delivery.id)).size !== deliveries.length) return false;
  const targetById = new Map(revision.definition.targets.map((target) => [target.targetId, target]));
  const evidenceById = new Map(revision.validationEvidence.targets.map((target) => [target.targetId, target]));
  for (const [index, delivery] of deliveries.entries()) {
    const targetId = approval.targetIds[index];
    const target = targetId ? targetById.get(targetId) : null;
    const evidence = targetId ? evidenceById.get(targetId) : null;
    if (!target || !evidence || delivery.workspaceId !== release.workspaceId ||
      delivery.releaseId !== release.id || delivery.planId !== release.planId ||
      delivery.planRevisionId !== release.planRevisionId ||
      delivery.planRevision !== release.planRevision ||
      delivery.planRevisionDigest !== release.planRevisionDigest ||
      delivery.approvalRequestId !== release.approvalRequestId ||
      delivery.approvalDecisionId !== release.approvalDecisionId ||
      delivery.targetId !== targetId || delivery.channelId !== target.channelId ||
      !sameOrder(delivery.artifactIds, [target.contentArtifactId, ...target.mediaArtifactIds]) ||
      canonicalDigest(delivery.targetSnapshot) !== delivery.targetSnapshotDigest ||
      canonicalDigest(delivery.targetSnapshot.target) !== canonicalDigest(target) ||
      canonicalDigest(delivery.targetSnapshot.validation) !== canonicalDigest(evidence) ||
      delivery.desiredState !== "publish" || delivery.state !== "scheduled" ||
      delivery.intentDigest !== null || delivery.providerOperationRef !== null ||
      delivery.latestEffectEvidenceDigest !== null || delivery.failureCode !== null ||
      delivery.nextEventSequence !== 3 || delivery.nextOutboxGeneration !== 2 ||
      delivery.completedAt !== null ||
      delivery.effectKey !== publishingDeliveryEffectKey(release.workspaceId, delivery.id) ||
      delivery.publishAt.toISOString() !== target.timing.publishAt) return false;
    const events = firstEvents.slice(index * 2, index * 2 + 2);
    if (events[0]?.deliveryId !== delivery.id || events[0].sequence !== 1 ||
      events[0].type !== "delivery.accepted" || events[1]?.deliveryId !== delivery.id ||
      events[1].sequence !== 2 || events[1].type !== "delivery.scheduled" ||
      canonicalDigest(events[0].evidence) !== canonicalDigest({
        releaseId: release.id,
        approvalRequestId: release.approvalRequestId,
        approvalDecisionId: release.approvalDecisionId,
        targetSnapshotDigest: delivery.targetSnapshotDigest,
      }) || canonicalDigest(events[1].evidence) !== canonicalDigest({
        publishAt: delivery.publishAt.toISOString(),
      })) return false;
    const intent = outbox[index];
    if (!intent || intent.workspaceId !== delivery.workspaceId ||
      intent.deliveryId !== delivery.id || intent.generation !== 1 ||
      intent.state !== "pending" || intent.deliveryToken || intent.claimedAt || intent.deliveredAt ||
      intent.deliveryAttempts !== 0 || intent.availableAt.getTime() !== delivery.publishAt.getTime() ||
      intent.dedupeKey !== publishingDeliveryOutboxDedupeKey(
        delivery.workspaceId,
        delivery.id,
        1,
      )) {
      return false;
    }
  }
  return canonicalDigest(deliveries.map(publishingDeliveryAcceptedRef)) ===
    canonicalDigest(release.acceptedDeliveries);
}

async function databaseNow(tx: Tx): Promise<Date | null> {
  const rows = await tx.execute(sql`select clock_timestamp() as database_now`);
  const row = (rows as unknown as { rows?: Array<{ database_now: unknown }> }).rows?.[0];
  return row ? dbDate(row.database_now) : null;
}

async function lockReleaseAuthorization(
  tx: Tx,
  session: PublishingDeliveryAuthorizationSession,
  approval: PublishingApprovalRequestRecord,
  at: Date,
): Promise<boolean> {
  if (!approval.decision || !validPublishingDeliveryAuthorizationSession({
    session,
    workspaceId: approval.workspaceId,
    principalId: session.principalId,
    keyId: session.keyId,
    capability: "publishing_plan_revisions.release@1",
    authorizationContractDigest: publishingApprovalReleaseAuthorizationContractDigest(),
    authorizationEvidenceRef: session.evidenceRef,
    channelIds: approval.channelIds,
    artifactIds: approval.artifactIds,
    now: at,
  })) return false;
  const rows = await tx.select({
    decision: agentAuthorizationDecisions,
    principalStatus: agentPrincipals.status,
    principalRevokedAt: agentPrincipals.revokedAt,
    keyRevokedAt: agentKeys.revokedAt,
    keyExpiresAt: agentKeys.expiresAt,
  }).from(agentAuthorizationDecisions)
    .innerJoin(agentPrincipals, and(
      eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId),
      eq(agentPrincipals.id, agentAuthorizationDecisions.principalId),
    )).innerJoin(agentKeys, and(
      eq(agentKeys.principalId, agentAuthorizationDecisions.principalId),
      eq(agentKeys.id, agentAuthorizationDecisions.keyId),
    )).where(and(
      eq(agentAuthorizationDecisions.workspaceId, session.workspaceId),
      eq(agentAuthorizationDecisions.principalId, session.principalId),
      eq(agentAuthorizationDecisions.keyId, session.keyId),
      eq(agentAuthorizationDecisions.operatorTraceRef, session.evidenceRef),
      eq(agentAuthorizationDecisions.capabilityName, "publishing_plan_revisions.release"),
      eq(agentAuthorizationDecisions.capabilityVersion, 1),
      eq(agentAuthorizationDecisions.authorizationContractDigest, session.contractDigest),
      eq(agentAuthorizationDecisions.outcome, "allowed"),
    )).limit(1).for("share");
  const row = rows[0];
  if (!row || row.principalStatus !== "active" || row.principalRevokedAt ||
    row.keyRevokedAt || (row.keyExpiresAt && row.keyExpiresAt <= at) ||
    row.decision.createdAt.getTime() !== session.issuedAt.getTime() ||
    session.expiresAt.getTime() !== Math.min(
      session.issuedAt.getTime() + RELEASE_AUTHORIZATION_TTL_MS,
      row.keyExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
    ) || session.expiresAt <= at) return false;
  const channels = row.decision.resources.filter((resource) => resource.kind === "channel")
    .map((resource) => resource.id);
  const artifacts = row.decision.resources.filter((resource) => resource.kind === "artifact")
    .map((resource) => resource.id);
  return row.decision.resources.length === channels.length + artifacts.length &&
    sameSet(channels, approval.channelIds) && sameSet(artifacts, approval.artifactIds) &&
    sameSet(session.resources.channelIds, approval.channelIds) &&
    sameSet(session.resources.artifactIds, approval.artifactIds);
}

async function storedRelease(
  db: Db | Tx,
  input: { workspaceId: string; releaseId: string; consumingPrincipalId?: string },
): Promise<{ release: PublishingDeliveryReleaseRecord; deliveries: PublishingDeliveryRecord[] } | null> {
  const releaseRows = await db.select().from(runtimePublishingDeliveryReleases).where(and(
    eq(runtimePublishingDeliveryReleases.workspaceId, input.workspaceId),
    eq(runtimePublishingDeliveryReleases.id, input.releaseId),
    input.consumingPrincipalId
      ? eq(runtimePublishingDeliveryReleases.consumingPrincipalId, input.consumingPrincipalId)
      : undefined,
  )).limit(1);
  if (!releaseRows[0]) return null;
  const rows = await db.select().from(runtimePublishingDeliveries).where(and(
    eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
    eq(runtimePublishingDeliveries.releaseId, input.releaseId),
  )).orderBy(asc(runtimePublishingDeliveries.targetOrdinal));
  const deliveries = rows.map(rehydratePublishingDelivery);
  if (deliveries.some((delivery) => !delivery)) return null;
  const exact = deliveries as PublishingDeliveryRecord[];
  const release = releaseRecord(releaseRows[0], exact);
  return release ? { release, deliveries: exact } : null;
}

export class DrizzlePublishingDeliveryAuthorizationRepository
  implements PublishingDeliveryAuthorizationPort {
  constructor(private readonly database: () => Db) {}

  async checkCurrent(
    input: Parameters<PublishingDeliveryAuthorizationPort["checkCurrent"]>[0],
  ): Promise<PublishingDeliveryAuthorizationSession | null> {
    try {
      if (input.capability !== "publishing_plan_revisions.release@1" ||
        input.authorizationContractDigest !== publishingApprovalReleaseAuthorizationContractDigest()) {
        return null;
      }
      const rows = await this.database().select({
        decision: agentAuthorizationDecisions,
        principalStatus: agentPrincipals.status,
        principalRevokedAt: agentPrincipals.revokedAt,
        keyRevokedAt: agentKeys.revokedAt,
        keyExpiresAt: agentKeys.expiresAt,
        databaseNow: sql<unknown>`statement_timestamp()`,
      }).from(agentAuthorizationDecisions)
        .innerJoin(agentPrincipals, and(
          eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId),
          eq(agentPrincipals.id, agentAuthorizationDecisions.principalId),
        )).innerJoin(agentKeys, and(
          eq(agentKeys.principalId, agentAuthorizationDecisions.principalId),
          eq(agentKeys.id, agentAuthorizationDecisions.keyId),
        )).where(and(
          eq(agentAuthorizationDecisions.workspaceId, input.workspaceId),
          eq(agentAuthorizationDecisions.principalId, input.principalId),
          eq(agentAuthorizationDecisions.keyId, input.keyId),
          eq(agentAuthorizationDecisions.operatorTraceRef, input.authorizationEvidenceRef),
          eq(agentAuthorizationDecisions.capabilityName, "publishing_plan_revisions.release"),
          eq(agentAuthorizationDecisions.capabilityVersion, 1),
          eq(agentAuthorizationDecisions.authorizationContractDigest,
            input.authorizationContractDigest),
          eq(agentAuthorizationDecisions.outcome, "allowed"),
        )).limit(1);
      const row = rows[0];
      const now = row ? dbDate(row.databaseNow) : null;
      if (!row || !now || row.principalStatus !== "active" || row.principalRevokedAt ||
        row.keyRevokedAt || (row.keyExpiresAt && row.keyExpiresAt <= now)) return null;
      const channelIds = row.decision.resources
        .filter((resource) => resource.kind === "channel").map((resource) => resource.id);
      const artifactIds = row.decision.resources
        .filter((resource) => resource.kind === "artifact").map((resource) => resource.id);
      if (row.decision.resources.length !== channelIds.length + artifactIds.length ||
        !sameSet(channelIds, input.channelIds) || !sameSet(artifactIds, input.artifactIds)) return null;
      const exactResources = {
        channelIds: [...input.channelIds],
        artifactIds: [...input.artifactIds],
      };
      const expiresAt = new Date(Math.min(
        row.decision.createdAt.getTime() + RELEASE_AUTHORIZATION_TTL_MS,
        row.keyExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
      ));
      if (expiresAt <= now) return null;
      return {
        schema: "publishing-delivery-authorization-session/v1",
        id: `pdas_${canonicalDigest({
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          keyId: input.keyId,
          evidenceRef: input.authorizationEvidenceRef,
          channelIds: exactResources.channelIds,
          artifactIds: exactResources.artifactIds,
          issuedAt: row.decision.createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        }).slice("sha256:".length)}`,
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        keyId: input.keyId,
        capability: "publishing_plan_revisions.release@1",
        contractDigest: input.authorizationContractDigest,
        evidenceRef: input.authorizationEvidenceRef,
        resources: exactResources,
        issuedAt: row.decision.createdAt,
        expiresAt,
      };
    } catch {
      return null;
    }
  }
}

export class DrizzlePublishingDeliveryRepository implements PublishingDeliveryRepository {
  constructor(private readonly database: () => Db) {}

  async readReleaseReceipt(input: Parameters<PublishingDeliveryRepository["readReleaseReceipt"]>[0]) {
    try {
      const rows = await this.database().select().from(runtimePublishingDeliveryReleaseReceipts)
        .where(and(
          eq(runtimePublishingDeliveryReleaseReceipts.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryReleaseReceipts.principalId, input.principalId),
          eq(runtimePublishingDeliveryReleaseReceipts.capability, input.capability),
          eq(runtimePublishingDeliveryReleaseReceipts.idempotencyKey, input.idempotencyKey),
        )).limit(1);
      return !rows[0] ? { kind: "absent" as const } :
        rows[0].requestFingerprint === input.requestFingerprint
          ? { kind: "replayed" as const, releaseId: rows[0].releaseId }
          : { kind: "conflict" as const };
    } catch {
      return { kind: "absent" as const };
    }
  }

  getApprovalForRelease(input: Parameters<PublishingDeliveryRepository["getApprovalForRelease"]>[0]) {
    return selectPublishingApprovalRequest(this.database(), input);
  }

  async release(input: Parameters<PublishingDeliveryRepository["release"]>[0]) {
    const { release, approval, revision, receipt } = input;
    if (!approval.decision || approval.decision.decision !== "approved" || approval.consumption ||
      release.workspaceId !== approval.workspaceId || release.planId !== approval.planId ||
      release.planRevisionId !== approval.planRevisionId ||
      release.planRevision !== approval.planRevision ||
      release.planRevisionDigest !== approval.planRevisionDigest ||
      release.approvalRequestId !== approval.id ||
      release.approvalDecisionId !== approval.decision.id ||
      release.consumingPrincipalId !== approval.requestingPrincipalId ||
      release.consumingPrincipalId !== receipt.principalId ||
      release.consumingPrincipalId !== input.authorizationSession.principalId ||
      release.consumingKeyId !== input.authorizationSession.keyId ||
      release.capability !== receipt.capability || release.id !== receipt.releaseId ||
      release.authorizationEvidenceRef !== input.authorizationSession.evidenceRef ||
      release.authorizationContractDigest !== input.authorizationSession.contractDigest ||
      canonicalDigest(release.authorizedResources) !==
        canonicalDigest(input.authorizationSession.resources) ||
      release.authorizationIssuedAt.getTime() !== input.authorizationSession.issuedAt.getTime() ||
      release.authorizationExpiresAt.getTime() !== input.authorizationSession.expiresAt.getTime() ||
      release.validationSessionId !== input.validationSession.id ||
      release.validationEvidenceDigest !== approval.validation.evidenceDigest ||
      release.validationCurrentStateDigest !== approval.validation.currentStateDigest ||
      release.authorizationContractDigest !== publishingApprovalReleaseAuthorizationContractDigest() ||
      input.approvalConsumption.id.length < 1 ||
      input.approvalConsumption.approvalRequestId !== approval.id ||
      input.approvalConsumption.decisionId !== approval.decision.id ||
      input.approvalConsumption.consumingPrincipalId !== release.consumingPrincipalId ||
      input.approvalConsumption.consumingKeyId !== release.consumingKeyId ||
      input.approvalConsumption.authorizationContractDigest !==
        release.authorizationContractDigest ||
      input.approvalConsumption.authorizationEvidenceRef !==
        release.authorizationEvidenceRef ||
      canonicalDigest(input.approvalConsumption.authorizedResources) !==
        canonicalDigest(release.authorizedResources) ||
      input.approvalConsumption.authorizationIssuedAt.getTime() !==
        release.authorizationIssuedAt.getTime() ||
      input.approvalConsumption.authorizationExpiresAt.getTime() !==
        release.authorizationExpiresAt.getTime() ||
      !exactDeliveryRows({
        approval, revision, release, deliveries: input.deliveries,
        firstEvents: input.firstEvents, outbox: input.outboxIntents,
      })) return { kind: "unavailable" as const };
    try {
      return await this.database().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
          "publishing-delivery-release-receipt", receipt.workspaceId, receipt.principalId,
          receipt.capability, receipt.idempotencyKey,
        ])}, 0))`);
        const priorReceipts = await tx.select().from(runtimePublishingDeliveryReleaseReceipts)
          .where(and(
            eq(runtimePublishingDeliveryReleaseReceipts.workspaceId, receipt.workspaceId),
            eq(runtimePublishingDeliveryReleaseReceipts.principalId, receipt.principalId),
            eq(runtimePublishingDeliveryReleaseReceipts.capability, receipt.capability),
            eq(runtimePublishingDeliveryReleaseReceipts.idempotencyKey, receipt.idempotencyKey),
          )).limit(1).for("update");
        if (priorReceipts[0]) {
          if (priorReceipts[0].requestFingerprint !== receipt.requestFingerprint) {
            return { kind: "conflict" as const };
          }
          const replay = await storedRelease(tx, {
            workspaceId: receipt.workspaceId,
            releaseId: priorReceipts[0].releaseId,
            consumingPrincipalId: receipt.principalId,
          });
          return replay
            ? { kind: "replayed" as const, ...replay }
            : { kind: "unavailable" as const };
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
          "publishing-approval-consumption", release.workspaceId, release.approvalDecisionId,
        ])}, 0))`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
          "publishing-delivery-approval", release.workspaceId, release.approvalDecisionId,
        ])}, 0))`);
        const requestRows = await tx.select().from(runtimePublishingApprovalRequests).where(and(
          eq(runtimePublishingApprovalRequests.workspaceId, approval.workspaceId),
          eq(runtimePublishingApprovalRequests.id, approval.id),
        )).limit(1).for("update");
        const decisionRows = await tx.select().from(runtimePublishingApprovalDecisions).where(and(
          eq(runtimePublishingApprovalDecisions.workspaceId, approval.workspaceId),
          eq(runtimePublishingApprovalDecisions.requestId, approval.id),
          eq(runtimePublishingApprovalDecisions.id, approval.decision!.id),
        )).limit(1).for("update");
        if (!requestRows[0] || !decisionRows[0] || decisionRows[0].outcome !== "approved") {
          return { kind: "approval_invalid" as const };
        }
        const consumed = await tx.select({ id: runtimePublishingApprovalConsumptions.id })
          .from(runtimePublishingApprovalConsumptions).where(and(
            eq(runtimePublishingApprovalConsumptions.workspaceId, approval.workspaceId),
            eq(runtimePublishingApprovalConsumptions.decisionId, approval.decision!.id),
          )).limit(1).for("update");
        if (consumed[0]) return { kind: "approval_consumed" as const };
        const currentApproval = await selectPublishingApprovalRequest(tx, {
          workspaceId: approval.workspaceId,
          approvalRequestId: approval.id,
        });
        if (!currentApproval?.decision || currentApproval.decision.decision !== "approved" ||
          currentApproval.consumption ||
          canonicalDigest(currentApproval.targetIds) !== canonicalDigest(approval.targetIds) ||
          canonicalDigest(currentApproval.channelIds) !== canonicalDigest(approval.channelIds) ||
          canonicalDigest(currentApproval.artifactIds) !== canonicalDigest(approval.artifactIds) ||
          canonicalDigest(currentApproval.validation) !== canonicalDigest(approval.validation)) {
          return { kind: "approval_invalid" as const };
        }
        const currentRevision = await lockCurrentPublishingApprovalRevision(tx, currentApproval);
        if (!currentRevision || currentRevision.id !== revision.id ||
          currentRevision.revision !== revision.revision ||
          currentRevision.definitionDigest !== revision.definitionDigest) {
          return { kind: "stale_revision" as const };
        }
        const initialNow = await verifyCurrentPublishingPlanEvidence(
          tx,
          currentRevision,
          input.validationSession.expiresAt,
          currentApproval.targetIds,
        );
        if (!initialNow || !validPublishingDeliveryValidationSession({
          session: input.validationSession,
          approval: currentApproval,
          revision: currentRevision,
          now: initialNow,
        })) return { kind: "validation_stale" as const };
        if (!await lockReleaseAuthorization(
          tx,
          input.authorizationSession,
          currentApproval,
          initialNow,
        )) return { kind: "authorization_stale" as const };
        // Authorization and resource locks may have waited. Recheck mutable
        // evidence under a fresh database clock immediately before writing.
        const finalNow = await verifyCurrentPublishingPlanEvidence(
          tx,
          currentRevision,
          input.validationSession.expiresAt,
          currentApproval.targetIds,
        );
        if (!finalNow || !validPublishingDeliveryValidationSession({
          session: input.validationSession,
          approval: currentApproval,
          revision: currentRevision,
          now: finalNow,
        })) return { kind: "validation_stale" as const };
        if (!await lockReleaseAuthorization(
          tx,
          input.authorizationSession,
          currentApproval,
          finalNow,
        )) return { kind: "authorization_stale" as const };
        const materialized = input.deliveries.map((delivery) => ({
          ...delivery,
          acceptedAt: finalNow,
          scheduledAt: finalNow,
          updatedAt: finalNow,
        }));
        const acceptedDeliveries = materialized.map(publishingDeliveryAcceptedRef);
        await tx.insert(runtimePublishingApprovalConsumptions).values({
          ...input.approvalConsumption,
          consumedAt: finalNow,
        });
        await tx.insert(runtimePublishingDeliveryReleases).values({
          ...release,
          approvalConsumptionId: input.approvalConsumption.id,
          acceptedDeliveries,
          createdAt: finalNow,
        });
        await tx.insert(runtimePublishingDeliveries).values(materialized.map((delivery, targetOrdinal) => ({
          ...delivery,
          targetOrdinal,
          validationEvidenceDigest: release.validationEvidenceDigest,
        })));
        await tx.insert(runtimePublishingDeliveryEvents).values(
          input.firstEvents.map((event) => ({
            workspaceId: event.workspaceId,
            id: event.id,
            deliveryId: event.deliveryId,
            sequence: event.sequence,
            type: event.type,
            evidence: event.evidence,
            occurredAt: finalNow,
          })),
        );
        await tx.insert(runtimePublishingDeliveryOutboxIntents).values(input.outboxIntents);
        await tx.insert(runtimePublishingDeliveryReleaseReceipts).values({
          ...receipt,
          createdAt: finalNow,
        });
        const stored = await storedRelease(tx, {
          workspaceId: release.workspaceId,
          releaseId: release.id,
          consumingPrincipalId: release.consumingPrincipalId,
        });
        if (!stored) throw new PublishingDeliveryTransactionRollback();
        return { kind: "created" as const, ...stored };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async getRelease(input: Parameters<PublishingDeliveryRepository["getRelease"]>[0]) {
    const result = await storedRelease(this.database(), input);
    return result?.release ?? null;
  }

  async getDeliveriesByRelease(input: Parameters<PublishingDeliveryRepository["getDeliveriesByRelease"]>[0]) {
    const result = await storedRelease(this.database(), input);
    return result?.deliveries ?? [];
  }

  async getDelivery(input: Parameters<PublishingDeliveryRepository["getDelivery"]>[0]) {
    const rows = await this.database().select({
      delivery: runtimePublishingDeliveries,
      principalId: runtimePublishingDeliveryReleases.consumingPrincipalId,
    }).from(runtimePublishingDeliveries).innerJoin(
      runtimePublishingDeliveryReleases,
      and(
        eq(runtimePublishingDeliveryReleases.workspaceId, runtimePublishingDeliveries.workspaceId),
        eq(runtimePublishingDeliveryReleases.id, runtimePublishingDeliveries.releaseId),
      ),
    ).where(and(
      eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
      eq(runtimePublishingDeliveries.id, input.deliveryId),
      input.consumingPrincipalId
        ? eq(runtimePublishingDeliveryReleases.consumingPrincipalId, input.consumingPrincipalId)
        : undefined,
      input.authorizedChannelIds
        ? inArray(runtimePublishingDeliveries.channelId, input.authorizedChannelIds)
        : undefined,
      input.authorizedArtifactIds
        ? sql`${runtimePublishingDeliveries.artifactIds} <@ ${JSON.stringify(input.authorizedArtifactIds)}::jsonb`
        : undefined,
    )).limit(1);
    return rows[0] ? rehydratePublishingDelivery(rows[0].delivery) : null;
  }

  async listDeliveries(input: Parameters<PublishingDeliveryRepository["listDeliveries"]>[0]) {
    const rows = await this.database().select({ delivery: runtimePublishingDeliveries })
      .from(runtimePublishingDeliveries).innerJoin(
        runtimePublishingDeliveryReleases,
        and(
          eq(runtimePublishingDeliveryReleases.workspaceId, runtimePublishingDeliveries.workspaceId),
          eq(runtimePublishingDeliveryReleases.id, runtimePublishingDeliveries.releaseId),
        ),
      ).where(and(
        eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
        input.filters.planRevisionId
          ? eq(runtimePublishingDeliveries.planRevisionId, input.filters.planRevisionId)
          : undefined,
        input.filters.state ? eq(runtimePublishingDeliveries.state, input.filters.state) : undefined,
        input.filters.targetId ? eq(runtimePublishingDeliveries.targetId, input.filters.targetId) : undefined,
        input.filters.consumingPrincipalId
          ? eq(runtimePublishingDeliveryReleases.consumingPrincipalId, input.filters.consumingPrincipalId)
          : undefined,
        input.filters.authorizedChannelIds
          ? inArray(runtimePublishingDeliveries.channelId, input.filters.authorizedChannelIds)
          : undefined,
        input.filters.authorizedArtifactIds
          ? sql`${runtimePublishingDeliveries.artifactIds} <@ ${JSON.stringify(input.filters.authorizedArtifactIds)}::jsonb`
          : undefined,
        input.before ? or(
          lt(runtimePublishingDeliveries.acceptedAt, input.before.acceptedAt),
          and(eq(runtimePublishingDeliveries.acceptedAt, input.before.acceptedAt),
            lt(runtimePublishingDeliveries.id, input.before.id)),
        ) : undefined,
      )).orderBy(desc(runtimePublishingDeliveries.acceptedAt), desc(runtimePublishingDeliveries.id))
      .limit(input.limit);
    const deliveries = rows.map((row) => rehydratePublishingDelivery(row.delivery));
    return deliveries.some((row) => !row) ? [] : deliveries as PublishingDeliveryRecord[];
  }

  async listEvents(input: Parameters<PublishingDeliveryRepository["listEvents"]>[0]) {
    const delivery = await this.getDelivery(input);
    if (!delivery) return null;
    const rows = await this.database().select().from(runtimePublishingDeliveryEvents).where(and(
      eq(runtimePublishingDeliveryEvents.workspaceId, input.workspaceId),
      eq(runtimePublishingDeliveryEvents.deliveryId, input.deliveryId),
      gt(runtimePublishingDeliveryEvents.sequence, input.afterSequence),
    )).orderBy(asc(runtimePublishingDeliveryEvents.sequence)).limit(input.limit);
    const events = rows.map(rehydratePublishingDeliveryEvent);
    if (events.some((event) => !event)) return null;
    const exact = events as PublishingDeliveryEvent[];
    return exact.every((event, index) => event.sequence === input.afterSequence + index + 1)
      ? exact
      : null;
  }

  async claimOutbox(input: Parameters<PublishingDeliveryRepository["claimOutbox"]>[0]) {
    try {
      return await this.database().transaction(async (tx) => {
        const rows = await tx.select().from(runtimePublishingDeliveryOutboxIntents).where(and(
          lte(runtimePublishingDeliveryOutboxIntents.availableAt, sql`clock_timestamp()`),
          or(
            eq(runtimePublishingDeliveryOutboxIntents.state, "pending"),
            and(
              eq(runtimePublishingDeliveryOutboxIntents.state, "claimed"),
              lte(runtimePublishingDeliveryOutboxIntents.claimedAt, input.claimExpiresBefore),
            ),
          ),
        )).orderBy(
          asc(runtimePublishingDeliveryOutboxIntents.availableAt),
          asc(runtimePublishingDeliveryOutboxIntents.deliveryId),
          asc(runtimePublishingDeliveryOutboxIntents.generation),
          asc(runtimePublishingDeliveryOutboxIntents.id),
        ).limit(1).for("update", { skipLocked: true });
        if (!rows[0]) return { kind: "empty" as const };
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const updated = await tx.update(runtimePublishingDeliveryOutboxIntents).set({
          state: "claimed",
          deliveryToken: input.deliveryToken,
          deliveryAttempts: rows[0].deliveryAttempts + 1,
          claimedAt: now,
          deliveredAt: null,
        }).where(eq(runtimePublishingDeliveryOutboxIntents.id, rows[0].id)).returning();
        const intent = requireWrittenRecord(
          updated[0] ? rehydratePublishingDeliveryOutbox(updated[0]) : null,
        );
        return { kind: "claimed" as const, intent };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async markOutboxDelivered(input: Parameters<PublishingDeliveryRepository["markOutboxDelivered"]>[0]) {
    try {
      const rows = await this.database().update(runtimePublishingDeliveryOutboxIntents).set({
        state: "delivered", deliveryToken: null, deliveredAt: input.deliveredAt,
      }).where(and(
        eq(runtimePublishingDeliveryOutboxIntents.id, input.intentId),
        eq(runtimePublishingDeliveryOutboxIntents.state, "claimed"),
        eq(runtimePublishingDeliveryOutboxIntents.deliveryToken, input.deliveryToken),
      )).returning({ id: runtimePublishingDeliveryOutboxIntents.id });
      return rows[0] ? "delivered" as const : "stale" as const;
    } catch {
      return "unavailable" as const;
    }
  }

  async releaseOutbox(input: Parameters<PublishingDeliveryRepository["releaseOutbox"]>[0]) {
    try {
      const rows = await this.database().update(runtimePublishingDeliveryOutboxIntents).set({
        state: "pending", deliveryToken: null, claimedAt: null, deliveredAt: null,
        availableAt: input.availableAt,
      }).where(and(
        eq(runtimePublishingDeliveryOutboxIntents.id, input.intentId),
        eq(runtimePublishingDeliveryOutboxIntents.state, "claimed"),
        eq(runtimePublishingDeliveryOutboxIntents.deliveryToken, input.deliveryToken),
      )).returning({ id: runtimePublishingDeliveryOutboxIntents.id });
      return rows[0] ? "released" as const : "stale" as const;
    } catch {
      return "unavailable" as const;
    }
  }

  async acquireLease(input: Parameters<PublishingDeliveryRepository["acquireLease"]>[0]) {
    try {
      return await this.database().transaction(async (tx) => {
        const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = deliveryRows[0] ? rehydratePublishingDelivery(deliveryRows[0]) : null;
        if (!delivery) return { kind: "unavailable" as const };
        if (["succeeded", "failed", "outcome_unknown"].includes(delivery.state)) {
          return { kind: "terminal" as const };
        }
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const outbox = await tx.select().from(runtimePublishingDeliveryOutboxIntents).where(and(
          eq(runtimePublishingDeliveryOutboxIntents.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryOutboxIntents.deliveryId, input.deliveryId),
        )).orderBy(desc(runtimePublishingDeliveryOutboxIntents.generation)).limit(1).for("update");
        if (!outbox[0] || outbox[0].availableAt > now ||
          (outbox[0].state !== "claimed" && outbox[0].state !== "delivered") ||
          outbox[0].generation !== delivery.nextOutboxGeneration - 1 ||
          delivery.publishAt > now) return { kind: "not_due" as const };
        const existingRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases)
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
          )).limit(1).for("update");
        const current = existingRows[0];
        if (current && current.releasedAt === null && current.expiresAt > now) {
          return { kind: "busy" as const };
        }
        const leaseToken = randomUUID();
        const expiresAt = new Date(now.getTime() + Math.max(1, input.expiresAt.getTime() - input.now.getTime()));
        const values = {
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          workerId: input.workerId,
          leaseToken,
          fence: (current?.fence ?? BigInt(0)) + BigInt(1),
          acquiredAt: now,
          expiresAt,
          renewedAt: now,
          releasedAt: null,
        };
        const rows = current
          ? await tx.update(runtimePublishingDeliveryExecutionLeases).set(values).where(and(
              eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
              eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
            )).returning()
          : await tx.insert(runtimePublishingDeliveryExecutionLeases).values(values).returning();
        const lease = requireWrittenRecord(
          rows[0] ? rehydratePublishingDeliveryLease(rows[0]) : null,
        );
        return { kind: "acquired" as const, delivery, lease };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async renewLease(input: Parameters<PublishingDeliveryRepository["renewLease"]>[0]) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return null;
        const expiresAt = new Date(now.getTime() + Math.max(1, input.expiresAt.getTime() - input.now.getTime()));
        const rows = await tx.update(runtimePublishingDeliveryExecutionLeases).set({
          expiresAt, renewedAt: now,
        }).where(and(
          eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
          eq(runtimePublishingDeliveryExecutionLeases.workerId, input.workerId),
          eq(runtimePublishingDeliveryExecutionLeases.leaseToken, input.leaseToken),
          eq(runtimePublishingDeliveryExecutionLeases.fence, input.fence),
          isNull(runtimePublishingDeliveryExecutionLeases.releasedAt),
          gt(runtimePublishingDeliveryExecutionLeases.expiresAt, now),
        )).returning();
        if (!rows[0]) return null;
        return requireWrittenRecord(rehydratePublishingDeliveryLease(rows[0]));
      });
    } catch {
      return null;
    }
  }

  async prepareEffect(input: Parameters<PublishingDeliveryRepository["prepareEffect"]>[0]) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases).where(and(
          eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
        )).limit(1).for("update");
        const lease = leaseRows[0];
        if (!lease || lease.workerId !== input.workerId || lease.leaseToken !== input.leaseToken ||
          lease.fence !== input.fence || lease.releasedAt || lease.expiresAt <= now) {
          return { kind: "stale" as const };
        }
        const rows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = rows[0] ? rehydratePublishingDelivery(rows[0]) : null;
        if (!delivery || delivery.effectKey !== input.effectKey ||
          (delivery.intentDigest && delivery.intentDigest !== input.intentDigest)) {
          return { kind: "stale" as const };
        }
        if ((delivery.state === "dispatching" || delivery.state === "confirmation_pending") &&
          delivery.intentDigest === input.intentDigest) {
          const events = await tx.select().from(runtimePublishingDeliveryEvents).where(and(
            eq(runtimePublishingDeliveryEvents.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryEvents.deliveryId, input.deliveryId),
            eq(runtimePublishingDeliveryEvents.type, "effect.prepared"),
          )).orderBy(desc(runtimePublishingDeliveryEvents.sequence)).limit(1);
          const event = events[0] ? rehydratePublishingDeliveryEvent(events[0]) : null;
          return event ? { kind: "replayed" as const, delivery, event } : { kind: "unavailable" as const };
        }
        if (delivery.state !== "scheduled") return { kind: "stale" as const };
        const event: PublishingDeliveryEvent = {
          schema: "publishing-delivery-event/v1",
          id: `pde_${randomUUID().replaceAll("-", "")}`,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          sequence: delivery.nextEventSequence,
          type: "effect.prepared",
          evidence: { effectKey: input.effectKey, intentDigest: input.intentDigest },
          occurredAt: now,
        };
        await tx.insert(runtimePublishingDeliveryEvents).values({
          workspaceId: event.workspaceId, id: event.id, deliveryId: event.deliveryId,
          sequence: event.sequence, type: event.type, evidence: event.evidence,
          occurredAt: now,
        });
        const updated = await tx.update(runtimePublishingDeliveries).set({
          state: "dispatching",
          intentDigest: input.intentDigest,
          latestEffectEvidenceDigest: null,
          failureCode: null,
          dispatchStartedAt: delivery.dispatchStartedAt ?? now,
          completedAt: null,
          nextEventSequence: delivery.nextEventSequence + 1,
          updatedAt: now,
        }).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).returning();
        const record = requireWrittenRecord(
          updated[0] ? rehydratePublishingDelivery(updated[0]) : null,
        );
        return { kind: "prepared" as const, delivery: record, event };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async failBeforeEffect(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    leaseToken: string;
    fence: bigint;
    effectKey: string;
    evidenceDigest: string;
    failureCode: string;
    occurredAt: Date;
  }) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases).where(and(
          eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
        )).limit(1).for("update");
        const lease = leaseRows[0];
        if (!lease || lease.workerId !== input.workerId || lease.leaseToken !== input.leaseToken ||
          lease.fence !== input.fence || lease.releasedAt || lease.expiresAt <= now) {
          return { kind: "stale" as const };
        }
        const rows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = rows[0] ? rehydratePublishingDelivery(rows[0]) : null;
        if (!delivery || delivery.state !== "scheduled" || delivery.intentDigest !== null ||
          delivery.effectKey !== input.effectKey || !DIGEST.test(input.evidenceDigest) ||
          !/^[A-Z][A-Z0-9_]{0,79}$/.test(input.failureCode)) {
          return { kind: "stale" as const };
        }
        const event: PublishingDeliveryEvent = {
          schema: "publishing-delivery-event/v1",
          id: `pde_${randomUUID().replaceAll("-", "")}`,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          sequence: delivery.nextEventSequence,
          type: "effect.not_created",
          evidence: {
            effectKey: input.effectKey,
            evidenceDigest: input.evidenceDigest,
            failureCode: input.failureCode,
          },
          occurredAt: now,
        };
        await tx.insert(runtimePublishingDeliveryEvents).values({
          workspaceId: event.workspaceId, id: event.id, deliveryId: event.deliveryId,
          sequence: event.sequence, type: event.type, evidence: event.evidence,
          occurredAt: now,
        });
        const updated = await tx.update(runtimePublishingDeliveries).set({
          state: "failed",
          providerOperationRef: null,
          latestEffectEvidenceDigest: input.evidenceDigest,
          failureCode: input.failureCode,
          dispatchStartedAt: null,
          completedAt: now,
          nextEventSequence: delivery.nextEventSequence + 1,
          updatedAt: now,
        }).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).returning();
        await tx.update(runtimePublishingDeliveryExecutionLeases).set({ releasedAt: now })
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
            eq(runtimePublishingDeliveryExecutionLeases.fence, input.fence),
          ));
        const record = requireWrittenRecord(
          updated[0] ? rehydratePublishingDelivery(updated[0]) : null,
        );
        return { kind: "settled" as const, delivery: record, event };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async settleEffect(input: Parameters<PublishingDeliveryRepository["settleEffect"]>[0]) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases).where(and(
          eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
        )).limit(1).for("update");
        const lease = leaseRows[0];
        if (!lease || lease.workerId !== input.workerId || lease.leaseToken !== input.leaseToken ||
          lease.fence !== input.fence) {
          return { kind: "stale" as const };
        }
        const rows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = rows[0] ? rehydratePublishingDelivery(rows[0]) : null;
        if (!delivery || delivery.effectKey !== input.effectKey ||
          delivery.intentDigest !== input.intentDigest) return { kind: "stale" as const };
        if (lease.releasedAt) {
          if (delivery.latestEffectEvidenceDigest !== input.outcome.evidenceDigest) {
            return { kind: "stale" as const };
          }
          const replayType = input.outcome.kind === "retry_scheduled"
            ? "publication.retry_scheduled"
            : input.outcome.kind === "confirmation_pending"
              ? "publication.confirmation_pending"
              : `publication.${input.outcome.kind}`;
          const events = await tx.select().from(runtimePublishingDeliveryEvents).where(and(
            eq(runtimePublishingDeliveryEvents.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryEvents.deliveryId, input.deliveryId),
          )).orderBy(desc(runtimePublishingDeliveryEvents.sequence)).limit(1);
          const event = events[0] ? rehydratePublishingDeliveryEvent(events[0]) : null;
          return event && event.type === replayType &&
            "evidenceDigest" in event.evidence &&
            event.evidence.evidenceDigest === input.outcome.evidenceDigest
            ? { kind: "replayed" as const, delivery, event }
            : { kind: "stale" as const };
        }
        if (lease.expiresAt <= now) return { kind: "stale" as const };
        if (delivery.state !== "dispatching" && delivery.state !== "confirmation_pending") {
          return { kind: "stale" as const };
        }
        const needsFollowUp = input.outcome.kind === "retry_scheduled" ||
          input.outcome.kind === "confirmation_pending";
        if (needsFollowUp !== Boolean(input.retryOutboxIntent)) return { kind: "stale" as const };
        const nextState = input.outcome.kind === "retry_scheduled" ? "scheduled" :
          input.outcome.kind === "confirmation_pending" ? "confirmation_pending" :
          input.outcome.kind;
        const eventType = input.outcome.kind === "retry_scheduled"
          ? "publication.retry_scheduled" :
          input.outcome.kind === "confirmation_pending"
            ? "publication.confirmation_pending"
            : `publication.${input.outcome.kind}` as const;
        if (input.retryOutboxIntent) {
          const expectedAt = input.outcome.kind === "retry_scheduled"
            ? input.outcome.retryAt
            : input.outcome.kind === "confirmation_pending" ? input.outcome.pollAt : null;
          const prior = await tx.select({ generation: runtimePublishingDeliveryOutboxIntents.generation })
            .from(runtimePublishingDeliveryOutboxIntents).where(and(
              eq(runtimePublishingDeliveryOutboxIntents.workspaceId, input.workspaceId),
              eq(runtimePublishingDeliveryOutboxIntents.deliveryId, input.deliveryId),
            )).orderBy(desc(runtimePublishingDeliveryOutboxIntents.generation)).limit(1).for("share");
          if (!expectedAt || input.retryOutboxIntent.workspaceId !== input.workspaceId ||
            input.retryOutboxIntent.deliveryId !== input.deliveryId ||
            input.retryOutboxIntent.generation !== delivery.nextOutboxGeneration ||
            (prior[0]?.generation ?? 0) + 1 !== delivery.nextOutboxGeneration ||
            input.retryOutboxIntent.dedupeKey !== publishingDeliveryOutboxDedupeKey(
              input.workspaceId,
              input.deliveryId,
              delivery.nextOutboxGeneration,
            ) ||
            input.retryOutboxIntent.state !== "pending" ||
            input.retryOutboxIntent.availableAt.getTime() !== expectedAt.getTime() ||
            input.retryOutboxIntent.deliveryToken || input.retryOutboxIntent.claimedAt ||
            input.retryOutboxIntent.deliveredAt || input.retryOutboxIntent.deliveryAttempts !== 0) {
            return { kind: "stale" as const };
          }
        }
        const evidence = input.outcome.kind === "retry_scheduled" ? {
          effectKey: input.effectKey,
          evidenceDigest: input.outcome.evidenceDigest,
          failureCode: input.outcome.failureCode,
          retryAt: input.outcome.retryAt.toISOString(),
        } : input.outcome.kind === "confirmation_pending" ? {
          effectKey: input.effectKey,
          providerOperationRef: input.outcome.providerOperationRef,
          evidenceDigest: input.outcome.evidenceDigest,
          pollAt: input.outcome.pollAt.toISOString(),
        } : {
          effectKey: input.effectKey,
          providerOperationRef: input.outcome.providerOperationRef,
          evidenceDigest: input.outcome.evidenceDigest,
          failureCode: input.outcome.kind === "succeeded" ? null : input.outcome.failureCode,
        };
        const event = {
          schema: "publishing-delivery-event/v1" as const,
          id: `pde_${randomUUID().replaceAll("-", "")}`,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          sequence: delivery.nextEventSequence,
          type: eventType,
          evidence,
          occurredAt: now,
        } as PublishingDeliveryEvent;
        await tx.insert(runtimePublishingDeliveryEvents).values({
          workspaceId: event.workspaceId, id: event.id, deliveryId: event.deliveryId,
          sequence: event.sequence, type: event.type, evidence: event.evidence,
          occurredAt: now,
        });
        if (input.retryOutboxIntent) {
          await tx.insert(runtimePublishingDeliveryOutboxIntents).values(input.retryOutboxIntent);
        }
        const completed = ["succeeded", "failed", "outcome_unknown"].includes(nextState);
        const updated = await tx.update(runtimePublishingDeliveries).set({
          state: nextState,
          providerOperationRef: input.outcome.kind === "confirmation_pending" ||
            input.outcome.kind === "succeeded" || input.outcome.kind === "failed"
              ? input.outcome.providerOperationRef
              : null,
          latestEffectEvidenceDigest: input.outcome.evidenceDigest,
          failureCode: input.outcome.kind === "succeeded" ||
            input.outcome.kind === "confirmation_pending" ? null : input.outcome.failureCode,
          completedAt: completed ? now : null,
          nextEventSequence: delivery.nextEventSequence + 1,
          nextOutboxGeneration: input.retryOutboxIntent
            ? delivery.nextOutboxGeneration + 1
            : delivery.nextOutboxGeneration,
          updatedAt: now,
        }).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).returning();
        await tx.update(runtimePublishingDeliveryExecutionLeases).set({ releasedAt: now })
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
            eq(runtimePublishingDeliveryExecutionLeases.fence, input.fence),
          ));
        const record = requireWrittenRecord(
          updated[0] ? rehydratePublishingDelivery(updated[0]) : null,
        );
        return { kind: "settled" as const, delivery: record, event };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }
}
