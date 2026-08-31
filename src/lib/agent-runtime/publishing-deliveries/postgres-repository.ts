import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { ARTIFACT_ID_PATTERN } from "../artifacts/validation";
import { readLinkedInAuthorKind } from "@/lib/social/linkedin-author-kind";
import type { getDb } from "@/lib/db";
import {
  agentAuthorizationDecisions,
  agentGrantRevisions,
  agentGrantSets,
  agentKeys,
  agentPrincipals,
  agentSecurityEvents,
  runtimePublishingApprovalAuthorityGrants,
  runtimePublishingApprovalAuthorityRevocations,
  runtimePublishingApprovalConsumptions,
  runtimePublishingApprovalDecisions,
  runtimePublishingApprovalRequests,
  runtimePublishingPlans,
  runtimePublishingDeliveries,
  runtimePublishingDeliveryCancellations,
  runtimePublishingDeliveryEffectIdentities,
  runtimePublishingDeliveryEffectReceipts,
  runtimePublishingDeliveryEvents,
  runtimePublishingDeliveryExecutionLeases,
  runtimePublishingDeliveryOutboxIntents,
  runtimePublishingDeliveryReadinessReceipts,
  runtimePublishingDeliveryReconciliationReceipts,
  runtimePublishingDeliveryReconciliationRequests,
  runtimePublishingDeliveryReleaseReceipts,
  runtimePublishingDeliveryReleases,
  runtimePublishingDeliveryRetryApprovalConsumptions,
  runtimePublishingDeliveryRetryReceipts,
  socialAccounts,
  workspaceMembers,
  workspaceAgentPolicies,
  workspaceAgentPolicyRevisions,
} from "@/lib/db/schema";
import {
  lockCurrentPublishingApprovalRevision,
  lockRetainedPublishingApprovalRevision,
  selectPublishingApprovalRequest,
  verifyCurrentPublishingPlanEvidence,
} from "../publishing-approvals/postgres-repository";
import {
  publishingApprovalReleaseAuthorizationContractDigest,
} from "../publishing-approvals/authorization-contract";
import {
  publishingDeliveryCancelAuthorizationContractDigest,
  publishingDeliveryReconcileAuthorizationContractDigest,
  publishingDeliveryRetryAuthorizationContractDigest,
} from "./authorization-contract";
import type {
  PublishingApprovalRequestRecord,
} from "../publishing-approvals/types";
import type {
  PublishingPlanRevisionRecord,
} from "../publishing-plans/types";
import { publishingPlanLinkedInCapabilityVersion } from
  "../publishing-plans/production-digests";
import { publishingPlanChannelVersionDigest } from
  "../publishing-plans/production-digests";
import type {
  PublishingDeliveryAcceptedRef,
  PublishingDeliveryAuthorizationPort,
  PublishingDeliveryAuthorizationSession,
  PublishingDeliveryCancellationAuthorizationPort,
  PublishingDeliveryCancellationAuthorizationSession,
  PublishingDeliveryCancellationRecord,
  PublishingDeliveryEffectIdentityRecord,
  PublishingDeliveryExecutionReadinessPort,
  PublishingDeliveryExecutionReadinessSession,
  PublishingDeliveryEvent,
  PublishingDeliveryExecutionLeaseRecord,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryReconciliationProjection,
  PublishingDeliveryReconciliationRequestRecord,
  PublishingDeliveryReconciliationResultRecord,
  PublishingDeliveryReconciliationResolution,
  PublishingDeliveryRecoveryAuthorizationPort,
  PublishingDeliveryRecoveryAuthorizationSession,
  PublishingDeliveryReleaseRecord,
  PublishingDeliveryRepository,
  PublishingDeliveryRetryRecord,
  PublishingDeliveryRetryMutationReceiptRecord,
} from "./types";
import {
  publishingDeliveryAcceptedRef,
  publishingDeliveryReconciliationExhausted,
  validPublishingDeliveryAuthorizationSession,
  validPublishingDeliveryValidationSession,
} from "./validation";
import {
  publishingDeliveryEffectKey,
  publishingDeliveryOutboxDedupeKey,
} from "./keys";
import {
  normalizePublishingDeliverySettlement,
  planPublishingDeliveryCancellation,
} from "./cancellation-transition";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ReleaseRow = typeof runtimePublishingDeliveryReleases.$inferSelect;
type DeliveryRow = typeof runtimePublishingDeliveries.$inferSelect;
type CancellationRow = typeof runtimePublishingDeliveryCancellations.$inferSelect;
type EffectIdentityRow = typeof runtimePublishingDeliveryEffectIdentities.$inferSelect;
type RetryRow = typeof runtimePublishingDeliveryRetryReceipts.$inferSelect;
type ReconciliationRequestRow =
  typeof runtimePublishingDeliveryReconciliationRequests.$inferSelect;
type ReconciliationResultRow =
  typeof runtimePublishingDeliveryReconciliationReceipts.$inferSelect;
type EventRow = typeof runtimePublishingDeliveryEvents.$inferSelect;
type OutboxRow = typeof runtimePublishingDeliveryOutboxIntents.$inferSelect;
type LeaseRow = typeof runtimePublishingDeliveryExecutionLeases.$inferSelect;

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const RELEASE_AUTHORIZATION_TTL_MS = 15 * 60_000;
const CANCELLATION_AGENT_AUTHORIZATION_TTL_MS = 15 * 60_000;
const CANCELLATION_HUMAN_AUTHORIZATION_TTL_MS = 5 * 60_000;

export function validRetainedExecutionAdmissionProvenance(input: {
  issuedAt: Date;
  expiresAt: Date;
  executionAt: Date;
}): boolean {
  // Admission expiry bounds when the original authority could be consumed; it
  // is not an execution deadline for a Delivery scheduled further in future.
  return input.issuedAt < input.expiresAt && input.issuedAt <= input.executionAt;
}

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

function covers(allowed: string[], required: string[]): boolean {
  const allowedSet = new Set(allowed);
  return required.every((value) => allowedSet.has(value));
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
    !Number.isSafeInteger(row.effectGeneration) || row.effectGeneration < 1 ||
    !Number.isSafeInteger(row.nextEffectAttempt) || row.nextEffectAttempt < 1 ||
    row.nextEffectAttempt > 9 || !Number.isSafeInteger(row.confirmationAttempts) ||
    row.confirmationAttempts < 0 || row.confirmationAttempts > 3 ||
    !Number.isSafeInteger(row.readinessBlockCount) || row.readinessBlockCount < 0 ||
    row.readinessBlockCount > 2_147_483_647 ||
    row.scheduledAt < row.acceptedAt || row.updatedAt < row.acceptedAt ||
    (row.dispatchStartedAt !== null && row.dispatchStartedAt < row.acceptedAt) ||
    (row.effectContactStartedAt !== null &&
      (row.dispatchStartedAt === null || row.effectContactStartedAt < row.dispatchStartedAt)) ||
    (row.completedAt !== null && row.completedAt < row.acceptedAt) ||
    (row.providerOperationRef !== null && !safeRef(row.providerOperationRef)) ||
    (row.failureCode !== null && !/^[A-Z][A-Z0-9_]{0,79}$/.test(row.failureCode)) ||
    (row.providerAdapterContractDigest !== null &&
      !DIGEST.test(row.providerAdapterContractDigest)) ||
    (row.failureClass !== null && !["transient", "terminal"].includes(row.failureClass)) ||
    (row.failureEffectDisposition !== null &&
      !["not_created", "provider_failed_known", "ambiguous"]
        .includes(row.failureEffectDisposition)) ||
    (row.state === "blocked"
      ? !row.readinessBlockCode || ![
          "EXECUTION_AUTHORIZATION_REVOKED", "APPROVAL_NO_LONGER_VALID",
          "CHANNEL_UNAVAILABLE", "CREDENTIAL_UNAVAILABLE", "VALIDATION_STALE",
        ].includes(row.readinessBlockCode) || !row.readinessEvidenceDigest ||
        !DIGEST.test(row.readinessEvidenceDigest) || !row.readinessBlockedAt ||
        !row.readinessRetryAt || row.readinessRetryAt <= row.readinessBlockedAt ||
        row.readinessBlockCount < 1
      : row.readinessBlockCode !== null || row.readinessEvidenceDigest !== null ||
        row.readinessBlockedAt !== null || row.readinessRetryAt !== null ||
        row.readinessBlockCount !== 0)) return false;
  const hasIntent = row.intentDigest !== null;
  const hasEvidence = row.latestEffectEvidenceDigest !== null;
  switch (row.state) {
    case "scheduled":
      return row.desiredState === "publish" && row.providerOperationRef === null &&
        row.completedAt === null &&
        ((!hasIntent && !hasEvidence && row.failureCode === null && row.dispatchStartedAt === null) ||
          (hasIntent && !hasEvidence && row.failureCode === null &&
            row.dispatchStartedAt === null && row.effectContactStartedAt === null) ||
          (hasIntent && hasEvidence && row.failureCode !== null &&
            row.dispatchStartedAt !== null && row.effectContactStartedAt !== null));
    case "blocked":
      return row.desiredState === "publish" && hasIntent && !hasEvidence &&
        row.providerAdapterContractDigest !== null && row.providerOperationRef === null &&
        row.failureCode === null && row.failureClass === null &&
        row.failureRetryable === null && row.failureEffectDisposition === null &&
        row.dispatchStartedAt !== null && row.effectContactStartedAt === null &&
        row.completedAt === null;
    case "dispatching":
      return hasIntent && !hasEvidence && row.providerOperationRef === null &&
        row.failureCode === null && row.dispatchStartedAt !== null && row.completedAt === null;
    case "confirmation_pending":
      return hasIntent && hasEvidence && row.providerOperationRef !== null &&
        row.failureCode === null && row.dispatchStartedAt !== null &&
        row.effectContactStartedAt !== null && row.completedAt === null;
    case "succeeded":
      return hasIntent && hasEvidence && row.providerOperationRef !== null &&
        row.failureCode === null && row.dispatchStartedAt !== null &&
        row.effectContactStartedAt !== null && row.completedAt !== null;
    case "failed_transient":
    case "failed_terminal":
      return hasEvidence && row.failureCode !== null && row.completedAt !== null &&
        row.failureClass === (row.state === "failed_transient" ? "transient" : "terminal") &&
        row.failureRetryable === (row.state === "failed_transient") &&
        (row.failureEffectDisposition === "not_created" ||
          row.failureEffectDisposition === "provider_failed_known") &&
        (row.failureEffectDisposition === "not_created"
          ? row.providerOperationRef === null &&
            ((row.effectContactStartedAt === null && row.dispatchStartedAt === null) ||
              (hasIntent && row.providerAdapterContractDigest !== null &&
                row.effectContactStartedAt !== null && row.dispatchStartedAt !== null))
          : hasIntent && row.providerAdapterContractDigest !== null &&
            row.dispatchStartedAt !== null && row.effectContactStartedAt !== null);
    case "outcome_unknown":
      return hasIntent && hasEvidence &&
        row.failureCode !== null && row.dispatchStartedAt !== null &&
        row.effectContactStartedAt !== null && row.completedAt !== null;
    case "cancelled":
      return row.desiredState === "cancel" && !hasEvidence && row.failureCode === null &&
        row.providerOperationRef === null && row.effectContactStartedAt === null &&
        row.completedAt !== null &&
        ((!hasIntent && row.dispatchStartedAt === null) ||
          (hasIntent && row.dispatchStartedAt !== null));
    default:
      return false;
  }
}

export function rehydratePublishingDelivery(row: DeliveryRow): PublishingDeliveryRecord | null {
  const artifactIds = targetArtifactIds(row);
  const initialOrigin = row.releaseId !== null && row.sourceDeliveryId === null &&
    row.retryId === null;
  const retryOrigin = row.releaseId === null && row.sourceDeliveryId !== null &&
    row.retryId !== null;
  if (!artifactIds || !ID.test(row.id) || !ID.test(row.workspaceId) ||
    (!initialOrigin && !retryOrigin) ||
    (row.releaseId !== null && !ID.test(row.releaseId)) ||
    (row.sourceDeliveryId !== null && !ID.test(row.sourceDeliveryId)) ||
    (row.retryId !== null && !ID.test(row.retryId)) ||
    !ID.test(row.planId) || !ID.test(row.planRevisionId) ||
    row.planRevision < 1 || !DIGEST.test(row.planRevisionDigest) ||
    !ID.test(row.approvalRequestId) || !ID.test(row.approvalDecisionId) ||
    !ID.test(row.requestingPrincipalId) || !ID.test(row.requestingKeyId) ||
    !ID.test(row.targetId) || !ID.test(row.channelId) ||
    !DIGEST.test(row.targetSnapshotDigest) || !validDeliveryLifecycle(row) ||
    canonicalDigest(row.targetSnapshot) !== row.targetSnapshotDigest ||
    row.targetSnapshot.target.targetId !== row.targetId ||
    row.targetSnapshot.target.channelId !== row.channelId ||
    row.targetSnapshot.validation.targetId !== row.targetId ||
    row.targetSnapshot.validation.channel.id !== row.channelId ||
    !["publish", "cancel"].includes(row.desiredState) || ![
      "scheduled", "dispatching", "confirmation_pending", "succeeded", "failed_transient",
      "blocked",
      "failed_terminal",
      "outcome_unknown", "cancelled",
    ].includes(row.state) ||
    row.effectKey !== publishingDeliveryEffectKey(row.workspaceId, row.id, row.effectGeneration) ||
    (row.intentDigest !== null && !DIGEST.test(row.intentDigest)) ||
    (row.latestEffectEvidenceDigest !== null && !DIGEST.test(row.latestEffectEvidenceDigest))) {
    return null;
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sourceDeliveryId: row.sourceDeliveryId,
    retryId: row.retryId,
    releaseId: row.releaseId,
    planId: row.planId,
    planRevisionId: row.planRevisionId,
    planRevision: row.planRevision,
    planRevisionDigest: row.planRevisionDigest,
    approvalRequestId: row.approvalRequestId,
    approvalDecisionId: row.approvalDecisionId,
    requestingPrincipalId: row.requestingPrincipalId,
    requestingKeyId: row.requestingKeyId,
    targetId: row.targetId,
    channelId: row.channelId,
    artifactIds,
    targetSnapshot: structuredClone(row.targetSnapshot),
    targetSnapshotDigest: row.targetSnapshotDigest,
    publishAt: row.publishAt,
    desiredState: row.desiredState as PublishingDeliveryRecord["desiredState"],
    state: row.state as PublishingDeliveryRecord["state"],
    effectKey: row.effectKey,
    effectGeneration: row.effectGeneration,
    intentDigest: row.intentDigest,
    providerAdapterContractDigest: row.providerAdapterContractDigest,
    providerOperationRef: row.providerOperationRef,
    latestEffectEvidenceDigest: row.latestEffectEvidenceDigest,
    failureCode: row.failureCode,
    failureClass: row.failureClass as PublishingDeliveryRecord["failureClass"],
    failureRetryable: row.failureRetryable,
    failureEffectDisposition: row.failureEffectDisposition as
      PublishingDeliveryRecord["failureEffectDisposition"],
    readinessBlockCode: row.readinessBlockCode as
      PublishingDeliveryRecord["readinessBlockCode"],
    readinessEvidenceDigest: row.readinessEvidenceDigest,
    readinessBlockedAt: row.readinessBlockedAt,
    readinessRetryAt: row.readinessRetryAt,
    readinessBlockCount: row.readinessBlockCount,
    nextEffectAttempt: row.nextEffectAttempt,
    nextEventSequence: row.nextEventSequence,
    nextOutboxGeneration: row.nextOutboxGeneration,
    acceptedAt: row.acceptedAt,
    scheduledAt: row.scheduledAt,
    dispatchStartedAt: row.dispatchStartedAt,
    effectContactStartedAt: row.effectContactStartedAt,
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
        "origin", "releaseId", "sourceDeliveryId", "retryId", "approvalRequestId",
        "approvalDecisionId", "targetSnapshotDigest",
      ]) || (evidence.origin !== "release" && evidence.origin !== "retry") ||
        typeof evidence.approvalRequestId !== "string" || !ID.test(evidence.approvalRequestId) ||
        typeof evidence.approvalDecisionId !== "string" || !ID.test(evidence.approvalDecisionId) ||
        typeof evidence.targetSnapshotDigest !== "string" ||
        !DIGEST.test(evidence.targetSnapshotDigest)) return null;
      if (evidence.origin === "release") {
        if (typeof evidence.releaseId !== "string" || !ID.test(evidence.releaseId) ||
          evidence.sourceDeliveryId !== null || evidence.retryId !== null) return null;
        return { ...base, type: row.type, evidence: {
          origin: "release", releaseId: evidence.releaseId,
          sourceDeliveryId: null, retryId: null,
          approvalRequestId: evidence.approvalRequestId,
          approvalDecisionId: evidence.approvalDecisionId,
          targetSnapshotDigest: evidence.targetSnapshotDigest,
        } };
      }
      if (evidence.releaseId !== null || typeof evidence.sourceDeliveryId !== "string" ||
        !ID.test(evidence.sourceDeliveryId) || typeof evidence.retryId !== "string" ||
        !ID.test(evidence.retryId)) return null;
      return { ...base, type: row.type, evidence: {
        origin: "retry", releaseId: null,
        sourceDeliveryId: evidence.sourceDeliveryId, retryId: evidence.retryId,
        approvalRequestId: evidence.approvalRequestId,
        approvalDecisionId: evidence.approvalDecisionId,
        targetSnapshotDigest: evidence.targetSnapshotDigest,
      } };
    case "delivery.scheduled":
      if (!exactKeys(evidence, ["publishAt"]) || !safeIso(evidence.publishAt)) return null;
      return { ...base, type: row.type, evidence: { publishAt: evidence.publishAt } };
    case "delivery.blocked":
      if (!exactKeys(evidence, ["failureCode", "evidenceDigest", "retryAt", "blockCount"]) ||
        !["EXECUTION_AUTHORIZATION_REVOKED", "APPROVAL_NO_LONGER_VALID",
          "CHANNEL_UNAVAILABLE", "CREDENTIAL_UNAVAILABLE", "VALIDATION_STALE"]
          .includes(String(evidence.failureCode)) ||
        typeof evidence.evidenceDigest !== "string" || !DIGEST.test(evidence.evidenceDigest) ||
        !safeIso(evidence.retryAt) || !Number.isSafeInteger(evidence.blockCount) ||
        Number(evidence.blockCount) < 1 || Number(evidence.blockCount) > 2_147_483_647) return null;
      return { ...base, type: row.type, evidence: {
        failureCode: evidence.failureCode as Extract<PublishingDeliveryEvent,
          { type: "delivery.blocked" }>["evidence"]["failureCode"],
        evidenceDigest: evidence.evidenceDigest,
        retryAt: evidence.retryAt,
        blockCount: evidence.blockCount as number,
      } };
    case "delivery.resumed":
      if (!exactKeys(evidence, ["priorFailureCode", "priorEvidenceDigest",
        "readinessEvidenceDigest"]) ||
        !["EXECUTION_AUTHORIZATION_REVOKED", "APPROVAL_NO_LONGER_VALID",
          "CHANNEL_UNAVAILABLE", "CREDENTIAL_UNAVAILABLE", "VALIDATION_STALE"]
          .includes(String(evidence.priorFailureCode)) ||
        typeof evidence.priorEvidenceDigest !== "string" ||
        !DIGEST.test(evidence.priorEvidenceDigest) ||
        typeof evidence.readinessEvidenceDigest !== "string" ||
        !DIGEST.test(evidence.readinessEvidenceDigest)) return null;
      return { ...base, type: row.type, evidence: {
        priorFailureCode: evidence.priorFailureCode as Extract<PublishingDeliveryEvent,
          { type: "delivery.resumed" }>["evidence"]["priorFailureCode"],
        priorEvidenceDigest: evidence.priorEvidenceDigest,
        readinessEvidenceDigest: evidence.readinessEvidenceDigest,
      } };
    case "effect.not_created":
      if (!exactKeys(evidence, ["effectKey", "effectGeneration", "evidenceDigest", "failureCode",
        "failureClass", "retryable", "effectDisposition"]) ||
        !safeRef(evidence.effectKey) || typeof evidence.evidenceDigest !== "string" ||
        !DIGEST.test(evidence.evidenceDigest) || typeof evidence.failureCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,79}$/.test(evidence.failureCode) ||
        !Number.isSafeInteger(evidence.effectGeneration) || Number(evidence.effectGeneration) < 1 ||
        !["transient", "terminal"].includes(String(evidence.failureClass)) ||
        typeof evidence.retryable !== "boolean" || evidence.effectDisposition !== "not_created") return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        effectGeneration: evidence.effectGeneration as number,
        evidenceDigest: evidence.evidenceDigest,
        failureCode: evidence.failureCode,
        failureClass: evidence.failureClass as "transient" | "terminal",
        retryable: evidence.retryable,
        effectDisposition: "not_created",
      } };
    case "effect.prepared":
      if (!exactKeys(evidence, ["effectKey", "effectGeneration", "intentDigest",
        "providerAdapterContractDigest"]) || !safeRef(evidence.effectKey) ||
        !Number.isSafeInteger(evidence.effectGeneration) || Number(evidence.effectGeneration) < 1 ||
        typeof evidence.intentDigest !== "string" || !DIGEST.test(evidence.intentDigest) ||
        typeof evidence.providerAdapterContractDigest !== "string" ||
        !DIGEST.test(evidence.providerAdapterContractDigest)) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        effectGeneration: evidence.effectGeneration as number,
        intentDigest: evidence.intentDigest,
        providerAdapterContractDigest: evidence.providerAdapterContractDigest,
      } };
    case "effect.contact_started":
      if (!exactKeys(evidence, ["effectKey", "effectGeneration", "intentDigest",
        "providerAdapterContractDigest", "readinessEvidenceDigest"]) ||
        !safeRef(evidence.effectKey) ||
        !Number.isSafeInteger(evidence.effectGeneration) || Number(evidence.effectGeneration) < 1 ||
        typeof evidence.intentDigest !== "string" || !DIGEST.test(evidence.intentDigest) ||
        typeof evidence.providerAdapterContractDigest !== "string" ||
        !DIGEST.test(evidence.providerAdapterContractDigest) ||
        typeof evidence.readinessEvidenceDigest !== "string" ||
        !DIGEST.test(evidence.readinessEvidenceDigest)) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        effectGeneration: evidence.effectGeneration as number,
        intentDigest: evidence.intentDigest,
        providerAdapterContractDigest: evidence.providerAdapterContractDigest,
        readinessEvidenceDigest: evidence.readinessEvidenceDigest,
      } };
    case "delivery.cancellation_requested":
      if (!exactKeys(evidence, ["cancellationId", "actorKind", "effectDisposition"]) ||
        typeof evidence.cancellationId !== "string" || !ID.test(evidence.cancellationId) ||
        (evidence.actorKind !== "agent" && evidence.actorKind !== "human") ||
        !["not_created", "contact_started", "provider_accepted", "terminal"]
          .includes(String(evidence.effectDisposition))) return null;
      return { ...base, type: row.type, evidence: {
        cancellationId: evidence.cancellationId,
        actorKind: evidence.actorKind,
        effectDisposition: evidence.effectDisposition as
          | "not_created" | "contact_started" | "provider_accepted" | "terminal",
      } };
    case "delivery.cancelled":
      if (!exactKeys(evidence, ["cancellationId", "effectKey", "effectDisposition"]) ||
        typeof evidence.cancellationId !== "string" || !ID.test(evidence.cancellationId) ||
        !safeRef(evidence.effectKey) || evidence.effectDisposition !== "not_created") return null;
      return { ...base, type: row.type, evidence: {
        cancellationId: evidence.cancellationId,
        effectKey: evidence.effectKey,
        effectDisposition: "not_created",
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
      if (!exactKeys(evidence, [
        "effectKey", "providerOperationRef", "evidenceDigest", "failureCode",
      ]) || !safeRef(evidence.effectKey) || typeof evidence.evidenceDigest !== "string" ||
        !DIGEST.test(evidence.evidenceDigest) ||
        (evidence.providerOperationRef !== null && !safeRef(evidence.providerOperationRef)) ||
        (!safeRef(evidence.providerOperationRef) || evidence.failureCode !== null)) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        providerOperationRef: evidence.providerOperationRef,
        evidenceDigest: evidence.evidenceDigest,
        failureCode: evidence.failureCode,
      } } as PublishingDeliveryEvent;
    case "publication.failed_transient":
    case "publication.failed_terminal":
      if (!exactKeys(evidence, ["effectKey", "effectGeneration", "providerOperationRef",
        "evidenceDigest", "failureCode", "failureClass", "retryable", "effectDisposition"]) ||
        !safeRef(evidence.effectKey) ||
        !Number.isSafeInteger(evidence.effectGeneration) || Number(evidence.effectGeneration) < 1 ||
        (evidence.providerOperationRef !== null && !safeRef(evidence.providerOperationRef)) ||
        typeof evidence.evidenceDigest !== "string" || !DIGEST.test(evidence.evidenceDigest) ||
        typeof evidence.failureCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,79}$/.test(evidence.failureCode) ||
        evidence.failureClass !== (row.type === "publication.failed_transient" ? "transient" : "terminal") ||
        evidence.retryable !== (row.type === "publication.failed_transient") ||
        !["not_created", "provider_failed_known"].includes(String(evidence.effectDisposition))) return null;
      return row.type === "publication.failed_transient"
        ? { ...base, type: row.type, evidence: {
            effectKey: evidence.effectKey,
            effectGeneration: evidence.effectGeneration as number,
            providerOperationRef: evidence.providerOperationRef as string | null,
            evidenceDigest: evidence.evidenceDigest,
            failureCode: evidence.failureCode,
            failureClass: "transient" as const,
            retryable: true as const,
            effectDisposition: evidence.effectDisposition as
              "not_created" | "provider_failed_known",
          } }
        : { ...base, type: row.type, evidence: {
            effectKey: evidence.effectKey,
            effectGeneration: evidence.effectGeneration as number,
            providerOperationRef: evidence.providerOperationRef as string | null,
            evidenceDigest: evidence.evidenceDigest,
            failureCode: evidence.failureCode,
            failureClass: "terminal" as const,
            retryable: false as const,
            effectDisposition: evidence.effectDisposition as
              "not_created" | "provider_failed_known",
          } };
    case "publication.outcome_unknown":
      if (!exactKeys(evidence, [
        "effectKey", "providerOperationRef", "evidenceDigest", "failureCode",
      ]) || !safeRef(evidence.effectKey) ||
        (evidence.providerOperationRef !== null && !safeRef(evidence.providerOperationRef)) ||
        typeof evidence.evidenceDigest !== "string" || !DIGEST.test(evidence.evidenceDigest) ||
        typeof evidence.failureCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,79}$/.test(evidence.failureCode)) return null;
      return { ...base, type: row.type, evidence: {
        effectKey: evidence.effectKey,
        providerOperationRef: evidence.providerOperationRef as string | null,
        evidenceDigest: evidence.evidenceDigest,
        failureCode: evidence.failureCode,
      } };
    case "delivery.retry_requested": {
      const keys = ["retryId", "sourceDeliveryId", "approvalRequestId", "approvalDecisionId",
        "sourceEffectKey", "sourceEffectGeneration", "sourceEvidenceDigest", "deliveryId",
        "effectKey"];
      if (!exactKeys(evidence, keys) || !safeRef(evidence.retryId, 200) ||
        !safeRef(evidence.sourceDeliveryId, 200) ||
        !safeRef(evidence.approvalRequestId, 200) || !safeRef(evidence.approvalDecisionId, 200) ||
        !safeRef(evidence.sourceEffectKey) || !safeRef(evidence.deliveryId, 200) ||
        !safeRef(evidence.effectKey) ||
        !Number.isSafeInteger(evidence.sourceEffectGeneration) ||
        typeof evidence.sourceEvidenceDigest !== "string" ||
        !DIGEST.test(evidence.sourceEvidenceDigest)) return null;
      return { ...base, type: row.type, evidence: evidence as
        Extract<PublishingDeliveryEvent, { type: "delivery.retry_requested" }>["evidence"] };
    }
    case "delivery.reconciliation_requested":
      if (!exactKeys(evidence, ["reconciliationId", "effectKey", "effectGeneration",
        "sourceEvidenceDigest"]) || !safeRef(evidence.reconciliationId, 200) ||
        !safeRef(evidence.effectKey) || !Number.isSafeInteger(evidence.effectGeneration) ||
        typeof evidence.sourceEvidenceDigest !== "string" ||
        !DIGEST.test(evidence.sourceEvidenceDigest)) return null;
      return { ...base, type: row.type, evidence: evidence as
        Extract<PublishingDeliveryEvent, { type: "delivery.reconciliation_requested" }>["evidence"] };
    case "delivery.reconciled":
      if (!exactKeys(evidence, ["reconciliationId", "effectKey", "effectGeneration",
        "sourceEvidenceDigest", "evidenceDigest", "resolution", "providerOperationRef",
        "failureCode", "retryable"]) || !safeRef(evidence.reconciliationId, 200) ||
        !safeRef(evidence.effectKey) || !Number.isSafeInteger(evidence.effectGeneration) ||
        typeof evidence.sourceEvidenceDigest !== "string" || !DIGEST.test(evidence.sourceEvidenceDigest) ||
        typeof evidence.evidenceDigest !== "string" || !DIGEST.test(evidence.evidenceDigest) ||
        !["succeeded", "failed_transient", "failed_terminal", "still_unknown", "operator_required"]
          .includes(String(evidence.resolution)) ||
        (evidence.providerOperationRef !== null && !safeRef(evidence.providerOperationRef)) ||
        (evidence.failureCode !== null &&
          (typeof evidence.failureCode !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/.test(evidence.failureCode))) ||
        (evidence.retryable !== null && typeof evidence.retryable !== "boolean")) return null;
      return { ...base, type: row.type, evidence: evidence as
        Extract<PublishingDeliveryEvent, { type: "delivery.reconciled" }>["evidence"] };
    default:
      return null;
  }
}

export function rehydratePublishingDeliveryOutbox(row: OutboxRow): PublishingDeliveryOutboxIntentRecord | null {
  if (!ID.test(row.id) || !ID.test(row.workspaceId) || !ID.test(row.deliveryId) ||
    row.generation < 1 || row.deliveryAttempts < 0 ||
    !["publish", "reconcile"].includes(row.purpose) ||
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
  return {
    ...row,
    purpose: row.purpose as PublishingDeliveryOutboxIntentRecord["purpose"],
    state: row.state as PublishingDeliveryOutboxIntentRecord["state"],
  };
}

export function rehydratePublishingDeliveryLease(row: LeaseRow): PublishingDeliveryExecutionLeaseRecord | null {
  if (!ID.test(row.workspaceId) || !ID.test(row.deliveryId) || row.fence <= BigInt(0) ||
    !safeRef(row.workerId, 500) || !safeRef(row.leaseToken, 200) ||
    row.expiresAt <= row.acquiredAt || row.renewedAt < row.acquiredAt ||
    (row.releasedAt !== null && row.releasedAt < row.acquiredAt)) return null;
  return { ...row };
}

export function rehydratePublishingDeliveryCancellation(
  row: CancellationRow,
): PublishingDeliveryCancellationRecord | null {
  const resources = safeResources(row.authorizedResources);
  const grants = Array.isArray(row.authorityGrants)
    ? row.authorityGrants.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value) ||
          Object.keys(value).sort().join(",") !== "channelId,grantId") return null;
        const binding = value as Record<string, unknown>;
        return typeof binding.channelId === "string" && ID.test(binding.channelId) &&
          typeof binding.grantId === "string" && ID.test(binding.grantId)
          ? { channelId: binding.channelId, grantId: binding.grantId }
          : null;
      })
    : [];
  const state = row.stateAtRequest as PublishingDeliveryRecord["state"];
  if (!resources || !ID.test(row.id) || !ID.test(row.workspaceId) ||
    !ID.test(row.deliveryId) || !ID.test(row.actorId) ||
    row.capability !== "publishing_deliveries.cancel@1" ||
    row.authorizationContractDigest !==
      publishingDeliveryCancelAuthorizationContractDigest() ||
    !safeRef(row.authorizationAdmissionEvidenceRef, 200) ||
    !safeRef(row.authorizationEvidenceRef, 200) ||
    !DIGEST.test(row.authorizationEvidenceDigest) ||
    grants.some((grant) => !grant) || new Set(
      grants.map((grant) => grant?.grantId),
    ).size !== grants.length ||
    row.authorizationIssuedAt >= row.authorizationExpiresAt ||
    row.requestedAt < row.authorizationIssuedAt ||
    row.requestedAt >= row.authorizationExpiresAt ||
    !["scheduled", "dispatching", "confirmation_pending", "succeeded", "failed_transient",
      "failed_terminal",
      "outcome_unknown", "cancelled"].includes(state) ||
    !["prevented", "conditional", "unknown", "too_late"].includes(row.outcome) ||
    row.externallyReversed !== false ||
    row.externallyCompletedAtRequest !== (
      row.outcome === "unknown" || row.outcome === "conditional"
        ? null
        : state === "succeeded"
    ) ||
    (row.outcome === "prevented" && state !== "scheduled" && state !== "dispatching") ||
    (row.outcome === "conditional" && state !== "confirmation_pending") ||
    (row.outcome === "unknown" && state !== "scheduled" &&
      state !== "dispatching" && state !== "outcome_unknown") ||
    (row.outcome === "too_late" && state !== "succeeded" &&
      state !== "failed_transient" && state !== "failed_terminal")) return null;
  const authorityGrants = grants as Array<{ channelId: string; grantId: string }>;
  const actor = row.actorKind === "agent" && row.principalId === row.actorId &&
      row.keyId && ID.test(row.keyId) && row.userId === null && authorityGrants.length === 0
    ? { kind: "agent" as const, principalId: row.actorId, keyId: row.keyId }
    : row.actorKind === "human" && row.userId === row.actorId &&
        row.principalId === null && row.keyId === null && authorityGrants.length === 1 &&
        resources.channelIds.length === 1 &&
        authorityGrants[0]?.channelId === resources.channelIds[0]
      ? { kind: "human" as const, userId: row.actorId }
      : null;
  if (!actor) return null;
  const ttlMs = actor.kind === "agent"
    ? CANCELLATION_AGENT_AUTHORIZATION_TTL_MS
    : CANCELLATION_HUMAN_AUTHORIZATION_TTL_MS;
  if (row.authorizationExpiresAt.getTime() - row.authorizationIssuedAt.getTime() > ttlMs) {
    return null;
  }
  if (actor.kind === "agent") {
    if (row.authorizationEvidenceRef !== row.authorizationAdmissionEvidenceRef) return null;
  } else {
    const evidenceSeed = canonicalDigest({
      schema: "publishing-delivery-cancellation-human-grant-evidence/v1",
      workspaceId: row.workspaceId,
      actor,
      resources,
      humanGrants: authorityGrants,
      issuedAt: row.authorizationIssuedAt.toISOString(),
      expiresAt: row.authorizationExpiresAt.toISOString(),
    });
    if (row.authorizationEvidenceRef !==
      `pdcae_${evidenceSeed.slice("sha256:".length)}`) return null;
  }
  const expectedEvidenceDigest = cancellationAuthorityDigest({
    workspaceId: row.workspaceId,
    actor,
    capability: "publishing_deliveries.cancel@1",
    contractDigest: row.authorizationContractDigest,
    admissionEvidenceRef: row.authorizationAdmissionEvidenceRef,
    evidenceRef: row.authorizationEvidenceRef,
    resources,
    humanGrants: authorityGrants,
    issuedAt: row.authorizationIssuedAt,
    expiresAt: row.authorizationExpiresAt,
  });
  if (row.authorizationEvidenceDigest !== expectedEvidenceDigest ||
    row.authorizationSessionId !==
      `pdcas_${expectedEvidenceDigest.slice("sha256:".length)}`) return null;
  return {
    schema: "publishing-delivery-cancellation-record/v1",
    id: row.id,
    workspaceId: row.workspaceId,
    deliveryId: row.deliveryId,
    actor,
    capability: "publishing_deliveries.cancel@1",
    authorizationContractDigest: row.authorizationContractDigest,
    authorizationAdmissionEvidenceRef: row.authorizationAdmissionEvidenceRef,
    authorizationEvidenceRef: row.authorizationEvidenceRef,
    authorizationEvidenceDigest: row.authorizationEvidenceDigest,
    authorizedResources: resources,
    authorityGrants,
    stateAtRequest: state,
    outcome: row.outcome as PublishingDeliveryCancellationRecord["outcome"],
    externallyCompletedAtRequest: row.externallyCompletedAtRequest,
    requestedAt: row.requestedAt,
  };
}

function recoveryAuthorizationFromRow(row: {
  workspaceId: string;
  actorKind: string;
  actorId: string;
  principalId: string | null;
  keyId: string | null;
  userId: string | null;
  capability: string;
  authorizationSessionId: string;
  authorizationContractDigest: string;
  authorizationAdmissionEvidenceRef: string;
  authorizationEvidenceRef: string;
  authorizationEvidenceDigest: string;
  authorizedResources: unknown;
  authorityGrants: unknown;
  authorizationIssuedAt: Date;
  authorizationExpiresAt: Date;
}): PublishingDeliveryRecoveryAuthorizationSession | null {
  const resources = safeResources(row.authorizedResources);
  const grants = Array.isArray(row.authorityGrants)
    ? row.authorityGrants.filter((item): item is { channelId: string; grantId: string } =>
        Boolean(item && typeof item === "object" && !Array.isArray(item) &&
          safeRef((item as { channelId?: unknown }).channelId, 200) &&
          safeRef((item as { grantId?: unknown }).grantId, 200)))
    : [];
  const capability = row.capability === "publishing_deliveries.retry@1" ||
      row.capability === "publishing_deliveries.reconcile@1"
    ? row.capability
    : null;
  const actor = row.actorKind === "agent" && row.principalId === row.actorId &&
      row.keyId && row.userId === null && grants.length === 0
    ? { kind: "agent" as const, principalId: row.actorId, keyId: row.keyId }
    : row.actorKind === "human" && row.userId === row.actorId &&
        row.principalId === null && row.keyId === null && grants.length === 1
      ? { kind: "human" as const, userId: row.actorId }
      : null;
  if (!resources || !capability || !actor ||
    row.authorizationContractDigest !== (capability === "publishing_deliveries.retry@1"
      ? publishingDeliveryRetryAuthorizationContractDigest()
      : publishingDeliveryReconcileAuthorizationContractDigest()) ||
    !safeRef(row.authorizationAdmissionEvidenceRef, 200) ||
    !safeRef(row.authorizationEvidenceRef, 200) ||
    !DIGEST.test(row.authorizationEvidenceDigest) ||
    row.authorizationIssuedAt >= row.authorizationExpiresAt) return null;
  const base: Omit<PublishingDeliveryRecoveryAuthorizationSession,
    "schema" | "id" | "evidenceDigest"> = {
    workspaceId: row.workspaceId,
    actor,
    capability,
    contractDigest: row.authorizationContractDigest,
    admissionEvidenceRef: row.authorizationAdmissionEvidenceRef,
    evidenceRef: row.authorizationEvidenceRef,
    resources,
    humanGrants: grants,
    issuedAt: row.authorizationIssuedAt,
    expiresAt: row.authorizationExpiresAt,
  };
  const evidenceDigest = canonicalDigest({
    schema: "publishing-delivery-recovery-authority-evidence/v1",
    ...base,
    issuedAt: base.issuedAt.toISOString(),
    expiresAt: base.expiresAt.toISOString(),
  });
  if (evidenceDigest !== row.authorizationEvidenceDigest ||
    row.authorizationSessionId !== `pdras_${evidenceDigest.slice("sha256:".length)}`) return null;
  return {
    schema: "publishing-delivery-recovery-authorization-session/v1",
    id: row.authorizationSessionId,
    ...base,
    evidenceDigest,
  };
}

function rehydrateEffectIdentity(row: EffectIdentityRow): PublishingDeliveryEffectIdentityRecord | null {
  if (!ID.test(row.workspaceId) || !ID.test(row.deliveryId) || row.generation < 1 ||
    row.effectKey !== publishingDeliveryEffectKey(row.workspaceId, row.deliveryId, row.generation) ||
    ((row.intentDigest === null) !== (row.providerAdapterContractDigest === null)) ||
    (row.intentDigest !== null && !DIGEST.test(row.intentDigest)) ||
    (row.providerAdapterContractDigest !== null &&
      !DIGEST.test(row.providerAdapterContractDigest)) ||
    (row.sourceEvidenceDigest !== null && !DIGEST.test(row.sourceEvidenceDigest))) return null;
  return {
    schema: "publishing-delivery-effect-identity/v1",
    workspaceId: row.workspaceId,
    deliveryId: row.deliveryId,
    generation: row.generation,
    effectKey: row.effectKey,
    intentDigest: row.intentDigest,
    providerAdapterContractDigest: row.providerAdapterContractDigest,
    parentEffectKey: row.parentEffectKey,
    parentGeneration: row.parentGeneration,
    derivation: row.derivation as PublishingDeliveryEffectIdentityRecord["derivation"],
    sourceEvidenceDigest: row.sourceEvidenceDigest,
    createdAt: row.createdAt,
  };
}

function rehydrateRetry(row: RetryRow): PublishingDeliveryRetryRecord | null {
  const authorization = recoveryAuthorizationFromRow(row);
  if (!authorization || row.capability !== "publishing_deliveries.retry@1" ||
    !DIGEST.test(row.sourceEvidenceDigest) || row.sourceEffectGeneration < 1 ||
    (row.sourceIntentDigest !== null && !DIGEST.test(row.sourceIntentDigest)) ||
    (row.sourceProviderAdapterContractDigest !== null &&
      !DIGEST.test(row.sourceProviderAdapterContractDigest)) ||
    (row.sourceIntentDigest === null) !==
      (row.sourceProviderAdapterContractDigest === null) ||
    (row.sourceFailureClass !== "transient" && row.sourceFailureClass !== "terminal") ||
    !["not_created", "provider_failed_known"].includes(row.sourceEffectDisposition)) return null;
  return {
    schema: "publishing-delivery-retry-record/v1",
    id: row.id,
    workspaceId: row.workspaceId,
    sourceDeliveryId: row.sourceDeliveryId,
    deliveryId: row.deliveryId,
    actor: authorization.actor,
    sourceEffectKey: row.sourceEffectKey,
    sourceEffectGeneration: row.sourceEffectGeneration,
    sourceIntentDigest: row.sourceIntentDigest,
    sourceProviderAdapterContractDigest: row.sourceProviderAdapterContractDigest,
    sourceEvidenceDigest: row.sourceEvidenceDigest,
    sourceFailureClass: row.sourceFailureClass,
    sourceEffectDisposition: row.sourceEffectDisposition as "not_created" | "provider_failed_known",
    approvalRequestId: row.approvalRequestId,
    approvalDecisionId: row.approvalDecisionId,
    authorization,
    requestedAt: row.requestedAt,
  };
}

function rehydrateRetryMutationReceipt(
  row: RetryRow,
): PublishingDeliveryRetryMutationReceiptRecord | null {
  if (row.capability !== "publishing_deliveries.retry@1" ||
    row.idempotencyKey.length < 8 || row.idempotencyKey.length > 200 ||
    !/^[!-~]+$/.test(row.idempotencyKey) || !DIGEST.test(row.requestFingerprint)) return null;
  return {
    schema: "publishing-delivery-retry-mutation-receipt/v1",
    workspaceId: row.workspaceId,
    actorKind: row.actorKind as "agent" | "human",
    actorId: row.actorId,
    capability: "publishing_deliveries.retry@1",
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    retryId: row.id,
    sourceDeliveryId: row.sourceDeliveryId,
    deliveryId: row.deliveryId,
    createdAt: row.requestedAt,
  };
}

function rehydrateReconciliationRequest(
  row: ReconciliationRequestRow,
): PublishingDeliveryReconciliationRequestRecord | null {
  const authorization = recoveryAuthorizationFromRow(row);
  if (!authorization || row.capability !== "publishing_deliveries.reconcile@1" ||
    !DIGEST.test(row.sourceEvidenceDigest) || row.effectGeneration < 1 ||
    !DIGEST.test(row.intentDigest) || !DIGEST.test(row.providerAdapterContractDigest) ||
    (row.providerOperationRef !== null && !safeRef(row.providerOperationRef))) return null;
  return {
    schema: "publishing-delivery-reconciliation-request/v1",
    id: row.id,
    workspaceId: row.workspaceId,
    deliveryId: row.deliveryId,
    actor: authorization.actor,
    sourceEffectKey: row.effectKey,
    sourceEffectGeneration: row.effectGeneration,
    sourceIntentDigest: row.intentDigest,
    sourceProviderAdapterContractDigest: row.providerAdapterContractDigest,
    sourceProviderOperationRef: row.providerOperationRef,
    sourceEvidenceDigest: row.sourceEvidenceDigest,
    authorization,
    requestedAt: row.requestedAt,
  };
}

function rehydrateReconciliationResult(
  row: ReconciliationResultRow,
): PublishingDeliveryReconciliationResultRecord | null {
  if (!ID.test(row.id) || !DIGEST.test(row.sourceEvidenceDigest) ||
    !DIGEST.test(row.resultEvidenceDigest) || row.effectGeneration < 1) return null;
  const common = {
    providerOperationRef: row.providerOperationRef,
    evidenceDigest: row.resultEvidenceDigest,
  };
  const resolution: PublishingDeliveryReconciliationResolution | null =
    row.outcome === "succeeded" && row.providerOperationRef
      ? { kind: "succeeded", providerOperationRef: row.providerOperationRef,
          evidenceDigest: row.resultEvidenceDigest }
      : row.outcome === "failed_known" && row.failureClass && row.failureRetryable !== null &&
          row.failureCode
        ? { kind: "failed_known", ...common, failureCode: row.failureCode,
            failureClass: row.failureClass as "transient" | "terminal",
            retryable: row.failureRetryable,
            effectDisposition: row.effectDisposition as "not_created" | "provider_failed_known" }
        : row.outcome === "still_unknown" && row.failureCode
          ? { kind: "still_unknown", ...common, failureCode: row.failureCode }
          : row.outcome === "operator_required" && row.failureCode
            ? { kind: "operator_required", ...common, failureCode: row.failureCode }
            : null;
  return resolution ? {
    schema: "publishing-delivery-reconciliation-result/v1",
    id: row.id,
    workspaceId: row.workspaceId,
    deliveryId: row.deliveryId,
    reconciliationId: row.reconciliationId,
    sourceEvidenceDigest: row.sourceEvidenceDigest,
    effectKey: row.effectKey,
    effectGeneration: row.effectGeneration,
    resolution,
    completedAt: row.reconciledAt,
  } : null;
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
      delivery.releaseId !== release.id || delivery.sourceDeliveryId !== null ||
      delivery.retryId !== null || delivery.planId !== release.planId ||
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
        origin: "release",
        releaseId: release.id,
        sourceDeliveryId: null,
        retryId: null,
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
  if (!approval.decision || !validRetainedExecutionAdmissionProvenance({
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    executionAt: at,
  }) || !validPublishingDeliveryAuthorizationSession({
    session,
    workspaceId: approval.workspaceId,
    principalId: session.principalId,
    keyId: session.keyId,
    capability: "publishing_plan_revisions.release@1",
    authorizationContractDigest: publishingApprovalReleaseAuthorizationContractDigest(),
    authorizationEvidenceRef: session.evidenceRef,
    channelIds: approval.channelIds,
    artifactIds: approval.artifactIds,
    // The release session is immutable admission provenance. Its bounded
    // window must have covered release consumption, but scheduled execution
    // can occur later and is authorized from current grants below.
    now: session.issuedAt,
  })) return false;
  const rows = await tx.select({
    decision: agentAuthorizationDecisions,
    principalStatus: agentPrincipals.status,
    principalRevokedAt: agentPrincipals.revokedAt,
    key: agentKeys,
    grantSet: agentGrantSets,
    grantRevision: agentGrantRevisions,
    policy: workspaceAgentPolicies,
    policyRevision: workspaceAgentPolicyRevisions,
  }).from(agentAuthorizationDecisions)
    .innerJoin(agentPrincipals, and(
      eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId),
      eq(agentPrincipals.id, agentAuthorizationDecisions.principalId),
    )).innerJoin(agentKeys, and(
      eq(agentKeys.principalId, agentAuthorizationDecisions.principalId),
      eq(agentKeys.id, agentAuthorizationDecisions.keyId),
    )).innerJoin(agentGrantSets, and(
      eq(agentGrantSets.workspaceId, agentAuthorizationDecisions.workspaceId),
      eq(agentGrantSets.principalId, agentAuthorizationDecisions.principalId),
    )).innerJoin(agentGrantRevisions, and(
      eq(agentGrantRevisions.grantSetId, agentGrantSets.id),
      eq(agentGrantRevisions.revision, agentGrantSets.activeRevision),
    )).innerJoin(workspaceAgentPolicies,
      eq(workspaceAgentPolicies.workspaceId, agentAuthorizationDecisions.workspaceId),
    ).innerJoin(workspaceAgentPolicyRevisions, and(
      eq(workspaceAgentPolicyRevisions.workspaceId, workspaceAgentPolicies.workspaceId),
      eq(workspaceAgentPolicyRevisions.id, workspaceAgentPolicies.activeRevisionId),
      eq(workspaceAgentPolicyRevisions.revision, workspaceAgentPolicies.revision),
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
    row.key.revokedAt || (row.key.expiresAt && row.key.expiresAt <= at) ||
    row.grantSet.disabledAt !== null || !row.policy.enabled ||
    !row.policyRevision.enabled ||
    row.decision.createdAt.getTime() !== session.issuedAt.getTime() ||
    session.expiresAt.getTime() !== Math.min(
      session.issuedAt.getTime() + RELEASE_AUTHORIZATION_TTL_MS,
      row.key.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
    )) return false;
  const channels = row.decision.resources.filter((resource) => resource.kind === "channel")
    .map((resource) => resource.id);
  const artifacts = row.decision.resources.filter((resource) => resource.kind === "artifact")
    .map((resource) => resource.id);
  const grantInput = {
    capability: session.capability,
    contractDigest: session.contractDigest,
    channelIds: approval.channelIds,
    artifactIds: approval.artifactIds,
  };
  return approval.channelIds.length > 0 &&
    row.decision.resources.length === channels.length + artifacts.length &&
    sameSet(channels, approval.channelIds) && sameSet(artifacts, approval.artifactIds) &&
    sameSet(session.resources.channelIds, approval.channelIds) &&
    sameSet(session.resources.artifactIds, approval.artifactIds) &&
    exactExecutionGrant(row.key.authorizationScopes, grantInput) &&
    exactExecutionGrant(row.grantRevision.grants, grantInput) &&
    exactExecutionGrant(row.policyRevision.grants, grantInput);
}

function cancellationAuthorityDigest(input: {
  workspaceId: string;
  actor: PublishingDeliveryCancellationAuthorizationSession["actor"];
  capability: "publishing_deliveries.cancel@1";
  contractDigest: string;
  admissionEvidenceRef: string;
  evidenceRef: string;
  resources: { channelIds: string[]; artifactIds: string[] };
  humanGrants: Array<{ channelId: string; grantId: string }>;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return canonicalDigest({
    schema: "publishing-delivery-cancellation-authority-evidence/v1",
    workspaceId: input.workspaceId,
    actor: input.actor,
    capability: input.capability,
    contractDigest: input.contractDigest,
    admissionEvidenceRef: input.admissionEvidenceRef,
    evidenceRef: input.evidenceRef,
    resources: input.resources,
    humanGrants: input.humanGrants,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  });
}

function recoveryAuthorityDigest(input: Omit<
  PublishingDeliveryRecoveryAuthorizationSession,
  "schema" | "id" | "evidenceDigest"
>): string {
  return canonicalDigest({
    schema: "publishing-delivery-recovery-authority-evidence/v1",
    ...input,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  });
}

function validCancellationSessionShape(input: {
  session: PublishingDeliveryCancellationAuthorizationSession;
  workspaceId: string;
  channelId: string;
  artifactIds: string[];
  at: Date;
}): boolean {
  const { session } = input;
  return session.schema ===
      "publishing-delivery-cancellation-authorization-session/v1" &&
    session.workspaceId === input.workspaceId &&
    session.capability === "publishing_deliveries.cancel@1" &&
    session.contractDigest === publishingDeliveryCancelAuthorizationContractDigest() &&
    safeRef(session.admissionEvidenceRef, 200) && safeRef(session.evidenceRef, 200) &&
    DIGEST.test(session.evidenceDigest) && session.issuedAt <= input.at &&
    session.expiresAt > input.at &&
    sameOrder(session.resources.channelIds, [input.channelId]) &&
    sameSet(session.resources.artifactIds, input.artifactIds) &&
    cancellationAuthorityDigest(session) === session.evidenceDigest &&
    (session.actor.kind === "agent"
      ? session.humanGrants.length === 0
      : session.humanGrants.length === 1 &&
        session.humanGrants[0]?.channelId === input.channelId);
}

async function lockCancellationAuthorization(
  tx: Tx,
  session: PublishingDeliveryCancellationAuthorizationSession,
  delivery: PublishingDeliveryRecord,
  at: Date,
): Promise<boolean> {
  if (!validCancellationSessionShape({
    session,
    workspaceId: delivery.workspaceId,
    channelId: delivery.channelId,
    artifactIds: delivery.artifactIds,
    at,
  })) return false;
  if (session.actor.kind === "agent") {
    const rows = await tx.select({
      decision: agentAuthorizationDecisions,
      principalStatus: agentPrincipals.status,
      principalRevokedAt: agentPrincipals.revokedAt,
      keyRevokedAt: agentKeys.revokedAt,
      keyExpiresAt: agentKeys.expiresAt,
    }).from(agentAuthorizationDecisions).innerJoin(agentPrincipals, and(
      eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId),
      eq(agentPrincipals.id, agentAuthorizationDecisions.principalId),
    )).innerJoin(agentKeys, and(
      eq(agentKeys.principalId, agentAuthorizationDecisions.principalId),
      eq(agentKeys.id, agentAuthorizationDecisions.keyId),
    )).where(and(
      eq(agentAuthorizationDecisions.workspaceId, session.workspaceId),
      eq(agentAuthorizationDecisions.principalId, session.actor.principalId),
      eq(agentAuthorizationDecisions.keyId, session.actor.keyId),
      eq(agentAuthorizationDecisions.operatorTraceRef, session.evidenceRef),
      eq(agentAuthorizationDecisions.capabilityName, "publishing_deliveries.cancel"),
      eq(agentAuthorizationDecisions.capabilityVersion, 1),
      eq(agentAuthorizationDecisions.authorizationContractDigest, session.contractDigest),
      eq(agentAuthorizationDecisions.outcome, "allowed"),
    )).limit(1).for("share");
    const row = rows[0];
    if (!row || row.principalStatus !== "active" || row.principalRevokedAt ||
      row.keyRevokedAt || (row.keyExpiresAt && row.keyExpiresAt <= at) ||
      row.decision.createdAt.getTime() !== session.issuedAt.getTime() ||
      session.expiresAt.getTime() !== Math.min(
        session.issuedAt.getTime() + CANCELLATION_AGENT_AUTHORIZATION_TTL_MS,
        row.keyExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
      )) return false;
    const channelIds = row.decision.resources.filter((item) => item.kind === "channel")
      .map((item) => item.id);
    const artifactIds = row.decision.resources.filter((item) => item.kind === "artifact")
      .map((item) => item.id);
    return row.decision.resources.length === channelIds.length + artifactIds.length &&
      sameOrder(channelIds, [delivery.channelId]) && sameSet(artifactIds, delivery.artifactIds);
  }
  const admissionRows = await tx.select({
    id: agentSecurityEvents.id,
    reason: agentSecurityEvents.reason,
    resourceKinds: agentSecurityEvents.resourceKinds,
  })
    .from(agentSecurityEvents).where(and(
      eq(agentSecurityEvents.workspaceId, session.workspaceId),
      eq(agentSecurityEvents.actorUserId, session.actor.userId),
      eq(agentSecurityEvents.eventType, "authorization.allowed"),
      eq(agentSecurityEvents.capabilityName, "publishing_deliveries.cancel"),
      eq(agentSecurityEvents.capabilityVersion, 1),
      eq(agentSecurityEvents.changeRef, session.admissionEvidenceRef),
    )).limit(1).for("share");
  if (!admissionRows[0] || admissionRows[0].reason !== "allowed" ||
    !sameSet(admissionRows[0].resourceKinds, ["channel", "artifact"])) return false;
  const grantIds = session.humanGrants.map((grant) => grant.grantId);
  const grants = await tx.select({
    grant: runtimePublishingApprovalAuthorityGrants,
    memberRole: workspaceMembers.role,
  }).from(runtimePublishingApprovalAuthorityGrants).innerJoin(workspaceMembers, and(
    eq(workspaceMembers.workspaceId, runtimePublishingApprovalAuthorityGrants.workspaceId),
    eq(workspaceMembers.userId, runtimePublishingApprovalAuthorityGrants.userId),
  )).where(and(
    eq(runtimePublishingApprovalAuthorityGrants.workspaceId, session.workspaceId),
    eq(runtimePublishingApprovalAuthorityGrants.userId, session.actor.userId),
    inArray(runtimePublishingApprovalAuthorityGrants.id, grantIds),
  )).orderBy(asc(runtimePublishingApprovalAuthorityGrants.id)).for("update");
  if (grants.length !== grantIds.length || grants.some(({ grant, memberRole }) =>
    (memberRole !== "owner" && memberRole !== "admin") || grant.action !== "publish" ||
    grant.channelId !== delivery.channelId || grant.issuedAt > at ||
    (grant.expiresAt !== null && grant.expiresAt <= at))) return false;
  const exactExpiry = Math.min(
    session.issuedAt.getTime() + CANCELLATION_HUMAN_AUTHORIZATION_TTL_MS,
    ...grants.map(({ grant }) =>
      grant.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY),
  );
  const evidenceSeed = canonicalDigest({
    schema: "publishing-delivery-cancellation-human-grant-evidence/v1",
    workspaceId: session.workspaceId,
    actor: session.actor,
    resources: session.resources,
    humanGrants: session.humanGrants,
    issuedAt: session.issuedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  });
  if (session.expiresAt.getTime() !== exactExpiry ||
    session.evidenceRef !== `pdcae_${evidenceSeed.slice("sha256:".length)}`) return false;
  const revoked = await tx.select({ id: runtimePublishingApprovalAuthorityRevocations.grantId })
    .from(runtimePublishingApprovalAuthorityRevocations).where(and(
      eq(runtimePublishingApprovalAuthorityRevocations.workspaceId, session.workspaceId),
      inArray(runtimePublishingApprovalAuthorityRevocations.grantId, grantIds),
    ));
  return revoked.length === 0;
}

async function lockRecoveryAuthorization(
  tx: Tx,
  session: PublishingDeliveryRecoveryAuthorizationSession,
  delivery: PublishingDeliveryRecord,
  at: Date,
): Promise<boolean> {
  const expectedContract = session.capability === "publishing_deliveries.retry@1"
    ? publishingDeliveryRetryAuthorizationContractDigest()
    : publishingDeliveryReconcileAuthorizationContractDigest();
  const base = {
    workspaceId: session.workspaceId,
    actor: session.actor,
    capability: session.capability,
    contractDigest: session.contractDigest,
    admissionEvidenceRef: session.admissionEvidenceRef,
    evidenceRef: session.evidenceRef,
    resources: session.resources,
    humanGrants: session.humanGrants,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
  };
  if (session.schema !== "publishing-delivery-recovery-authorization-session/v1" ||
    session.workspaceId !== delivery.workspaceId || session.contractDigest !== expectedContract ||
    session.id !== `pdras_${session.evidenceDigest.slice("sha256:".length)}` ||
    recoveryAuthorityDigest(base) !== session.evidenceDigest ||
    !sameOrder(session.resources.channelIds, [delivery.channelId]) ||
    !sameSet(session.resources.artifactIds, delivery.artifactIds) ||
    !validRetainedExecutionAdmissionProvenance({
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      executionAt: at,
    })) return false;
  const capabilityName = session.capability.slice(0, -2);
  if (session.actor.kind === "agent") {
    if (session.humanGrants.length !== 0 || session.evidenceRef !== session.admissionEvidenceRef) {
      return false;
    }
    const rows = await tx.select({
      decision: agentAuthorizationDecisions,
      principalStatus: agentPrincipals.status,
      principalRevokedAt: agentPrincipals.revokedAt,
      key: agentKeys,
      grantSet: agentGrantSets,
      grantRevision: agentGrantRevisions,
      policy: workspaceAgentPolicies,
      policyRevision: workspaceAgentPolicyRevisions,
    }).from(agentAuthorizationDecisions).innerJoin(agentPrincipals, and(
      eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId),
      eq(agentPrincipals.id, agentAuthorizationDecisions.principalId),
    )).innerJoin(agentKeys, and(
      eq(agentKeys.principalId, agentAuthorizationDecisions.principalId),
      eq(agentKeys.id, agentAuthorizationDecisions.keyId),
    )).innerJoin(agentGrantSets, and(
      eq(agentGrantSets.workspaceId, agentAuthorizationDecisions.workspaceId),
      eq(agentGrantSets.principalId, agentAuthorizationDecisions.principalId),
    )).innerJoin(agentGrantRevisions, and(
      eq(agentGrantRevisions.grantSetId, agentGrantSets.id),
      eq(agentGrantRevisions.revision, agentGrantSets.activeRevision),
    )).innerJoin(workspaceAgentPolicies,
      eq(workspaceAgentPolicies.workspaceId, agentAuthorizationDecisions.workspaceId),
    ).innerJoin(workspaceAgentPolicyRevisions, and(
      eq(workspaceAgentPolicyRevisions.workspaceId, workspaceAgentPolicies.workspaceId),
      eq(workspaceAgentPolicyRevisions.id, workspaceAgentPolicies.activeRevisionId),
      eq(workspaceAgentPolicyRevisions.revision, workspaceAgentPolicies.revision),
    )).where(and(
      eq(agentAuthorizationDecisions.workspaceId, session.workspaceId),
      eq(agentAuthorizationDecisions.principalId, session.actor.principalId),
      eq(agentAuthorizationDecisions.keyId, session.actor.keyId),
      eq(agentAuthorizationDecisions.operatorTraceRef, session.evidenceRef),
      eq(agentAuthorizationDecisions.capabilityName, capabilityName),
      eq(agentAuthorizationDecisions.capabilityVersion, 1),
      eq(agentAuthorizationDecisions.authorizationContractDigest, session.contractDigest),
      eq(agentAuthorizationDecisions.outcome, "allowed"),
    )).limit(1).for("share");
    const row = rows[0];
    if (!row || row.principalStatus !== "active" || row.principalRevokedAt ||
      row.key.revokedAt || (row.key.expiresAt && row.key.expiresAt <= at) ||
      row.grantSet.disabledAt !== null || !row.policy.enabled ||
      !row.policyRevision.enabled ||
      row.decision.createdAt.getTime() !== session.issuedAt.getTime() ||
      session.expiresAt.getTime() !== Math.min(
        session.issuedAt.getTime() + CANCELLATION_AGENT_AUTHORIZATION_TTL_MS,
        row.key.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
      )) return false;
    const channelIds = row.decision.resources.filter((item) => item.kind === "channel")
      .map((item) => item.id);
    const artifactIds = row.decision.resources.filter((item) => item.kind === "artifact")
      .map((item) => item.id);
    const recoveryGrantInput = {
      capability: session.capability,
      contractDigest: session.contractDigest,
      channelIds: [delivery.channelId],
      artifactIds: delivery.artifactIds,
    };
    return row.decision.resources.length === channelIds.length + artifactIds.length &&
      sameOrder(channelIds, [delivery.channelId]) && sameSet(artifactIds, delivery.artifactIds) &&
      exactExecutionGrant(row.key.authorizationScopes, recoveryGrantInput) &&
      exactExecutionGrant(row.grantRevision.grants, recoveryGrantInput) &&
      exactExecutionGrant(row.policyRevision.grants, recoveryGrantInput);
  }
  if (session.humanGrants.length !== 1) return false;
  const admission = await tx.select({ event: agentSecurityEvents }).from(agentSecurityEvents)
    .where(and(
      eq(agentSecurityEvents.workspaceId, session.workspaceId),
      eq(agentSecurityEvents.actorUserId, session.actor.userId),
      eq(agentSecurityEvents.eventType, "authorization.allowed"),
      eq(agentSecurityEvents.capabilityName, capabilityName),
      eq(agentSecurityEvents.capabilityVersion, 1),
      eq(agentSecurityEvents.changeRef, session.admissionEvidenceRef),
    )).limit(1).for("share");
  if (!admission[0] || admission[0].event.reason !== "allowed" ||
    !sameSet(admission[0].event.resourceKinds, ["channel", "artifact"])) return false;
  const grant = session.humanGrants[0]!;
  const rows = await tx.select({
    grant: runtimePublishingApprovalAuthorityGrants,
    memberRole: workspaceMembers.role,
  }).from(runtimePublishingApprovalAuthorityGrants).innerJoin(workspaceMembers, and(
    eq(workspaceMembers.workspaceId, runtimePublishingApprovalAuthorityGrants.workspaceId),
    eq(workspaceMembers.userId, runtimePublishingApprovalAuthorityGrants.userId),
  )).where(and(
    eq(runtimePublishingApprovalAuthorityGrants.workspaceId, session.workspaceId),
    eq(runtimePublishingApprovalAuthorityGrants.id, grant.grantId),
    eq(runtimePublishingApprovalAuthorityGrants.userId, session.actor.userId),
  )).limit(1).for("update");
  const row = rows[0];
  if (!row || (row.memberRole !== "owner" && row.memberRole !== "admin") ||
    row.grant.action !== "publish" || row.grant.channelId !== delivery.channelId ||
    row.grant.issuedAt > at || (row.grant.expiresAt && row.grant.expiresAt <= at)) return false;
  const revoked = await tx.select({ id: runtimePublishingApprovalAuthorityRevocations.grantId })
    .from(runtimePublishingApprovalAuthorityRevocations).where(and(
      eq(runtimePublishingApprovalAuthorityRevocations.workspaceId, session.workspaceId),
      eq(runtimePublishingApprovalAuthorityRevocations.grantId, grant.grantId),
    )).limit(1).for("share");
  if (revoked[0]) return false;
  const exactExpiry = Math.min(
    session.issuedAt.getTime() + CANCELLATION_HUMAN_AUTHORIZATION_TTL_MS,
    row.grant.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  const evidenceSeed = canonicalDigest({
    schema: "publishing-delivery-recovery-human-grant-evidence/v1",
    workspaceId: session.workspaceId,
    actor: session.actor,
    capability: session.capability,
    resources: session.resources,
    humanGrants: session.humanGrants,
    issuedAt: session.issuedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  });
  return session.expiresAt.getTime() === exactExpiry &&
    session.evidenceRef === `pdrae_${evidenceSeed.slice("sha256:".length)}`;
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

const READINESS_TTL_MS = 10_000;

export function publishingDeliveryReadinessDeadline(evaluatedAt: Date): Date {
  return new Date(evaluatedAt.getTime() + READINESS_TTL_MS);
}

export function exactExecutionGrant(
  grants: Array<{
    capability: string;
    authorizationContractDigest: string;
    resources: {
      channelIds: string[];
      credentialProfileIds: string[];
      workflowIds: string[];
      automationIds: string[];
      artifactIds?: string[];
    };
  }>,
  input: { capability: string; contractDigest: string; channelIds: string[]; artifactIds: string[] },
): boolean {
  return grants.some((grant) => grant.capability === input.capability &&
    grant.authorizationContractDigest === input.contractDigest &&
    covers(grant.resources.channelIds, input.channelIds) &&
    covers(grant.resources.artifactIds ?? [], input.artifactIds) &&
    grant.resources.credentialProfileIds.length === 0 &&
    grant.resources.workflowIds.length === 0 &&
    grant.resources.automationIds.length === 0);
}

export function normalizePublishingDeliveryConfirmationCap(input: {
  deliveryState: PublishingDeliveryRecord["state"];
  confirmationAttempts: number;
  deliveryId: string;
  effectKey: string;
  effectGeneration: number;
  providerOperationRef: string;
  sourceEvidenceDigest: string;
}): null | {
  kind: "outcome_unknown";
  providerOperationRef: string;
  evidenceDigest: string;
  failureCode: "CONFIRMATION_ATTEMPTS_EXHAUSTED";
  confirmationAttempts: 3;
} {
  const exhausted = input.deliveryState === "confirmation_pending" &&
    input.confirmationAttempts >= 2;
  if (!exhausted) return null;
  return {
    kind: "outcome_unknown",
    providerOperationRef: input.providerOperationRef,
    evidenceDigest: canonicalDigest({
      schema: "publishing-delivery-confirmation-exhausted/v1",
      deliveryId: input.deliveryId,
      effectKey: input.effectKey,
      effectGeneration: input.effectGeneration,
      providerOperationRef: input.providerOperationRef,
      sourceEvidenceDigest: input.sourceEvidenceDigest,
      confirmationAttempts: 3,
    }),
    failureCode: "CONFIRMATION_ATTEMPTS_EXHAUSTED",
    confirmationAttempts: 3,
  };
}

async function evaluateExecutionReadiness(
  tx: Tx,
  input: Parameters<PublishingDeliveryExecutionReadinessPort["checkCurrent"]>[0],
): Promise<Awaited<ReturnType<PublishingDeliveryExecutionReadinessPort["checkCurrent"]>>> {
  const now = await databaseNow(tx);
  if (!now) return { kind: "unavailable" };
  const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
    eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
    eq(runtimePublishingDeliveries.id, input.deliveryId),
  )).limit(1).for("share");
  const delivery = deliveryRows[0] ? rehydratePublishingDelivery(deliveryRows[0]) : null;
  if (!delivery || delivery.desiredState !== "publish" ||
    delivery.effectKey !== input.effectKey || delivery.effectGeneration !== input.effectGeneration ||
    delivery.intentDigest !== input.intentDigest ||
    delivery.providerAdapterContractDigest !== input.providerAdapterContractDigest) {
    return { kind: "unavailable" };
  }
  let expectedNormalConsumption = false;
  let releaseContext: ReleaseRow | null = null;
  let retryAuthorization: PublishingDeliveryRecoveryAuthorizationSession | null = null;
  let retrySource: PublishingDeliveryRecord | null = null;
  if (delivery.releaseId !== null) {
    const releases = await tx.select().from(runtimePublishingDeliveryReleases).where(and(
      eq(runtimePublishingDeliveryReleases.workspaceId, delivery.workspaceId),
      eq(runtimePublishingDeliveryReleases.id, delivery.releaseId),
    )).limit(1).for("share");
    const release = releases[0];
    if (!release || release.approvalRequestId !== delivery.approvalRequestId ||
      release.approvalDecisionId !== delivery.approvalDecisionId) {
      return { kind: "unavailable" };
    }
    releaseContext = release;
    expectedNormalConsumption = true;
  } else {
    const retryContexts = await tx.select({
      consumption: runtimePublishingDeliveryRetryApprovalConsumptions,
      retry: runtimePublishingDeliveryRetryReceipts,
    }).from(runtimePublishingDeliveryRetryApprovalConsumptions)
      .innerJoin(runtimePublishingDeliveryRetryReceipts, and(
        eq(runtimePublishingDeliveryRetryReceipts.workspaceId,
          runtimePublishingDeliveryRetryApprovalConsumptions.workspaceId),
        eq(runtimePublishingDeliveryRetryReceipts.deliveryId,
          runtimePublishingDeliveryRetryApprovalConsumptions.deliveryId),
        eq(runtimePublishingDeliveryRetryReceipts.approvalConsumptionId,
          runtimePublishingDeliveryRetryApprovalConsumptions.id),
      )).where(and(
        eq(runtimePublishingDeliveryRetryApprovalConsumptions.workspaceId,
          delivery.workspaceId),
        eq(runtimePublishingDeliveryRetryApprovalConsumptions.deliveryId, delivery.id),
        eq(runtimePublishingDeliveryRetryApprovalConsumptions.sourceDeliveryId,
          delivery.sourceDeliveryId!),
        eq(runtimePublishingDeliveryRetryReceipts.id, delivery.retryId!),
      )).limit(1).for("share");
    const retryContext = retryContexts[0];
    if (!retryContext || retryContext.consumption.approvalRequestId !==
      delivery.approvalRequestId || retryContext.consumption.approvalDecisionId !==
      delivery.approvalDecisionId) return { kind: "unavailable" };
    if (retryContext.consumption.requestingPrincipalId !==
      delivery.requestingPrincipalId || retryContext.consumption.requestingKeyId !==
      delivery.requestingKeyId) return { kind: "unavailable" };
    const retry = rehydrateRetry(retryContext.retry);
    const sourceRows = await tx.select().from(runtimePublishingDeliveries).where(and(
      eq(runtimePublishingDeliveries.workspaceId, delivery.workspaceId),
      eq(runtimePublishingDeliveries.id, delivery.sourceDeliveryId!),
    )).limit(1).for("share");
    retrySource = sourceRows[0] ? rehydratePublishingDelivery(sourceRows[0]) : null;
    if (!retry || !retrySource || retry.deliveryId !== delivery.id ||
      retry.sourceDeliveryId !== retrySource.id) return { kind: "unavailable" };
    retryAuthorization = retry.authorization;
  }
  const approvalRequestId = delivery.approvalRequestId;
  const approvalDecisionId = delivery.approvalDecisionId;
  const approvals = await tx.select({
    request: runtimePublishingApprovalRequests,
    decision: runtimePublishingApprovalDecisions,
  }).from(runtimePublishingApprovalRequests).innerJoin(runtimePublishingApprovalDecisions, and(
    eq(runtimePublishingApprovalDecisions.workspaceId, runtimePublishingApprovalRequests.workspaceId),
    eq(runtimePublishingApprovalDecisions.requestId, runtimePublishingApprovalRequests.id),
  )).where(and(
    eq(runtimePublishingApprovalRequests.workspaceId, delivery.workspaceId),
    eq(runtimePublishingApprovalRequests.id, approvalRequestId),
    eq(runtimePublishingApprovalDecisions.id, approvalDecisionId),
  )).limit(1).for("share");
  const approval = approvals[0];
  if (!approval || approval.decision.outcome !== "approved" ||
    approval.request.requestingPrincipalId !== delivery.requestingPrincipalId ||
    approval.request.requestingKeyId !== delivery.requestingKeyId ||
    approval.request.planRevisionId !== delivery.planRevisionId ||
    approval.request.planRevisionDigest !== delivery.planRevisionDigest ||
    !approval.request.targetIds.includes(delivery.targetId) ||
    !approval.request.channelIds.includes(delivery.channelId) ||
    !sameSet(approval.request.artifactIds, delivery.artifactIds)) {
    const evidenceDigest = canonicalDigest({
      schema: "publishing-delivery-readiness-block/v1",
      deliveryId: delivery.id,
      failureCode: "APPROVAL_NO_LONGER_VALID",
      evaluatedAt: now.toISOString(),
    });
    return { kind: "blocked", failureCode: "APPROVAL_NO_LONGER_VALID", evidenceDigest };
  }
  const normalConsumption = await tx.select({ id: runtimePublishingApprovalConsumptions.id })
    .from(runtimePublishingApprovalConsumptions).where(and(
      eq(runtimePublishingApprovalConsumptions.workspaceId, delivery.workspaceId),
      eq(runtimePublishingApprovalConsumptions.decisionId, approvalDecisionId),
    )).limit(1).for("share");
  const currentApproval = await selectPublishingApprovalRequest(tx, {
    workspaceId: delivery.workspaceId,
    approvalRequestId,
  });
  if (Boolean(normalConsumption[0]) !== expectedNormalConsumption ||
    !currentApproval?.decision ||
    currentApproval.decision.decision !== "approved" ||
    currentApproval.decision.id !== approvalDecisionId ||
    Boolean(currentApproval.consumption) !== expectedNormalConsumption ||
    currentApproval.planId !== delivery.planId ||
    currentApproval.planRevisionId !== delivery.planRevisionId ||
    currentApproval.planRevisionDigest !== delivery.planRevisionDigest ||
    !currentApproval.targetIds.includes(delivery.targetId) ||
    !currentApproval.channelIds.includes(delivery.channelId) ||
    !sameSet(currentApproval.artifactIds, delivery.artifactIds)) {
    const evidenceDigest = canonicalDigest({
      schema: "publishing-delivery-readiness-block/v1",
      deliveryId: delivery.id,
      failureCode: "APPROVAL_NO_LONGER_VALID",
      evaluatedAt: now.toISOString(),
    });
    return { kind: "blocked", failureCode: "APPROVAL_NO_LONGER_VALID", evidenceDigest };
  }
  const currentRevision = await lockRetainedPublishingApprovalRevision(tx, currentApproval);
  if (!currentRevision || currentRevision.id !== delivery.planRevisionId ||
    currentRevision.definitionDigest !== delivery.planRevisionDigest) {
    const evidenceDigest = canonicalDigest({
      schema: "publishing-delivery-readiness-block/v1", deliveryId: delivery.id,
      failureCode: "APPROVAL_NO_LONGER_VALID", evaluatedAt: now.toISOString(),
    });
    return { kind: "blocked", failureCode: "APPROVAL_NO_LONGER_VALID", evidenceDigest };
  }
  // Old Approval validation TTLs are admission windows, not a lease over a
  // future Delivery. Re-run the complete validator inside a fresh, bounded
  // execution-readiness window.
  const validationDeadline = publishingDeliveryReadinessDeadline(now);
  const validationNow = await verifyCurrentPublishingPlanEvidence(
    tx,
    currentRevision,
    validationDeadline,
    [delivery.targetId],
    { allowDuePublishAt: true },
  );
  if (!validationNow) {
    const evidenceDigest = canonicalDigest({
      schema: "publishing-delivery-readiness-block/v1", deliveryId: delivery.id,
      failureCode: "VALIDATION_STALE", evaluatedAt: now.toISOString(),
    });
    return { kind: "blocked", failureCode: "VALIDATION_STALE", evidenceDigest };
  }
  const effectAuthorityCurrent = releaseContext !== null
    ? await lockReleaseAuthorization(tx, {
        schema: "publishing-delivery-authorization-session/v1",
        id: `pdas_${canonicalDigest({
          workspaceId: releaseContext.workspaceId,
          principalId: releaseContext.consumingPrincipalId,
          keyId: releaseContext.consumingKeyId,
          evidenceRef: releaseContext.authorizationEvidenceRef,
          channelIds: releaseContext.authorizedResources.channelIds,
          artifactIds: releaseContext.authorizedResources.artifactIds,
          issuedAt: releaseContext.authorizationIssuedAt.toISOString(),
          expiresAt: releaseContext.authorizationExpiresAt.toISOString(),
        }).slice("sha256:".length)}`,
        workspaceId: releaseContext.workspaceId,
        principalId: releaseContext.consumingPrincipalId,
        keyId: releaseContext.consumingKeyId,
        capability: "publishing_plan_revisions.release@1",
        contractDigest: releaseContext.authorizationContractDigest,
        evidenceRef: releaseContext.authorizationEvidenceRef,
        resources: releaseContext.authorizedResources,
        issuedAt: releaseContext.authorizationIssuedAt,
        expiresAt: releaseContext.authorizationExpiresAt,
      }, currentApproval, validationNow)
    : retryAuthorization !== null && retrySource !== null &&
      await lockRecoveryAuthorization(tx, retryAuthorization, retrySource, validationNow);
  if (!effectAuthorityCurrent) {
    const evidenceDigest = canonicalDigest({
      schema: "publishing-delivery-readiness-block/v1", deliveryId: delivery.id,
      failureCode: "EXECUTION_AUTHORIZATION_REVOKED",
      evaluatedAt: validationNow.toISOString(),
    });
    return { kind: "blocked", failureCode: "EXECUTION_AUTHORIZATION_REVOKED", evidenceDigest };
  }
  const accounts = await tx.select().from(socialAccounts).where(and(
    eq(socialAccounts.workspaceId, delivery.workspaceId),
    eq(socialAccounts.id, delivery.channelId),
  )).limit(1).for("share");
  const account = accounts[0];
  const authorKind = account ? readLinkedInAuthorKind(account.additionalSettings) : null;
  if (!account || account.platform !== "linkedin" || !authorKind || account.disabled) {
    const evidenceDigest = canonicalDigest({
      schema: "publishing-delivery-readiness-block/v1", deliveryId: delivery.id,
      failureCode: "CHANNEL_UNAVAILABLE", evaluatedAt: now.toISOString(),
    });
    return { kind: "blocked", failureCode: "CHANNEL_UNAVAILABLE", evidenceDigest };
  }
  if (account.requiresReauth ||
    (account.tokenExpiresAt !== null && account.tokenExpiresAt <= now &&
      !account.refreshTokenEncrypted)) {
    const evidenceDigest = canonicalDigest({
      schema: "publishing-delivery-readiness-block/v1", deliveryId: delivery.id,
      failureCode: "CREDENTIAL_UNAVAILABLE", evaluatedAt: now.toISOString(),
    });
    return { kind: "blocked", failureCode: "CREDENTIAL_UNAVAILABLE", evidenceDigest };
  }
  const channelVersionDigest = publishingPlanChannelVersionDigest({
    id: account.id,
    workspaceId: account.workspaceId,
    platform: "linkedin",
    authorKind,
    disabled: account.disabled,
    requiresReauth: account.requiresReauth,
    tokenExpiresAt: account.tokenExpiresAt,
    hasRefreshToken: Boolean(account.refreshTokenEncrypted),
    updatedAt: account.updatedAt,
    capabilityVersion: publishingPlanLinkedInCapabilityVersion(),
  });
  if (channelVersionDigest !== delivery.targetSnapshot.validation.channel.snapshotDigest) {
    const evidenceDigest = canonicalDigest({
      schema: "publishing-delivery-readiness-block/v1", deliveryId: delivery.id,
      failureCode: "VALIDATION_STALE", evaluatedAt: now.toISOString(),
    });
    return { kind: "blocked", failureCode: "VALIDATION_STALE", evidenceDigest };
  }
  const authorizationEvidenceDigest = canonicalDigest({
    schema: "publishing-delivery-execution-authority/v1",
    workspaceId: delivery.workspaceId,
    channelId: delivery.channelId, artifactIds: delivery.artifactIds,
    effectAuthority: releaseContext ? {
      kind: "release",
      principalId: releaseContext.consumingPrincipalId,
      keyId: releaseContext.consumingKeyId,
      capability: releaseContext.capability,
      contractDigest: releaseContext.authorizationContractDigest,
      evidenceRef: releaseContext.authorizationEvidenceRef,
    } : retryAuthorization ? {
      kind: "retry",
      actor: retryAuthorization.actor,
      sessionId: retryAuthorization.id,
      evidenceDigest: retryAuthorization.evidenceDigest,
    } : null,
  });
  const approvalEvidenceDigest = canonicalDigest({
    schema: "publishing-delivery-execution-approval/v1",
    requestId: approval.request.id, decisionId: approval.decision.id,
    planRevisionDigest: delivery.planRevisionDigest,
    decisionExpiresAt: approval.request.decisionPolicyExpiresAt.toISOString(),
  });
  const credentialEvidenceDigest = canonicalDigest({
    schema: "publishing-delivery-execution-credential/v1",
    accountId: account.id, updatedAt: account.updatedAt.toISOString(),
    tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
    hasRefreshToken: Boolean(account.refreshTokenEncrypted), requiresReauth: account.requiresReauth,
  });
  const validationEvidenceDigest = canonicalDigest({
    schema: "publishing-delivery-execution-validation/v1",
    planRevisionDigest: delivery.planRevisionDigest,
    targetSnapshotDigest: delivery.targetSnapshotDigest,
    channelVersionDigest,
    validationEvidenceDigest: currentApproval.validation.evidenceDigest,
    validationCurrentStateDigest: canonicalDigest({
      planRevisionDigest: currentRevision.definitionDigest,
      targetId: delivery.targetId,
      targetSnapshotDigest: delivery.targetSnapshotDigest,
      evaluatedAt: validationNow.toISOString(),
    }),
  });
  const evaluatedAt = validationNow;
  const expiresAt = new Date(validationNow.getTime() + READINESS_TTL_MS);
  const sessionBase = {
    workspaceId: delivery.workspaceId,
    deliveryId: delivery.id,
    effectKey: delivery.effectKey,
    effectGeneration: delivery.effectGeneration,
    intentDigest: input.intentDigest,
    providerAdapterContractDigest: input.providerAdapterContractDigest,
    mode: "launch" as const,
    authorizationEvidenceDigest,
    approvalEvidenceDigest,
    channelEvidenceDigest: channelVersionDigest,
    credentialEvidenceDigest,
    validationEvidenceDigest,
    evaluatedAt,
    expiresAt,
  };
  const evidenceDigest = canonicalDigest({
    schema: "publishing-delivery-execution-readiness-evidence/v1",
    ...sessionBase,
    evaluatedAt: evaluatedAt.toISOString(), expiresAt: expiresAt.toISOString(),
  });
  return {
    kind: "ready",
    session: {
      schema: "publishing-delivery-execution-readiness/v1",
      id: `pdrdy_${evidenceDigest.slice("sha256:".length)}`,
      ...sessionBase,
      evidenceDigest,
    },
  };
}

export class DrizzlePublishingDeliveryExecutionReadinessRepository
  implements PublishingDeliveryExecutionReadinessPort {
  constructor(private readonly database: () => Db) {}

  async checkCurrent(
    input: Parameters<PublishingDeliveryExecutionReadinessPort["checkCurrent"]>[0],
  ) {
    try {
      return await this.database().transaction((tx) =>
        evaluateExecutionReadiness(tx, input));
    } catch {
      return { kind: "unavailable" as const };
    }
  }
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

export class DrizzlePublishingDeliveryCancellationAuthorizationRepository
  implements PublishingDeliveryCancellationAuthorizationPort {
  constructor(private readonly database: () => Db) {}

  async checkCurrent(
    input: Parameters<PublishingDeliveryCancellationAuthorizationPort["checkCurrent"]>[0],
  ): Promise<PublishingDeliveryCancellationAuthorizationSession | null> {
    try {
      if (input.capability !== "publishing_deliveries.cancel@1" ||
        input.authorizationContractDigest !==
          publishingDeliveryCancelAuthorizationContractDigest() ||
        !safeRef(input.authorizationEvidenceRef, 200) ||
        !safeIds(input.channelIds, 50) || input.channelIds.length !== 1 ||
        !safeArtifactIds(input.artifactIds, 51)) return null;
      const database = this.database();
      if (input.actor.kind === "agent") {
        const rows = await database.select({
          decision: agentAuthorizationDecisions,
          principalStatus: agentPrincipals.status,
          principalRevokedAt: agentPrincipals.revokedAt,
          keyRevokedAt: agentKeys.revokedAt,
          keyExpiresAt: agentKeys.expiresAt,
          databaseNow: sql<unknown>`clock_timestamp()`,
        }).from(agentAuthorizationDecisions).innerJoin(agentPrincipals, and(
          eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId),
          eq(agentPrincipals.id, agentAuthorizationDecisions.principalId),
        )).innerJoin(agentKeys, and(
          eq(agentKeys.principalId, agentAuthorizationDecisions.principalId),
          eq(agentKeys.id, agentAuthorizationDecisions.keyId),
        )).where(and(
          eq(agentAuthorizationDecisions.workspaceId, input.workspaceId),
          eq(agentAuthorizationDecisions.principalId, input.actor.principalId),
          eq(agentAuthorizationDecisions.keyId, input.actor.keyId),
          eq(agentAuthorizationDecisions.operatorTraceRef, input.authorizationEvidenceRef),
          eq(agentAuthorizationDecisions.capabilityName, "publishing_deliveries.cancel"),
          eq(agentAuthorizationDecisions.capabilityVersion, 1),
          eq(agentAuthorizationDecisions.authorizationContractDigest,
            input.authorizationContractDigest),
          eq(agentAuthorizationDecisions.outcome, "allowed"),
        )).limit(1);
        const row = rows[0];
        const issuedAt = row?.decision.createdAt;
        const now = row ? dbDate(row.databaseNow) : null;
        if (!row || !issuedAt || !now || row.principalStatus !== "active" ||
          row.principalRevokedAt || row.keyRevokedAt ||
          (row.keyExpiresAt && row.keyExpiresAt <= now)) return null;
        const channelIds = row.decision.resources.filter((item) => item.kind === "channel")
          .map((item) => item.id);
        const artifactIds = row.decision.resources.filter((item) => item.kind === "artifact")
          .map((item) => item.id);
        if (row.decision.resources.length !== channelIds.length + artifactIds.length ||
          !sameSet(channelIds, input.channelIds) || !sameSet(artifactIds, input.artifactIds)) {
          return null;
        }
        const expiresAt = new Date(Math.min(
          issuedAt.getTime() + CANCELLATION_AGENT_AUTHORIZATION_TTL_MS,
          row.keyExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
        ));
        if (expiresAt <= now) return null;
        const sessionBase = {
          workspaceId: input.workspaceId,
          actor: input.actor,
          capability: "publishing_deliveries.cancel@1" as const,
          contractDigest: input.authorizationContractDigest,
          admissionEvidenceRef: input.authorizationEvidenceRef,
          evidenceRef: row.decision.operatorTraceRef,
          resources: { channelIds: [...input.channelIds], artifactIds: [...input.artifactIds] },
          humanGrants: [],
          issuedAt,
          expiresAt,
        };
        const evidenceDigest = cancellationAuthorityDigest(sessionBase);
        return {
          schema: "publishing-delivery-cancellation-authorization-session/v1",
          id: `pdcas_${evidenceDigest.slice("sha256:".length)}`,
          ...sessionBase,
          evidenceDigest,
        };
      }
      const admissionRows = await database.select({
        event: agentSecurityEvents,
      }).from(agentSecurityEvents).where(and(
        eq(agentSecurityEvents.workspaceId, input.workspaceId),
        eq(agentSecurityEvents.actorUserId, input.actor.userId),
        eq(agentSecurityEvents.eventType, "authorization.allowed"),
        eq(agentSecurityEvents.capabilityName, "publishing_deliveries.cancel"),
        eq(agentSecurityEvents.capabilityVersion, 1),
        eq(agentSecurityEvents.changeRef, input.authorizationEvidenceRef),
      )).limit(1);
      if (!admissionRows[0] ||
        !sameSet(admissionRows[0].event.resourceKinds, ["channel", "artifact"])) return null;
      const rows = await database.select({
        grant: runtimePublishingApprovalAuthorityGrants,
        revocationId: runtimePublishingApprovalAuthorityRevocations.grantId,
        memberRole: workspaceMembers.role,
        databaseNow: sql<unknown>`clock_timestamp()`,
      }).from(runtimePublishingApprovalAuthorityGrants).innerJoin(workspaceMembers, and(
        eq(workspaceMembers.workspaceId, runtimePublishingApprovalAuthorityGrants.workspaceId),
        eq(workspaceMembers.userId, runtimePublishingApprovalAuthorityGrants.userId),
      )).leftJoin(runtimePublishingApprovalAuthorityRevocations, and(
        eq(runtimePublishingApprovalAuthorityRevocations.workspaceId,
          runtimePublishingApprovalAuthorityGrants.workspaceId),
        eq(runtimePublishingApprovalAuthorityRevocations.grantId,
          runtimePublishingApprovalAuthorityGrants.id),
      )).where(and(
        eq(runtimePublishingApprovalAuthorityGrants.workspaceId, input.workspaceId),
        eq(runtimePublishingApprovalAuthorityGrants.userId, input.actor.userId),
        eq(runtimePublishingApprovalAuthorityGrants.action, "publish"),
        eq(runtimePublishingApprovalAuthorityGrants.channelId, input.channelIds[0]!),
        isNull(runtimePublishingApprovalAuthorityRevocations.grantId),
      )).orderBy(
        desc(runtimePublishingApprovalAuthorityGrants.issuedAt),
        desc(runtimePublishingApprovalAuthorityGrants.id),
      );
      const now = rows[0] ? dbDate(rows[0].databaseNow) : null;
      const row = now ? rows.find(({ grant, memberRole, revocationId }) =>
        !revocationId && (memberRole === "owner" || memberRole === "admin") &&
        grant.issuedAt <= now && (!grant.expiresAt || grant.expiresAt > now)) : null;
      if (!row || !now) return null;
      const issuedAt = now;
      const expiresAt = new Date(Math.min(
        issuedAt.getTime() + CANCELLATION_HUMAN_AUTHORIZATION_TTL_MS,
        row.grant.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
      ));
      const humanGrants = [{ channelId: row.grant.channelId, grantId: row.grant.id }];
      const resources = { channelIds: [...input.channelIds], artifactIds: [...input.artifactIds] };
      const evidenceSeed = canonicalDigest({
        schema: "publishing-delivery-cancellation-human-grant-evidence/v1",
        workspaceId: input.workspaceId,
        actor: input.actor,
        resources,
        humanGrants,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      const sessionBase = {
        workspaceId: input.workspaceId,
        actor: input.actor,
        capability: "publishing_deliveries.cancel@1" as const,
        contractDigest: input.authorizationContractDigest,
        admissionEvidenceRef: input.authorizationEvidenceRef,
        evidenceRef: `pdcae_${evidenceSeed.slice("sha256:".length)}`,
        resources,
        humanGrants,
        issuedAt,
        expiresAt,
      };
      const evidenceDigest = cancellationAuthorityDigest(sessionBase);
      return {
        schema: "publishing-delivery-cancellation-authorization-session/v1",
        id: `pdcas_${evidenceDigest.slice("sha256:".length)}`,
        ...sessionBase,
        evidenceDigest,
      };
    } catch {
      return null;
    }
  }
}

/** Fresh exact authority for explicit retry and reconciliation requests. */
export class DrizzlePublishingDeliveryRecoveryAuthorizationRepository
  implements PublishingDeliveryRecoveryAuthorizationPort {
  constructor(private readonly database: () => Db) {}

  async checkCurrent(
    input: Parameters<PublishingDeliveryRecoveryAuthorizationPort["checkCurrent"]>[0],
  ): Promise<PublishingDeliveryRecoveryAuthorizationSession | null> {
    try {
      const expectedContract = input.capability === "publishing_deliveries.retry@1"
        ? publishingDeliveryRetryAuthorizationContractDigest()
        : publishingDeliveryReconcileAuthorizationContractDigest();
      if (input.authorizationContractDigest !== expectedContract ||
        !safeRef(input.authorizationEvidenceRef, 200) ||
        !safeIds(input.channelIds, 50) || input.channelIds.length !== 1 ||
        !safeArtifactIds(input.artifactIds, 51)) return null;
      const database = this.database();
      const capabilityName = input.capability.slice(0, -2);
      if (input.actor.kind === "agent") {
        const rows = await database.select({
          decision: agentAuthorizationDecisions,
          principalStatus: agentPrincipals.status,
          principalRevokedAt: agentPrincipals.revokedAt,
          keyRevokedAt: agentKeys.revokedAt,
          keyExpiresAt: agentKeys.expiresAt,
          databaseNow: sql<unknown>`clock_timestamp()`,
        }).from(agentAuthorizationDecisions).innerJoin(agentPrincipals, and(
          eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId),
          eq(agentPrincipals.id, agentAuthorizationDecisions.principalId),
        )).innerJoin(agentKeys, and(
          eq(agentKeys.principalId, agentAuthorizationDecisions.principalId),
          eq(agentKeys.id, agentAuthorizationDecisions.keyId),
        )).where(and(
          eq(agentAuthorizationDecisions.workspaceId, input.workspaceId),
          eq(agentAuthorizationDecisions.principalId, input.actor.principalId),
          eq(agentAuthorizationDecisions.keyId, input.actor.keyId),
          eq(agentAuthorizationDecisions.operatorTraceRef, input.authorizationEvidenceRef),
          eq(agentAuthorizationDecisions.capabilityName, capabilityName),
          eq(agentAuthorizationDecisions.capabilityVersion, 1),
          eq(agentAuthorizationDecisions.authorizationContractDigest, expectedContract),
          eq(agentAuthorizationDecisions.outcome, "allowed"),
        )).limit(1);
        const row = rows[0];
        const now = row ? dbDate(row.databaseNow) : null;
        if (!row || !now || row.principalStatus !== "active" || row.principalRevokedAt ||
          row.keyRevokedAt || (row.keyExpiresAt && row.keyExpiresAt <= now)) return null;
        const channelIds = row.decision.resources.filter((item) => item.kind === "channel")
          .map((item) => item.id);
        const artifactIds = row.decision.resources.filter((item) => item.kind === "artifact")
          .map((item) => item.id);
        if (row.decision.resources.length !== channelIds.length + artifactIds.length ||
          !sameSet(channelIds, input.channelIds) || !sameSet(artifactIds, input.artifactIds)) {
          return null;
        }
        const issuedAt = row.decision.createdAt;
        const expiresAt = new Date(Math.min(
          issuedAt.getTime() + CANCELLATION_AGENT_AUTHORIZATION_TTL_MS,
          row.keyExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
        ));
        if (expiresAt <= now) return null;
        const base = {
          workspaceId: input.workspaceId,
          actor: input.actor,
          capability: input.capability,
          contractDigest: expectedContract,
          admissionEvidenceRef: input.authorizationEvidenceRef,
          evidenceRef: input.authorizationEvidenceRef,
          resources: { channelIds: [...input.channelIds], artifactIds: [...input.artifactIds] },
          humanGrants: [],
          issuedAt,
          expiresAt,
        };
        const evidenceDigest = recoveryAuthorityDigest(base);
        return {
          schema: "publishing-delivery-recovery-authorization-session/v1",
          id: `pdras_${evidenceDigest.slice("sha256:".length)}`,
          ...base,
          evidenceDigest,
        };
      }
      const admission = await database.select({ event: agentSecurityEvents })
        .from(agentSecurityEvents).where(and(
          eq(agentSecurityEvents.workspaceId, input.workspaceId),
          eq(agentSecurityEvents.actorUserId, input.actor.userId),
          eq(agentSecurityEvents.eventType, "authorization.allowed"),
          eq(agentSecurityEvents.capabilityName, capabilityName),
          eq(agentSecurityEvents.capabilityVersion, 1),
          eq(agentSecurityEvents.changeRef, input.authorizationEvidenceRef),
        )).limit(1);
      if (!admission[0] || admission[0].event.reason !== "allowed" ||
        !sameSet(admission[0].event.resourceKinds, ["channel", "artifact"])) return null;
      const rows = await database.select({
        grant: runtimePublishingApprovalAuthorityGrants,
        revocationId: runtimePublishingApprovalAuthorityRevocations.grantId,
        memberRole: workspaceMembers.role,
        databaseNow: sql<unknown>`clock_timestamp()`,
      }).from(runtimePublishingApprovalAuthorityGrants).innerJoin(workspaceMembers, and(
        eq(workspaceMembers.workspaceId, runtimePublishingApprovalAuthorityGrants.workspaceId),
        eq(workspaceMembers.userId, runtimePublishingApprovalAuthorityGrants.userId),
      )).leftJoin(runtimePublishingApprovalAuthorityRevocations, and(
        eq(runtimePublishingApprovalAuthorityRevocations.workspaceId,
          runtimePublishingApprovalAuthorityGrants.workspaceId),
        eq(runtimePublishingApprovalAuthorityRevocations.grantId,
          runtimePublishingApprovalAuthorityGrants.id),
      )).where(and(
        eq(runtimePublishingApprovalAuthorityGrants.workspaceId, input.workspaceId),
        eq(runtimePublishingApprovalAuthorityGrants.userId, input.actor.userId),
        eq(runtimePublishingApprovalAuthorityGrants.action, "publish"),
        eq(runtimePublishingApprovalAuthorityGrants.channelId, input.channelIds[0]!),
        isNull(runtimePublishingApprovalAuthorityRevocations.grantId),
      )).orderBy(desc(runtimePublishingApprovalAuthorityGrants.issuedAt));
      const now = rows[0] ? dbDate(rows[0].databaseNow) : null;
      const row = now ? rows.find(({ grant, memberRole, revocationId }) =>
        !revocationId && (memberRole === "owner" || memberRole === "admin") &&
        grant.issuedAt <= now && (!grant.expiresAt || grant.expiresAt > now)) : null;
      if (!row || !now) return null;
      const issuedAt = now;
      const expiresAt = new Date(Math.min(
        now.getTime() + CANCELLATION_HUMAN_AUTHORIZATION_TTL_MS,
        row.grant.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
      ));
      const resources = {
        channelIds: [...input.channelIds],
        artifactIds: [...input.artifactIds],
      };
      const humanGrants = [{ channelId: row.grant.channelId, grantId: row.grant.id }];
      const evidenceSeed = canonicalDigest({
        schema: "publishing-delivery-recovery-human-grant-evidence/v1",
        workspaceId: input.workspaceId,
        actor: input.actor,
        capability: input.capability,
        resources,
        humanGrants,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      const base = {
        workspaceId: input.workspaceId,
        actor: input.actor,
        capability: input.capability,
        contractDigest: expectedContract,
        admissionEvidenceRef: input.authorizationEvidenceRef,
        evidenceRef: `pdrae_${evidenceSeed.slice("sha256:".length)}`,
        resources,
        humanGrants,
        issuedAt,
        expiresAt,
      };
      const evidenceDigest = recoveryAuthorityDigest(base);
      return {
        schema: "publishing-delivery-recovery-authorization-session/v1",
        id: `pdras_${evidenceDigest.slice("sha256:".length)}`,
        ...base,
        evidenceDigest,
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
        const retryConsumed = await tx.select({
          id: runtimePublishingDeliveryRetryApprovalConsumptions.id,
        }).from(runtimePublishingDeliveryRetryApprovalConsumptions).where(and(
          eq(runtimePublishingDeliveryRetryApprovalConsumptions.workspaceId,
            approval.workspaceId),
          eq(runtimePublishingDeliveryRetryApprovalConsumptions.approvalDecisionId,
            approval.decision!.id),
        )).limit(1).for("update");
        if (consumed[0] || retryConsumed[0]) return { kind: "approval_consumed" as const };
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
    }).from(runtimePublishingDeliveries).leftJoin(
      runtimePublishingDeliveryReleases,
      and(
        eq(runtimePublishingDeliveryReleases.workspaceId, runtimePublishingDeliveries.workspaceId),
        eq(runtimePublishingDeliveryReleases.id, runtimePublishingDeliveries.releaseId),
      ),
    ).leftJoin(
      runtimePublishingDeliveryRetryReceipts,
      and(
        eq(runtimePublishingDeliveryRetryReceipts.workspaceId,
          runtimePublishingDeliveries.workspaceId),
        eq(runtimePublishingDeliveryRetryReceipts.id, runtimePublishingDeliveries.retryId),
        eq(runtimePublishingDeliveryRetryReceipts.sourceDeliveryId,
          runtimePublishingDeliveries.sourceDeliveryId),
        eq(runtimePublishingDeliveryRetryReceipts.deliveryId,
          runtimePublishingDeliveries.id),
      ),
    ).where(and(
      eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
      eq(runtimePublishingDeliveries.id, input.deliveryId),
      or(
        and(
          isNotNull(runtimePublishingDeliveries.releaseId),
          isNotNull(runtimePublishingDeliveryReleases.id),
        ),
        and(
          isNull(runtimePublishingDeliveries.releaseId),
          isNotNull(runtimePublishingDeliveryRetryReceipts.id),
        ),
      ),
      input.consumingPrincipalId
        ? or(
            and(
              isNotNull(runtimePublishingDeliveryReleases.id),
              eq(runtimePublishingDeliveryReleases.consumingPrincipalId,
                input.consumingPrincipalId),
            ),
            and(
              isNotNull(runtimePublishingDeliveryRetryReceipts.id),
              or(
                eq(runtimePublishingDeliveries.requestingPrincipalId,
                  input.consumingPrincipalId),
                and(
                  eq(runtimePublishingDeliveryRetryReceipts.actorKind, "agent"),
                  eq(runtimePublishingDeliveryRetryReceipts.principalId,
                    input.consumingPrincipalId),
                ),
              ),
            ),
          )
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
      .from(runtimePublishingDeliveries).leftJoin(
        runtimePublishingDeliveryReleases,
        and(
          eq(runtimePublishingDeliveryReleases.workspaceId, runtimePublishingDeliveries.workspaceId),
          eq(runtimePublishingDeliveryReleases.id, runtimePublishingDeliveries.releaseId),
        ),
      ).leftJoin(
        runtimePublishingDeliveryRetryReceipts,
        and(
          eq(runtimePublishingDeliveryRetryReceipts.workspaceId,
            runtimePublishingDeliveries.workspaceId),
          eq(runtimePublishingDeliveryRetryReceipts.id, runtimePublishingDeliveries.retryId),
          eq(runtimePublishingDeliveryRetryReceipts.sourceDeliveryId,
            runtimePublishingDeliveries.sourceDeliveryId),
          eq(runtimePublishingDeliveryRetryReceipts.deliveryId,
            runtimePublishingDeliveries.id),
        ),
      ).where(and(
        eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
        or(
          and(
            isNotNull(runtimePublishingDeliveries.releaseId),
            isNotNull(runtimePublishingDeliveryReleases.id),
          ),
          and(
            isNull(runtimePublishingDeliveries.releaseId),
            isNotNull(runtimePublishingDeliveryRetryReceipts.id),
          ),
        ),
        input.filters.planRevisionId
          ? eq(runtimePublishingDeliveries.planRevisionId, input.filters.planRevisionId)
          : undefined,
        input.filters.state ? eq(runtimePublishingDeliveries.state, input.filters.state) : undefined,
        input.filters.targetId ? eq(runtimePublishingDeliveries.targetId, input.filters.targetId) : undefined,
        input.filters.consumingPrincipalId
          ? or(
              and(
                isNotNull(runtimePublishingDeliveryReleases.id),
                eq(runtimePublishingDeliveryReleases.consumingPrincipalId,
                  input.filters.consumingPrincipalId),
              ),
              and(
                isNotNull(runtimePublishingDeliveryRetryReceipts.id),
                or(
                  eq(runtimePublishingDeliveries.requestingPrincipalId,
                    input.filters.consumingPrincipalId),
                  and(
                    eq(runtimePublishingDeliveryRetryReceipts.actorKind, "agent"),
                    eq(runtimePublishingDeliveryRetryReceipts.principalId,
                      input.filters.consumingPrincipalId),
                  ),
                ),
              ),
            )
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

  async getCancellation(
    input: Parameters<PublishingDeliveryRepository["getCancellation"]>[0],
  ) {
    const rows = await this.database().select()
      .from(runtimePublishingDeliveryCancellations).where(and(
        eq(runtimePublishingDeliveryCancellations.workspaceId, input.workspaceId),
        eq(runtimePublishingDeliveryCancellations.deliveryId, input.deliveryId),
      )).limit(1);
    if (!rows[0]) return null;
    const record = rehydratePublishingDeliveryCancellation(rows[0]);
    if (!record) {
      throw new Error("Publishing Delivery Cancellation evidence is malformed.");
    }
    return !input.actor || canonicalDigest(record.actor) === canonicalDigest(input.actor)
      ? record
      : null;
  }

  async cancel(input: Parameters<PublishingDeliveryRepository["cancel"]>[0]) {
    try {
      return await this.database().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
          ${`publishing-delivery-cancel:${input.workspaceId}:${input.deliveryId}`}, 0
        ))`);
        const priorRows = await tx.select().from(runtimePublishingDeliveryCancellations)
          .where(and(
            eq(runtimePublishingDeliveryCancellations.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryCancellations.deliveryId, input.deliveryId),
          )).limit(1).for("update");
        if (priorRows[0]) {
          const cancellation = rehydratePublishingDeliveryCancellation(priorRows[0]);
          const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
            eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveries.id, input.deliveryId),
          )).limit(1).for("update");
          const delivery = deliveryRows[0]
            ? rehydratePublishingDelivery(deliveryRows[0])
            : null;
          if (!cancellation || !delivery) throw new PublishingDeliveryTransactionRollback();
          if (canonicalDigest(cancellation.actor) !== canonicalDigest(input.actor)) {
            const now = await databaseNow(tx);
            if (!now ||
              canonicalDigest(input.authorizationSession.actor) !==
                canonicalDigest(input.actor) ||
              !(await lockCancellationAuthorization(
                tx,
                input.authorizationSession,
                delivery,
                now,
              ))) return { kind: "authorization_stale" as const };
          }
          return {
            kind: "replayed" as const,
            cancellation,
            delivery,
            events: [] as PublishingDeliveryEvent[],
          };
        }
        const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = deliveryRows[0]
          ? rehydratePublishingDelivery(deliveryRows[0])
          : null;
        if (!delivery) return { kind: "not_found" as const };
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        if (canonicalDigest(input.authorizationSession.actor) !== canonicalDigest(input.actor) ||
          input.cancellationId.length > 200 || !/^pdc_[A-Za-z0-9_-]+$/.test(input.cancellationId) ||
          !(await lockCancellationAuthorization(
            tx,
            input.authorizationSession,
            delivery,
            now,
          ))) return { kind: "authorization_stale" as const };

        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases)
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
          )).limit(1).for("update");
        const lease = leaseRows[0];
        const activeLease = Boolean(
          lease && lease.releasedAt === null && lease.expiresAt > now,
        );
        if (delivery.state === "cancelled") {
          throw new PublishingDeliveryTransactionRollback();
        }
        const transition = planPublishingDeliveryCancellation({
          delivery,
          cancellationId: input.cancellationId,
          requestedAt: now,
          activeLease,
        });
        const cancellation: PublishingDeliveryCancellationRecord = {
          schema: "publishing-delivery-cancellation-record/v1",
          id: input.cancellationId,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          actor: structuredClone(input.actor),
          capability: "publishing_deliveries.cancel@1",
          authorizationContractDigest: input.authorizationSession.contractDigest,
          authorizationAdmissionEvidenceRef:
            input.authorizationSession.admissionEvidenceRef,
          authorizationEvidenceRef: input.authorizationSession.evidenceRef,
          authorizationEvidenceDigest: input.authorizationSession.evidenceDigest,
          authorizedResources: structuredClone(input.authorizationSession.resources),
          authorityGrants: structuredClone(input.authorizationSession.humanGrants),
          stateAtRequest: delivery.state,
          outcome: transition.outcome,
          externallyCompletedAtRequest: transition.externallyCompletedAtRequest,
          requestedAt: now,
        };
        const requestEvent: PublishingDeliveryEvent = {
          schema: "publishing-delivery-event/v1",
          id: `pde_${randomUUID().replaceAll("-", "")}`,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          sequence: delivery.nextEventSequence,
          type: "delivery.cancellation_requested",
          evidence: {
            cancellationId: cancellation.id,
            actorKind: input.actor.kind,
            effectDisposition: transition.effectDisposition,
          },
          occurredAt: now,
        };
        const events: PublishingDeliveryEvent[] = [requestEvent];
        if (transition.terminalEvent) {
          events.push({
            schema: "publishing-delivery-event/v1",
            id: `pde_${randomUUID().replaceAll("-", "")}`,
            workspaceId: input.workspaceId,
            deliveryId: input.deliveryId,
            sequence: delivery.nextEventSequence + 1,
            ...transition.terminalEvent,
            occurredAt: now,
          });
        }
        await tx.insert(runtimePublishingDeliveryEvents).values(events.map((event) => ({
          workspaceId: event.workspaceId,
          id: event.id,
          deliveryId: event.deliveryId,
          sequence: event.sequence,
          type: event.type,
          evidence: event.evidence,
          occurredAt: event.occurredAt,
        })));
        const updatedRows = await tx.update(runtimePublishingDeliveries).set({
          desiredState: "cancel",
          state: transition.nextState,
          latestEffectEvidenceDigest: transition.latestEffectEvidenceDigest,
          failureCode: transition.failureCode,
          readinessBlockCode: transition.clearReadinessBlock
            ? null : delivery.readinessBlockCode,
          readinessEvidenceDigest: transition.clearReadinessBlock
            ? null : delivery.readinessEvidenceDigest,
          readinessBlockedAt: transition.clearReadinessBlock
            ? null : delivery.readinessBlockedAt,
          readinessRetryAt: transition.clearReadinessBlock
            ? null : delivery.readinessRetryAt,
          readinessBlockCount: transition.clearReadinessBlock
            ? 0 : delivery.readinessBlockCount,
          completedAt: transition.completedAt,
          nextEventSequence: delivery.nextEventSequence + events.length,
          updatedAt: now,
        }).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).returning();
        if (transition.releaseLease && lease && lease.releasedAt === null) {
          await tx.update(runtimePublishingDeliveryExecutionLeases).set({ releasedAt: now })
            .where(and(
              eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
              eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
              eq(runtimePublishingDeliveryExecutionLeases.fence, lease.fence),
              isNull(runtimePublishingDeliveryExecutionLeases.releasedAt),
            ));
        }
        await tx.insert(runtimePublishingDeliveryCancellations).values({
          workspaceId: cancellation.workspaceId,
          id: cancellation.id,
          deliveryId: cancellation.deliveryId,
          actorKind: cancellation.actor.kind,
          actorId: cancellation.actor.kind === "agent"
            ? cancellation.actor.principalId
            : cancellation.actor.userId,
          principalId: cancellation.actor.kind === "agent"
            ? cancellation.actor.principalId
            : null,
          keyId: cancellation.actor.kind === "agent" ? cancellation.actor.keyId : null,
          userId: cancellation.actor.kind === "human" ? cancellation.actor.userId : null,
          capability: cancellation.capability,
          authorizationSessionId: input.authorizationSession.id,
          authorizationContractDigest: cancellation.authorizationContractDigest,
          authorizationAdmissionEvidenceRef:
            cancellation.authorizationAdmissionEvidenceRef,
          authorizationEvidenceRef: cancellation.authorizationEvidenceRef,
          authorizationEvidenceDigest: cancellation.authorizationEvidenceDigest,
          authorizedResources: cancellation.authorizedResources,
          authorityGrants: cancellation.authorityGrants,
          authorizationIssuedAt: input.authorizationSession.issuedAt,
          authorizationExpiresAt: input.authorizationSession.expiresAt,
          stateAtRequest: cancellation.stateAtRequest,
          outcome: cancellation.outcome,
          externallyCompletedAtRequest: cancellation.externallyCompletedAtRequest,
          externallyReversed: false,
          requestedAt: cancellation.requestedAt,
        });
        const updated = requireWrittenRecord(
          updatedRows[0] ? rehydratePublishingDelivery(updatedRows[0]) : null,
        );
        return {
          kind: "created" as const,
          cancellation,
          delivery: updated,
          events,
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async getRetry(input: Parameters<PublishingDeliveryRepository["getRetry"]>[0]) {
    try {
      const rows = await this.database().select().from(runtimePublishingDeliveryRetryReceipts)
        .where(and(
          eq(runtimePublishingDeliveryRetryReceipts.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryRetryReceipts.sourceDeliveryId, input.sourceDeliveryId),
          eq(runtimePublishingDeliveryRetryReceipts.sourceEvidenceDigest,
            input.sourceEvidenceDigest),
        )).limit(1);
      const retry = rows[0] ? rehydrateRetry(rows[0]) : null;
      if (!retry) return null;
      const actorId = input.actor.kind === "agent" ? input.actor.principalId : input.actor.userId;
      return retry.actor.kind === input.actor.kind &&
        (retry.actor.kind === "agent" ? retry.actor.principalId : retry.actor.userId) === actorId
        ? retry : null;
    } catch {
      return null;
    }
  }

  async getRetryMutationReceipt(
    input: Parameters<PublishingDeliveryRepository["getRetryMutationReceipt"]>[0],
  ) {
    try {
      const rows = await this.database().select().from(runtimePublishingDeliveryRetryReceipts)
        .where(and(
          eq(runtimePublishingDeliveryRetryReceipts.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryRetryReceipts.actorKind, input.actorKind),
          eq(runtimePublishingDeliveryRetryReceipts.actorId, input.actorId),
          eq(runtimePublishingDeliveryRetryReceipts.capability, input.capability),
          eq(runtimePublishingDeliveryRetryReceipts.idempotencyKey, input.idempotencyKey),
        )).limit(1);
      return rows[0] ? rehydrateRetryMutationReceipt(rows[0]) : null;
    } catch {
      return null;
    }
  }

  async retryKnownFailure(
    input: Parameters<PublishingDeliveryRepository["retryKnownFailure"]>[0],
  ) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const actorId = input.retry.actor.kind === "agent"
          ? input.retry.actor.principalId : input.retry.actor.userId;
        const mutation = input.mutationReceipt;
        if (mutation.workspaceId !== input.retry.workspaceId ||
          mutation.actorKind !== input.retry.actor.kind || mutation.actorId !== actorId ||
          mutation.capability !== "publishing_deliveries.retry@1" ||
          mutation.retryId !== input.retry.id ||
          mutation.sourceDeliveryId !== input.retry.sourceDeliveryId ||
          mutation.deliveryId !== input.retry.deliveryId ||
          mutation.idempotencyKey.length < 8 || mutation.idempotencyKey.length > 200 ||
          !/^[!-~]+$/.test(mutation.idempotencyKey) ||
          !DIGEST.test(mutation.requestFingerprint)) {
          return { kind: "unavailable" as const };
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
          "publishing-delivery-retry-mutation", mutation.workspaceId,
          mutation.actorKind, mutation.actorId, mutation.capability, mutation.idempotencyKey,
        ])}, 0))`);
        const priorMutationRows = await tx.select().from(runtimePublishingDeliveryRetryReceipts)
          .where(and(
            eq(runtimePublishingDeliveryRetryReceipts.workspaceId, mutation.workspaceId),
            eq(runtimePublishingDeliveryRetryReceipts.actorKind, mutation.actorKind),
            eq(runtimePublishingDeliveryRetryReceipts.actorId, mutation.actorId),
            eq(runtimePublishingDeliveryRetryReceipts.capability, mutation.capability),
            eq(runtimePublishingDeliveryRetryReceipts.idempotencyKey, mutation.idempotencyKey),
          )).limit(1).for("update");
        if (priorMutationRows[0]) {
          const priorMutation = rehydrateRetryMutationReceipt(priorMutationRows[0]);
          if (!priorMutation || priorMutation.requestFingerprint !== mutation.requestFingerprint ||
            priorMutation.retryId !== mutation.retryId ||
            priorMutation.sourceDeliveryId !== mutation.sourceDeliveryId ||
            priorMutation.deliveryId !== mutation.deliveryId) {
            return { kind: "retry_conflict" as const };
          }
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
          "publishing-delivery-manual-retry", input.retry.workspaceId,
          input.retry.sourceDeliveryId, input.retry.sourceEvidenceDigest,
        ])}, 0))`);
        const prior = await tx.select().from(runtimePublishingDeliveryRetryReceipts)
          .where(and(
            eq(runtimePublishingDeliveryRetryReceipts.workspaceId, input.retry.workspaceId),
            eq(runtimePublishingDeliveryRetryReceipts.sourceDeliveryId,
              input.retry.sourceDeliveryId),
            eq(runtimePublishingDeliveryRetryReceipts.sourceEvidenceDigest,
              input.retry.sourceEvidenceDigest),
          )).limit(1).for("update");
        if (prior[0]) {
          const retry = rehydrateRetry(prior[0]);
          const retainedMutation = rehydrateRetryMutationReceipt(prior[0]);
          if (!retry || !retainedMutation ||
            retainedMutation.idempotencyKey !== mutation.idempotencyKey ||
            retainedMutation.requestFingerprint !== mutation.requestFingerprint ||
            retry.actor.kind !== input.retry.actor.kind ||
            (retry.actor.kind === "agent" ? retry.actor.principalId : retry.actor.userId) !==
              actorId) return { kind: "retry_conflict" as const };
          const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
            eq(runtimePublishingDeliveries.workspaceId, input.retry.workspaceId),
            eq(runtimePublishingDeliveries.id, retry.deliveryId),
          )).limit(1);
          const delivery = deliveryRows[0] ? rehydratePublishingDelivery(deliveryRows[0]) : null;
          const eventRows = await tx.select().from(runtimePublishingDeliveryEvents).where(and(
            eq(runtimePublishingDeliveryEvents.workspaceId, input.retry.workspaceId),
            eq(runtimePublishingDeliveryEvents.deliveryId, retry.deliveryId),
          )).orderBy(asc(runtimePublishingDeliveryEvents.sequence));
          const events = eventRows.map(rehydratePublishingDeliveryEvent)
            .filter((event): event is PublishingDeliveryEvent => event !== null);
          return delivery && events.length >= 3 &&
            events.some((event) => event.type === "delivery.retry_requested" &&
              event.evidence.retryId === retry.id)
            ? { kind: "replayed" as const, retry, delivery, events }
            : { kind: "unavailable" as const };
        }
        const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.retry.workspaceId),
          eq(runtimePublishingDeliveries.id, input.retry.sourceDeliveryId),
        )).limit(1).for("update");
        const source = deliveryRows[0] ? rehydratePublishingDelivery(deliveryRows[0]) : null;
        if (!source) return { kind: "not_found" as const };
        const normalizedFailure =
          (source.state === "failed_transient" && source.failureClass === "transient" &&
            source.failureRetryable === true) ||
          (source.state === "failed_terminal" && source.failureClass === "terminal" &&
            source.failureRetryable === false);
        if (!normalizedFailure ||
          (source.failureEffectDisposition !== "not_created" &&
            source.failureEffectDisposition !== "provider_failed_known") ||
          source.latestEffectEvidenceDigest !== input.retry.sourceEvidenceDigest ||
          source.effectKey !== input.retry.sourceEffectKey ||
          source.effectGeneration !== input.retry.sourceEffectGeneration ||
          source.intentDigest !== input.retry.sourceIntentDigest ||
          source.providerAdapterContractDigest !==
            input.retry.sourceProviderAdapterContractDigest ||
          canonicalDigest(source) !== canonicalDigest(input.sourceDelivery)) {
          return { kind: "not_retryable" as const };
        }
        if (input.authorizationSession.id !== input.retry.authorization.id ||
          input.authorizationSession.capability !== "publishing_deliveries.retry@1" ||
          input.authorizationSession.expiresAt <= now ||
          canonicalDigest(input.authorizationSession) !== canonicalDigest(input.retry.authorization) ||
          !await lockRecoveryAuthorization(tx, input.authorizationSession, source, now)) {
          return { kind: "authorization_stale" as const };
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
          "publishing-approval-consumption", input.retry.workspaceId,
          input.retry.approvalDecisionId,
        ])}, 0))`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
          "publishing-delivery-approval", input.retry.workspaceId,
          input.retry.approvalDecisionId,
        ])}, 0))`);
        const approvalRows = await tx.select().from(runtimePublishingApprovalRequests).where(and(
          eq(runtimePublishingApprovalRequests.workspaceId, input.retry.workspaceId),
          eq(runtimePublishingApprovalRequests.id, input.retry.approvalRequestId),
        )).limit(1).for("update");
        const decisionRows = await tx.select().from(runtimePublishingApprovalDecisions).where(and(
          eq(runtimePublishingApprovalDecisions.workspaceId, input.retry.workspaceId),
          eq(runtimePublishingApprovalDecisions.requestId, input.retry.approvalRequestId),
          eq(runtimePublishingApprovalDecisions.id, input.retry.approvalDecisionId),
        )).limit(1).for("update");
        if (!approvalRows[0] || !decisionRows[0] || decisionRows[0].outcome !== "approved" ||
          approvalRows[0].decisionPolicyExpiresAt <= now) {
          return { kind: "approval_invalid" as const };
        }
        const normalConsumption = await tx.select({ id: runtimePublishingApprovalConsumptions.id })
          .from(runtimePublishingApprovalConsumptions).where(and(
            eq(runtimePublishingApprovalConsumptions.workspaceId, input.retry.workspaceId),
            eq(runtimePublishingApprovalConsumptions.decisionId,
              input.retry.approvalDecisionId),
          )).limit(1).for("update");
        const consumed = await tx.select().from(runtimePublishingDeliveryRetryApprovalConsumptions)
          .where(and(
            eq(runtimePublishingDeliveryRetryApprovalConsumptions.workspaceId,
              input.retry.workspaceId),
            eq(runtimePublishingDeliveryRetryApprovalConsumptions.approvalDecisionId,
              input.retry.approvalDecisionId),
          )).limit(1).for("update");
        if (normalConsumption[0] || consumed[0]) return { kind: "approval_consumed" as const };
        const currentApproval = await selectPublishingApprovalRequest(tx, {
          workspaceId: input.retry.workspaceId,
          approvalRequestId: input.retry.approvalRequestId,
        });
        if (!currentApproval?.decision || currentApproval.decision.decision !== "approved" ||
          currentApproval.decision.id !== input.retry.approvalDecisionId ||
          currentApproval.consumption ||
          canonicalDigest(currentApproval) !== canonicalDigest(input.approval) ||
          currentApproval.retrySource?.deliveryId !== source.id ||
          currentApproval.retrySource.evidenceDigest !==
            source.latestEffectEvidenceDigest ||
          currentApproval.planId !== source.planId ||
          currentApproval.planRevisionId !== source.planRevisionId ||
          currentApproval.planRevisionDigest !== source.planRevisionDigest ||
          !currentApproval.targetIds.includes(source.targetId) ||
          !currentApproval.channelIds.includes(source.channelId) ||
          !sameSet(currentApproval.artifactIds, source.artifactIds)) {
          return { kind: "approval_invalid" as const };
        }
        const currentRevision = await lockCurrentPublishingApprovalRevision(tx, currentApproval);
        if (!currentRevision || input.revision.id !== source.planRevisionId ||
          input.revision.definitionDigest !== source.planRevisionDigest ||
          canonicalDigest(currentRevision) !== canonicalDigest(input.revision)) {
          return { kind: "stale_revision" as const };
        }
        const evidenceNow = await verifyCurrentPublishingPlanEvidence(
          tx, currentRevision, input.validationSession.expiresAt,
          [source.targetId], { allowDuePublishAt: true },
        );
        if (!evidenceNow || !validPublishingDeliveryValidationSession({
          session: input.validationSession, approval: currentApproval,
          revision: currentRevision, now: evidenceNow,
        })) return { kind: "validation_stale" as const };
        if (!await lockRecoveryAuthorization(tx, input.authorizationSession, source, evidenceNow)) {
          return { kind: "authorization_stale" as const };
        }
        const acceptedEvent = input.events.find((event) => event.type === "delivery.accepted");
        const retryEvent = input.events.find((event) => event.type === "delivery.retry_requested");
        const scheduledEvent = input.events.find((event) => event.type === "delivery.scheduled");
        const child = input.delivery;
        if (input.events.length !== 3 || !acceptedEvent || !retryEvent || !scheduledEvent ||
          child.workspaceId !== source.workspaceId || child.id !== input.retry.deliveryId ||
          child.sourceDeliveryId !== source.id || child.retryId !== input.retry.id ||
          child.releaseId !== null || child.approvalRequestId !== input.retry.approvalRequestId ||
          child.approvalDecisionId !== input.retry.approvalDecisionId ||
          child.requestingPrincipalId !== currentApproval.requestingPrincipalId ||
          child.requestingKeyId !== currentApproval.requestingKeyId ||
          child.planId !== source.planId || child.planRevisionId !== source.planRevisionId ||
          child.planRevision !== source.planRevision ||
          child.planRevisionDigest !== source.planRevisionDigest ||
          child.targetId !== source.targetId || child.channelId !== source.channelId ||
          !sameSet(child.artifactIds, source.artifactIds) ||
          child.targetSnapshotDigest !== source.targetSnapshotDigest ||
          canonicalDigest(child.targetSnapshot) !== canonicalDigest(source.targetSnapshot) ||
          child.effectGeneration !== 1 || child.effectKey !==
            publishingDeliveryEffectKey(child.workspaceId, child.id, 1) ||
          child.intentDigest !== source.intentDigest ||
          child.providerAdapterContractDigest !== source.providerAdapterContractDigest ||
          child.state !== "scheduled" || child.desiredState !== "publish" ||
          child.nextEffectAttempt !== 1 || child.nextEventSequence !== 4 ||
          child.nextOutboxGeneration !== 2 || child.providerOperationRef !== null ||
          child.latestEffectEvidenceDigest !== null || child.failureClass !== null ||
          child.failureRetryable !== null || child.failureEffectDisposition !== null ||
          child.effectContactStartedAt !== null || child.completedAt !== null ||
          input.effectIdentity.deliveryId !== child.id ||
          input.effectIdentity.generation !== 1 ||
          input.effectIdentity.effectKey !== child.effectKey ||
          input.effectIdentity.intentDigest !== child.intentDigest ||
          input.effectIdentity.providerAdapterContractDigest !==
            child.providerAdapterContractDigest ||
          input.effectIdentity.parentEffectKey !== null ||
          input.effectIdentity.parentGeneration !== null ||
          input.effectIdentity.derivation !== "manual_retry" ||
          input.effectIdentity.sourceEvidenceDigest !== source.latestEffectEvidenceDigest ||
          acceptedEvent.sequence !== 1 || retryEvent.sequence !== 2 ||
          scheduledEvent.sequence !== 3 ||
          acceptedEvent.deliveryId !== child.id || retryEvent.deliveryId !== child.id ||
          scheduledEvent.deliveryId !== child.id ||
          acceptedEvent.evidence.origin !== "retry" ||
          acceptedEvent.evidence.releaseId !== null ||
          acceptedEvent.evidence.sourceDeliveryId !== source.id ||
          acceptedEvent.evidence.retryId !== input.retry.id ||
          acceptedEvent.evidence.approvalRequestId !== input.retry.approvalRequestId ||
          acceptedEvent.evidence.approvalDecisionId !== input.retry.approvalDecisionId ||
          acceptedEvent.evidence.targetSnapshotDigest !== child.targetSnapshotDigest ||
          retryEvent.evidence.retryId !== input.retry.id ||
          retryEvent.evidence.sourceDeliveryId !== source.id ||
          retryEvent.evidence.deliveryId !== child.id ||
          retryEvent.evidence.effectKey !== child.effectKey ||
          input.outboxIntent.purpose !== "publish" ||
          input.outboxIntent.generation !== 1 ||
          input.outboxIntent.deliveryId !== child.id || input.outboxIntent.state !== "pending") {
          return { kind: "unavailable" as const };
        }
        if (input.approvalConsumption.workspaceId !== child.workspaceId ||
          input.approvalConsumption.approvalRequestId !== currentApproval.id ||
          input.approvalConsumption.approvalDecisionId !== currentApproval.decision.id ||
          input.approvalConsumption.sourceDeliveryId !== source.id ||
          input.approvalConsumption.deliveryId !== child.id ||
          input.approvalConsumption.sourceEvidenceDigest !==
            source.latestEffectEvidenceDigest ||
          input.approvalConsumption.requestingPrincipalId !==
            currentApproval.requestingPrincipalId ||
          input.approvalConsumption.requestingKeyId !== currentApproval.requestingKeyId ||
          canonicalDigest(input.approvalConsumption.actor) !==
            canonicalDigest(input.retry.actor) ||
          input.approvalConsumption.capability !== "publishing_deliveries.retry@1" ||
          input.approvalConsumption.authorizationContractDigest !==
            input.authorizationSession.contractDigest ||
          input.approvalConsumption.authorizationEvidenceRef !==
            input.authorizationSession.evidenceRef ||
          !sameOrder(input.approvalConsumption.authorizedResources.channelIds,
            [source.channelId]) ||
          !sameSet(input.approvalConsumption.authorizedResources.artifactIds,
            source.artifactIds)) return { kind: "approval_invalid" as const };
        const finalNow = await verifyCurrentPublishingPlanEvidence(
          tx, currentRevision, input.validationSession.expiresAt,
          [source.targetId], { allowDuePublishAt: true },
        );
        if (!finalNow || !await lockRecoveryAuthorization(
          tx, input.authorizationSession, source, finalNow,
        )) return { kind: "authorization_stale" as const };
        const writtenChild = { ...child, acceptedAt: finalNow, scheduledAt: finalNow,
          updatedAt: finalNow };
        await tx.insert(runtimePublishingDeliveries).values({
          ...writtenChild,
          targetOrdinal: 0,
          validationEvidenceDigest: currentApproval.validation.evidenceDigest,
        });
        await tx.insert(runtimePublishingDeliveryRetryApprovalConsumptions).values({
          workspaceId: input.approvalConsumption.workspaceId,
          id: input.approvalConsumption.id,
          approvalRequestId: input.approvalConsumption.approvalRequestId,
          approvalDecisionId: input.approvalConsumption.approvalDecisionId,
          sourceDeliveryId: input.approvalConsumption.sourceDeliveryId,
          deliveryId: input.approvalConsumption.deliveryId,
          sourceEvidenceDigest: input.approvalConsumption.sourceEvidenceDigest,
          requestingPrincipalId: input.approvalConsumption.requestingPrincipalId,
          requestingKeyId: input.approvalConsumption.requestingKeyId,
          actorKind: input.approvalConsumption.actor.kind,
          actorId: input.approvalConsumption.actor.kind === "agent"
            ? input.approvalConsumption.actor.principalId
            : input.approvalConsumption.actor.userId,
          actorUserId: input.approvalConsumption.actor.kind === "human"
            ? input.approvalConsumption.actor.userId : null,
          capability: input.approvalConsumption.capability,
          authorizationContractDigest: input.approvalConsumption.authorizationContractDigest,
          authorizationEvidenceRef: input.approvalConsumption.authorizationEvidenceRef,
          authorizedResources: input.approvalConsumption.authorizedResources,
          consumedAt: now,
        });
        await tx.insert(runtimePublishingDeliveryEffectIdentities).values({
          workspaceId: input.effectIdentity.workspaceId,
          id: `pdei_${randomUUID().replaceAll("-", "")}`,
          deliveryId: input.effectIdentity.deliveryId,
          generation: input.effectIdentity.generation,
          effectKey: input.effectIdentity.effectKey,
          intentDigest: input.effectIdentity.intentDigest,
          providerAdapterContractDigest: input.effectIdentity.providerAdapterContractDigest,
          parentEffectKey: input.effectIdentity.parentEffectKey,
          parentGeneration: input.effectIdentity.parentGeneration,
          derivation: input.effectIdentity.derivation,
          sourceEvidenceDigest: input.effectIdentity.sourceEvidenceDigest,
          createdAt: finalNow,
        });
        await tx.insert(runtimePublishingDeliveryEvents).values(input.events.map((event) => ({
          workspaceId: event.workspaceId, id: event.id,
          deliveryId: event.deliveryId, sequence: event.sequence,
          type: event.type, evidence: event.evidence, occurredAt: finalNow,
        })));
        await tx.insert(runtimePublishingDeliveryOutboxIntents).values(input.outboxIntent);
        await tx.insert(runtimePublishingDeliveryRetryReceipts).values({
          workspaceId: input.retry.workspaceId,
          id: input.retry.id,
          sourceDeliveryId: input.retry.sourceDeliveryId,
          deliveryId: input.retry.deliveryId,
          actorKind: input.retry.actor.kind,
          actorId,
          idempotencyKey: mutation.idempotencyKey,
          requestFingerprint: mutation.requestFingerprint,
          principalId: input.retry.actor.kind === "agent" ? input.retry.actor.principalId : null,
          keyId: input.retry.actor.kind === "agent" ? input.retry.actor.keyId : null,
          userId: input.retry.actor.kind === "human" ? input.retry.actor.userId : null,
          capability: "publishing_deliveries.retry@1",
          authorizationSessionId: input.authorizationSession.id,
          authorizationContractDigest: input.authorizationSession.contractDigest,
          authorizationAdmissionEvidenceRef: input.authorizationSession.admissionEvidenceRef,
          authorizationEvidenceRef: input.authorizationSession.evidenceRef,
          authorizationEvidenceDigest: input.authorizationSession.evidenceDigest,
          authorizedResources: input.authorizationSession.resources,
          authorityGrants: input.authorizationSession.humanGrants,
          authorizationIssuedAt: input.authorizationSession.issuedAt,
          authorizationExpiresAt: input.authorizationSession.expiresAt,
          sourceEvidenceDigest: input.retry.sourceEvidenceDigest,
          sourceEffectGeneration: input.retry.sourceEffectGeneration,
          sourceEffectKey: input.retry.sourceEffectKey,
          sourceIntentDigest: input.retry.sourceIntentDigest,
          sourceProviderAdapterContractDigest:
            input.retry.sourceProviderAdapterContractDigest,
          sourceFailureClass: input.retry.sourceFailureClass,
          sourceEffectDisposition: input.retry.sourceEffectDisposition,
          approvalRequestId: input.retry.approvalRequestId,
          approvalDecisionId: input.retry.approvalDecisionId,
          approvalConsumptionId: input.approvalConsumption.id,
          eventSequence: retryEvent.sequence,
          outboxGeneration: input.outboxIntent.generation,
          requestedAt: now,
          retryAt: input.outboxIntent.availableAt,
        });
        const created = requireWrittenRecord(rehydratePublishingDelivery({
          ...writtenChild,
          targetOrdinal: 0,
          validationEvidenceDigest: currentApproval.validation.evidenceDigest,
          confirmationAttempts: 0,
        }));
        return { kind: "created" as const, retry: { ...input.retry, requestedAt: finalNow },
          delivery: created, events: input.events.map((event) => ({ ...event, occurredAt: finalNow })) };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async getReconciliation(
    input: Parameters<PublishingDeliveryRepository["getReconciliation"]>[0],
  ): Promise<PublishingDeliveryReconciliationProjection | null> {
    try {
      const actorId = input.actor.kind === "agent" ? input.actor.principalId : input.actor.userId;
      const requests = await this.database().select().from(
        runtimePublishingDeliveryReconciliationRequests,
      ).where(and(
        eq(runtimePublishingDeliveryReconciliationRequests.workspaceId, input.workspaceId),
        eq(runtimePublishingDeliveryReconciliationRequests.deliveryId, input.deliveryId),
        eq(runtimePublishingDeliveryReconciliationRequests.sourceEvidenceDigest,
          input.sourceEvidenceDigest),
        eq(runtimePublishingDeliveryReconciliationRequests.actorKind, input.actor.kind),
        eq(runtimePublishingDeliveryReconciliationRequests.actorId, actorId),
      )).limit(1);
      const request = requests[0] ? rehydrateReconciliationRequest(requests[0]) : null;
      if (!request) return null;
      const results = await this.database().select().from(
        runtimePublishingDeliveryReconciliationReceipts,
      ).where(and(
        eq(runtimePublishingDeliveryReconciliationReceipts.workspaceId, input.workspaceId),
        eq(runtimePublishingDeliveryReconciliationReceipts.reconciliationId, request.id),
      )).limit(1);
      const result = results[0] ? rehydrateReconciliationResult(results[0]) : null;
      return { request, result };
    } catch {
      return null;
    }
  }

  async requestReconciliation(
    input: Parameters<PublishingDeliveryRepository["requestReconciliation"]>[0],
  ) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const request = input.reconciliation;
        const actorId = request.actor.kind === "agent"
          ? request.actor.principalId : request.actor.userId;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
          ${`publishing-delivery-reconciliation:${request.workspaceId}:${request.deliveryId}:${request.sourceEvidenceDigest}`},
          0
        ))`);
        const priorRows = await tx.select().from(runtimePublishingDeliveryReconciliationRequests)
          .where(and(
            eq(runtimePublishingDeliveryReconciliationRequests.workspaceId, request.workspaceId),
            eq(runtimePublishingDeliveryReconciliationRequests.deliveryId, request.deliveryId),
            eq(runtimePublishingDeliveryReconciliationRequests.sourceEvidenceDigest,
              request.sourceEvidenceDigest),
          )).limit(1).for("update");
        if (priorRows[0]) {
          const replay = rehydrateReconciliationRequest(priorRows[0]);
          if (!replay || replay.actor.kind !== request.actor.kind ||
            (replay.actor.kind === "agent"
              ? replay.actor.principalId !== actorId
              : replay.actor.userId !== actorId)) {
            return { kind: "reconciliation_conflict" as const };
          }
          const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
            eq(runtimePublishingDeliveries.workspaceId, request.workspaceId),
            eq(runtimePublishingDeliveries.id, request.deliveryId),
          )).limit(1);
          const delivery = deliveryRows[0] ? rehydratePublishingDelivery(deliveryRows[0]) : null;
          if (delivery && publishingDeliveryReconciliationExhausted(delivery)) {
            return { kind: "not_reconcilable" as const };
          }
          const events = await tx.select().from(runtimePublishingDeliveryEvents).where(and(
            eq(runtimePublishingDeliveryEvents.workspaceId, request.workspaceId),
            eq(runtimePublishingDeliveryEvents.deliveryId, request.deliveryId),
            eq(runtimePublishingDeliveryEvents.type, "delivery.reconciliation_requested"),
          )).orderBy(desc(runtimePublishingDeliveryEvents.sequence)).limit(1);
          const event = events[0] ? rehydratePublishingDeliveryEvent(events[0]) : null;
          return delivery && event?.type === "delivery.reconciliation_requested" &&
            event.evidence.reconciliationId === replay.id
            ? { kind: "replayed" as const, reconciliation: replay, delivery, event }
            : { kind: "unavailable" as const };
        }
        const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, request.workspaceId),
          eq(runtimePublishingDeliveries.id, request.deliveryId),
        )).limit(1).for("update");
        const delivery = deliveryRows[0] ? rehydratePublishingDelivery(deliveryRows[0]) : null;
        if (!delivery) return { kind: "not_found" as const };
        if (publishingDeliveryReconciliationExhausted(delivery) ||
          delivery.state !== "outcome_unknown" ||
          delivery.latestEffectEvidenceDigest !== request.sourceEvidenceDigest ||
          delivery.effectKey !== request.sourceEffectKey ||
          delivery.effectGeneration !== request.sourceEffectGeneration ||
          delivery.intentDigest !== request.sourceIntentDigest ||
          delivery.providerAdapterContractDigest !== request.sourceProviderAdapterContractDigest ||
          delivery.providerOperationRef !== request.sourceProviderOperationRef) {
          return { kind: "not_reconcilable" as const };
        }
        if (input.authorizationSession.id !== request.authorization.id ||
          input.authorizationSession.capability !== "publishing_deliveries.reconcile@1" ||
          input.authorizationSession.expiresAt <= now ||
          canonicalDigest(input.authorizationSession) !== canonicalDigest(request.authorization) ||
          !await lockRecoveryAuthorization(tx, input.authorizationSession, delivery, now)) {
          return { kind: "authorization_stale" as const };
        }
        if (input.event.type !== "delivery.reconciliation_requested" ||
          input.event.sequence !== delivery.nextEventSequence ||
          input.outboxIntent.purpose !== "reconcile" ||
          input.outboxIntent.generation !== delivery.nextOutboxGeneration ||
          input.outboxIntent.deliveryId !== delivery.id || input.outboxIntent.state !== "pending") {
          return { kind: "unavailable" as const };
        }
        await tx.insert(runtimePublishingDeliveryReconciliationRequests).values({
          workspaceId: request.workspaceId,
          id: request.id,
          deliveryId: request.deliveryId,
          actorKind: request.actor.kind,
          actorId,
          principalId: request.actor.kind === "agent" ? request.actor.principalId : null,
          keyId: request.actor.kind === "agent" ? request.actor.keyId : null,
          userId: request.actor.kind === "human" ? request.actor.userId : null,
          capability: "publishing_deliveries.reconcile@1",
          authorizationSessionId: request.authorization.id,
          authorizationContractDigest: request.authorization.contractDigest,
          authorizationAdmissionEvidenceRef: request.authorization.admissionEvidenceRef,
          authorizationEvidenceRef: request.authorization.evidenceRef,
          authorizationEvidenceDigest: request.authorization.evidenceDigest,
          authorizedResources: request.authorization.resources,
          authorityGrants: request.authorization.humanGrants,
          authorizationIssuedAt: request.authorization.issuedAt,
          authorizationExpiresAt: request.authorization.expiresAt,
          sourceEvidenceDigest: request.sourceEvidenceDigest,
          effectGeneration: request.sourceEffectGeneration,
          effectKey: request.sourceEffectKey,
          intentDigest: request.sourceIntentDigest,
          providerAdapterContractDigest: request.sourceProviderAdapterContractDigest,
          providerOperationRef: request.sourceProviderOperationRef,
          eventSequence: input.event.sequence,
          requestedAt: now,
        });
        await tx.insert(runtimePublishingDeliveryEvents).values({
          workspaceId: input.event.workspaceId, id: input.event.id,
          deliveryId: input.event.deliveryId, sequence: input.event.sequence,
          type: input.event.type, evidence: input.event.evidence, occurredAt: now,
        });
        await tx.insert(runtimePublishingDeliveryOutboxIntents).values(input.outboxIntent);
        const updatedRows = await tx.update(runtimePublishingDeliveries).set({
          nextEventSequence: delivery.nextEventSequence + 1,
          nextOutboxGeneration: delivery.nextOutboxGeneration + 1,
          updatedAt: now,
        }).where(and(
          eq(runtimePublishingDeliveries.workspaceId, delivery.workspaceId),
          eq(runtimePublishingDeliveries.id, delivery.id),
        )).returning();
        const updated = requireWrittenRecord(updatedRows[0]
          ? rehydratePublishingDelivery(updatedRows[0]) : null);
        return { kind: "created" as const, reconciliation: request, delivery: updated,
          event: input.event };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
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
        if (["succeeded", "failed_transient", "failed_terminal", "outcome_unknown", "cancelled"]
          .includes(delivery.state)) {
          return { kind: "terminal" as const };
        }
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        if (delivery.state === "blocked" &&
          (!delivery.readinessRetryAt || delivery.readinessRetryAt > now)) {
          return { kind: "not_due" as const };
        }
        const existingRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases)
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
          )).limit(1).for("update");
        const current = existingRows[0];
        if (current && current.releasedAt === null && current.expiresAt > now) {
          return { kind: "busy" as const };
        }
        if (delivery.desiredState === "publish" &&
          (delivery.state === "scheduled" || delivery.state === "dispatching") &&
          delivery.effectContactStartedAt !== null && delivery.providerOperationRef === null) {
          if (!current || current.fence <= BigInt(0) || !delivery.intentDigest ||
            !delivery.providerAdapterContractDigest) return { kind: "unavailable" as const };
          const evidenceDigest = canonicalDigest({
            schema: "publishing-delivery-contact-recovery-evidence/v1",
            deliveryId: delivery.id,
            effectKey: delivery.effectKey,
            effectGeneration: delivery.effectGeneration,
            effectContactStartedAt: delivery.effectContactStartedAt.toISOString(),
            failureCode: "PROVIDER_CONTACT_OUTCOME_UNKNOWN",
          });
          const event: PublishingDeliveryEvent = {
            schema: "publishing-delivery-event/v1",
            id: `pde_${randomUUID().replaceAll("-", "")}`,
            workspaceId: delivery.workspaceId,
            deliveryId: delivery.id,
            sequence: delivery.nextEventSequence,
            type: "publication.outcome_unknown",
            evidence: {
              effectKey: delivery.effectKey,
              providerOperationRef: null,
              evidenceDigest,
              failureCode: "PROVIDER_CONTACT_OUTCOME_UNKNOWN",
            },
            occurredAt: now,
          };
          await tx.insert(runtimePublishingDeliveryEvents).values(event);
          await tx.insert(runtimePublishingDeliveryEffectReceipts).values({
            workspaceId: delivery.workspaceId,
            id: `pder_${randomUUID().replaceAll("-", "")}`,
            deliveryId: delivery.id,
            effectGeneration: delivery.effectGeneration,
            effectAttempt: deliveryRows[0]!.nextEffectAttempt,
            effectKey: delivery.effectKey,
            intentDigest: delivery.intentDigest,
            providerAdapterContractDigest: delivery.providerAdapterContractDigest,
            mode: "launch",
            executionFence: current.fence,
            result: "outcome_unknown",
            effectDisposition: "unknown",
            failureClass: null,
            failureRetryable: null,
            providerOperationRef: null,
            evidenceDigest,
            failureCode: "PROVIDER_CONTACT_OUTCOME_UNKNOWN",
            eventSequence: event.sequence,
            occurredAt: now,
          });
          await tx.update(runtimePublishingDeliveries).set({
            state: "outcome_unknown",
            latestEffectEvidenceDigest: evidenceDigest,
            failureCode: "PROVIDER_CONTACT_OUTCOME_UNKNOWN",
            failureEffectDisposition: "ambiguous",
            completedAt: now,
            nextEffectAttempt: Math.min(9, delivery.nextEffectAttempt + 1),
            nextEventSequence: delivery.nextEventSequence + 1,
            updatedAt: now,
          }).where(and(
            eq(runtimePublishingDeliveries.workspaceId, delivery.workspaceId),
            eq(runtimePublishingDeliveries.id, delivery.id),
          ));
          if (current.releasedAt === null) {
            await tx.update(runtimePublishingDeliveryExecutionLeases).set({ releasedAt: now })
              .where(and(
                eq(runtimePublishingDeliveryExecutionLeases.workspaceId, delivery.workspaceId),
                eq(runtimePublishingDeliveryExecutionLeases.deliveryId, delivery.id),
                eq(runtimePublishingDeliveryExecutionLeases.fence, current.fence),
              ));
          }
          return { kind: "terminal" as const };
        }
        if (delivery.desiredState === "cancel" &&
          (delivery.state === "scheduled" || delivery.state === "dispatching") &&
          delivery.effectContactStartedAt !== null && delivery.providerOperationRef === null) {
          const cancellationRows = await tx.select()
            .from(runtimePublishingDeliveryCancellations).where(and(
              eq(runtimePublishingDeliveryCancellations.workspaceId, input.workspaceId),
              eq(runtimePublishingDeliveryCancellations.deliveryId, input.deliveryId),
            )).limit(1);
          const cancellation = cancellationRows[0]
            ? rehydratePublishingDeliveryCancellation(cancellationRows[0])
            : null;
          if (!cancellation) throw new PublishingDeliveryTransactionRollback();
          const evidenceDigest = canonicalDigest({
            schema: "publishing-delivery-cancellation-unknown/v1",
            cancellationId: cancellation.id,
            effectKey: delivery.effectKey,
          });
          const event: PublishingDeliveryEvent = {
            schema: "publishing-delivery-event/v1",
            id: `pde_${randomUUID().replaceAll("-", "")}`,
            workspaceId: input.workspaceId,
            deliveryId: input.deliveryId,
            sequence: delivery.nextEventSequence,
            type: "publication.outcome_unknown",
            evidence: {
              effectKey: delivery.effectKey,
              providerOperationRef: null,
              evidenceDigest,
              failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
            },
            occurredAt: now,
          };
          await tx.insert(runtimePublishingDeliveryEvents).values({
            workspaceId: event.workspaceId,
            id: event.id,
            deliveryId: event.deliveryId,
            sequence: event.sequence,
            type: event.type,
            evidence: event.evidence,
            occurredAt: event.occurredAt,
          });
          await tx.update(runtimePublishingDeliveries).set({
            state: "outcome_unknown",
            latestEffectEvidenceDigest: evidenceDigest,
            failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
            completedAt: now,
            nextEventSequence: delivery.nextEventSequence + 1,
            updatedAt: now,
          }).where(and(
            eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveries.id, input.deliveryId),
          ));
          if (current && current.releasedAt === null) {
            await tx.update(runtimePublishingDeliveryExecutionLeases).set({ releasedAt: now })
              .where(and(
                eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
                eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
                eq(runtimePublishingDeliveryExecutionLeases.fence, current.fence),
              ));
          }
          return { kind: "terminal" as const };
        }
        if (delivery.desiredState === "cancel" &&
          delivery.state !== "confirmation_pending") return { kind: "terminal" as const };
        const outbox = await tx.select().from(runtimePublishingDeliveryOutboxIntents).where(and(
          eq(runtimePublishingDeliveryOutboxIntents.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryOutboxIntents.deliveryId, input.deliveryId),
        )).orderBy(desc(runtimePublishingDeliveryOutboxIntents.generation)).limit(1).for("update");
        if (!outbox[0] || outbox[0].availableAt > now ||
          (outbox[0].state !== "claimed" && outbox[0].state !== "delivered") ||
          outbox[0].purpose !== "publish" ||
          outbox[0].generation !== delivery.nextOutboxGeneration - 1 ||
          delivery.publishAt > now) return { kind: "not_due" as const };
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
        const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = deliveryRows[0]
          ? rehydratePublishingDelivery(deliveryRows[0])
          : null;
        if (!delivery || ["succeeded", "failed_transient", "failed_terminal", "outcome_unknown", "cancelled"]
          .includes(delivery.state) ||
          (delivery.desiredState === "cancel" &&
            !((delivery.state === "dispatching" &&
              delivery.effectContactStartedAt !== null) ||
              delivery.state === "confirmation_pending"))) return null;
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
        const rows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = rows[0] ? rehydratePublishingDelivery(rows[0]) : null;
        if (!delivery || delivery.effectKey !== input.effectKey ||
          (delivery.intentDigest && delivery.intentDigest !== input.intentDigest) ||
          (delivery.providerAdapterContractDigest &&
            delivery.providerAdapterContractDigest !== input.providerAdapterContractDigest) ||
          !DIGEST.test(input.intentDigest) || !DIGEST.test(input.providerAdapterContractDigest)) {
          return { kind: "stale" as const };
        }
        if (delivery.desiredState === "cancel" &&
          delivery.state !== "confirmation_pending") return { kind: "stale" as const };
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases).where(and(
          eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
        )).limit(1).for("update");
        const lease = leaseRows[0];
        if (!lease || lease.workerId !== input.workerId || lease.leaseToken !== input.leaseToken ||
          lease.fence !== input.fence || lease.releasedAt || lease.expiresAt <= now) {
          return { kind: "stale" as const };
        }
        if ((delivery.state === "dispatching" || delivery.state === "confirmation_pending" ||
          delivery.state === "blocked") &&
          delivery.intentDigest === input.intentDigest &&
          delivery.providerAdapterContractDigest === input.providerAdapterContractDigest) {
          const events = await tx.select().from(runtimePublishingDeliveryEvents).where(and(
            eq(runtimePublishingDeliveryEvents.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryEvents.deliveryId, input.deliveryId),
            eq(runtimePublishingDeliveryEvents.type, "effect.prepared"),
          )).orderBy(desc(runtimePublishingDeliveryEvents.sequence)).limit(1);
          const event = events[0] ? rehydratePublishingDeliveryEvent(events[0]) : null;
          return event ? { kind: "replayed" as const, delivery, event } : { kind: "unavailable" as const };
        }
        if (delivery.state !== "scheduled") return { kind: "stale" as const };
        let identityRows = await tx.select().from(runtimePublishingDeliveryEffectIdentities)
          .where(and(
            eq(runtimePublishingDeliveryEffectIdentities.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryEffectIdentities.deliveryId, input.deliveryId),
            eq(runtimePublishingDeliveryEffectIdentities.generation, delivery.effectGeneration),
          )).limit(1).for("update");
        if (!identityRows[0] && delivery.effectGeneration === 1) {
          identityRows = await tx.insert(runtimePublishingDeliveryEffectIdentities).values({
            workspaceId: input.workspaceId,
            id: `pdei_${randomUUID().replaceAll("-", "")}`,
            deliveryId: input.deliveryId,
            generation: 1,
            effectKey: input.effectKey,
            intentDigest: null,
            providerAdapterContractDigest: null,
            parentEffectKey: null,
            parentGeneration: null,
            derivation: "release",
            sourceEvidenceDigest: null,
            createdAt: now,
          }).returning();
        }
        const identity = identityRows[0];
        if (!identity || identity.effectKey !== input.effectKey ||
          (identity.intentDigest !== null && identity.intentDigest !== input.intentDigest) ||
          (identity.providerAdapterContractDigest !== null &&
            identity.providerAdapterContractDigest !== input.providerAdapterContractDigest)) {
          return { kind: "stale" as const };
        }
        if (identity.intentDigest === null) {
          const sealed = await tx.update(runtimePublishingDeliveryEffectIdentities).set({
            intentDigest: input.intentDigest,
            providerAdapterContractDigest: input.providerAdapterContractDigest,
          }).where(and(
            eq(runtimePublishingDeliveryEffectIdentities.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryEffectIdentities.id, identity.id),
            isNull(runtimePublishingDeliveryEffectIdentities.intentDigest),
            isNull(runtimePublishingDeliveryEffectIdentities.providerAdapterContractDigest),
          )).returning({ id: runtimePublishingDeliveryEffectIdentities.id });
          if (!sealed[0]) return { kind: "stale" as const };
        }
        const event: PublishingDeliveryEvent = {
          schema: "publishing-delivery-event/v1",
          id: `pde_${randomUUID().replaceAll("-", "")}`,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          sequence: delivery.nextEventSequence,
          type: "effect.prepared",
          evidence: {
            effectKey: input.effectKey,
            effectGeneration: delivery.effectGeneration,
            intentDigest: input.intentDigest,
            providerAdapterContractDigest: input.providerAdapterContractDigest,
          },
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
          providerAdapterContractDigest: input.providerAdapterContractDigest,
          latestEffectEvidenceDigest: null,
          failureCode: null,
          failureClass: null,
          failureRetryable: null,
          failureEffectDisposition: null,
          dispatchStartedAt: delivery.dispatchStartedAt ?? now,
          effectContactStartedAt: null,
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

  async beginEffectContact(
    input: Parameters<PublishingDeliveryRepository["beginEffectContact"]>[0],
  ) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = deliveryRows[0]
          ? rehydratePublishingDelivery(deliveryRows[0])
          : null;
        if (!delivery || delivery.effectKey !== input.effectKey ||
          delivery.intentDigest !== input.intentDigest ||
          delivery.providerAdapterContractDigest !== input.providerAdapterContractDigest ||
          delivery.effectGeneration !== input.readinessSession.effectGeneration) {
          return { kind: "stale" as const };
        }
        // Attempt 9 is an exhausted sentinel. Reject before readiness checks or
        // ordered evidence writes so an exhausted launch cannot strand an
        // orphan contact event in an otherwise committed transaction.
        if (deliveryRows[0]!.nextEffectAttempt > 8) {
          return { kind: "stale" as const };
        }
        const readiness = input.readinessSession;
        const expectedReadinessDigest = canonicalDigest({
          schema: "publishing-delivery-execution-readiness-evidence/v1",
          workspaceId: readiness.workspaceId,
          deliveryId: readiness.deliveryId,
          effectKey: readiness.effectKey,
          effectGeneration: readiness.effectGeneration,
          intentDigest: readiness.intentDigest,
          providerAdapterContractDigest: readiness.providerAdapterContractDigest,
          mode: readiness.mode,
          authorizationEvidenceDigest: readiness.authorizationEvidenceDigest,
          approvalEvidenceDigest: readiness.approvalEvidenceDigest,
          channelEvidenceDigest: readiness.channelEvidenceDigest,
          credentialEvidenceDigest: readiness.credentialEvidenceDigest,
          validationEvidenceDigest: readiness.validationEvidenceDigest,
          evaluatedAt: readiness.evaluatedAt.toISOString(),
          expiresAt: readiness.expiresAt.toISOString(),
        });
        if (readiness.schema !== "publishing-delivery-execution-readiness/v1" ||
          readiness.id !== `pdrdy_${expectedReadinessDigest.slice("sha256:".length)}` ||
          readiness.evidenceDigest !== expectedReadinessDigest || readiness.workspaceId !== input.workspaceId ||
          readiness.deliveryId !== input.deliveryId || readiness.effectKey !== input.effectKey ||
          readiness.intentDigest !== input.intentDigest ||
          readiness.providerAdapterContractDigest !== input.providerAdapterContractDigest ||
          readiness.mode !== "launch" || readiness.expiresAt <= now ||
          readiness.expiresAt.getTime() - readiness.evaluatedAt.getTime() > READINESS_TTL_MS) {
          return { kind: "stale" as const };
        }
        const currentReadiness = await evaluateExecutionReadiness(tx, {
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          effectKey: input.effectKey,
          effectGeneration: delivery.effectGeneration,
          intentDigest: input.intentDigest,
          providerAdapterContractDigest: input.providerAdapterContractDigest,
          evaluatedAt: now,
        });
        if (currentReadiness.kind !== "ready") return currentReadiness;
        if (currentReadiness.session.authorizationEvidenceDigest !== readiness.authorizationEvidenceDigest ||
          currentReadiness.session.approvalEvidenceDigest !== readiness.approvalEvidenceDigest ||
          currentReadiness.session.channelEvidenceDigest !== readiness.channelEvidenceDigest ||
          currentReadiness.session.credentialEvidenceDigest !== readiness.credentialEvidenceDigest ||
          currentReadiness.session.validationEvidenceDigest !== readiness.validationEvidenceDigest) {
          return { kind: "stale" as const };
        }
        if (delivery.desiredState === "cancel" &&
          delivery.state !== "confirmation_pending") return { kind: "cancelled" as const };
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases)
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
          )).limit(1).for("update");
        const lease = leaseRows[0];
        if (!lease || lease.workerId !== input.workerId ||
          lease.leaseToken !== input.leaseToken || lease.fence !== input.fence ||
          lease.releasedAt || lease.expiresAt <= now) return { kind: "stale" as const };
        if (delivery.effectContactStartedAt !== null) {
          const eventRows = await tx.select().from(runtimePublishingDeliveryEvents)
            .where(and(
              eq(runtimePublishingDeliveryEvents.workspaceId, input.workspaceId),
              eq(runtimePublishingDeliveryEvents.deliveryId, input.deliveryId),
              eq(runtimePublishingDeliveryEvents.type, "effect.contact_started"),
            )).orderBy(desc(runtimePublishingDeliveryEvents.sequence)).limit(1);
          const event = eventRows[0]
            ? rehydratePublishingDeliveryEvent(eventRows[0])
            : null;
          if (event) {
            return event.type === "effect.contact_started" &&
              event.evidence.effectKey === input.effectKey &&
              event.evidence.intentDigest === input.intentDigest
              ? { kind: "replayed" as const, delivery, event }
              : { kind: "unavailable" as const };
          }
          // #167 rows were conservatively backfilled with a contact timestamp
          // before contact events existed. Retain one ordered marker before any
          // resumed launch/observation instead of stranding the Delivery.
          if (delivery.state !== "dispatching" &&
            delivery.state !== "confirmation_pending") {
            return { kind: "stale" as const };
          }
          const legacyEvent: PublishingDeliveryEvent = {
            schema: "publishing-delivery-event/v1",
            id: `pde_${randomUUID().replaceAll("-", "")}`,
            workspaceId: input.workspaceId,
            deliveryId: input.deliveryId,
            sequence: delivery.nextEventSequence,
            type: "effect.contact_started",
            evidence: {
              effectKey: input.effectKey,
              effectGeneration: delivery.effectGeneration,
              intentDigest: input.intentDigest,
              providerAdapterContractDigest: input.providerAdapterContractDigest,
              readinessEvidenceDigest: readiness.evidenceDigest,
            },
            occurredAt: now,
          };
          await tx.insert(runtimePublishingDeliveryEvents).values({
            workspaceId: legacyEvent.workspaceId,
            id: legacyEvent.id,
            deliveryId: legacyEvent.deliveryId,
            sequence: legacyEvent.sequence,
            type: legacyEvent.type,
            evidence: legacyEvent.evidence,
            occurredAt: legacyEvent.occurredAt,
          });
          const reconciledRows = await tx.update(runtimePublishingDeliveries).set({
            nextEventSequence: delivery.nextEventSequence + 1,
            updatedAt: now,
          }).where(and(
            eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveries.id, input.deliveryId),
          )).returning();
          const reconciled = requireWrittenRecord(
            reconciledRows[0]
              ? rehydratePublishingDelivery(reconciledRows[0])
              : null,
          );
          return { kind: "started" as const, delivery: reconciled, event: legacyEvent };
        }
        if (delivery.desiredState !== "publish" ||
          (delivery.state !== "dispatching" && delivery.state !== "blocked")) {
          return delivery.desiredState === "cancel"
            ? { kind: "cancelled" as const }
            : { kind: "stale" as const };
        }
        const resumedEvent: PublishingDeliveryEvent | null =
          delivery.state === "blocked" && delivery.readinessBlockCode &&
            delivery.readinessEvidenceDigest
            ? {
                schema: "publishing-delivery-event/v1",
                id: `pde_${randomUUID().replaceAll("-", "")}`,
                workspaceId: input.workspaceId,
                deliveryId: input.deliveryId,
                sequence: delivery.nextEventSequence,
                type: "delivery.resumed",
                evidence: {
                  priorFailureCode: delivery.readinessBlockCode,
                  priorEvidenceDigest: delivery.readinessEvidenceDigest,
                  readinessEvidenceDigest: readiness.evidenceDigest,
                },
                occurredAt: now,
              }
            : null;
        if (resumedEvent) {
          await tx.insert(runtimePublishingDeliveryEvents).values({
            workspaceId: resumedEvent.workspaceId, id: resumedEvent.id,
            deliveryId: resumedEvent.deliveryId, sequence: resumedEvent.sequence,
            type: resumedEvent.type, evidence: resumedEvent.evidence, occurredAt: now,
          });
        }
        const contactSequence = delivery.nextEventSequence + (resumedEvent ? 1 : 0);
        const event: PublishingDeliveryEvent = {
          schema: "publishing-delivery-event/v1",
          id: `pde_${randomUUID().replaceAll("-", "")}`,
          workspaceId: input.workspaceId,
          deliveryId: input.deliveryId,
          sequence: contactSequence,
          type: "effect.contact_started",
          evidence: {
            effectKey: input.effectKey,
            effectGeneration: delivery.effectGeneration,
            intentDigest: input.intentDigest,
            providerAdapterContractDigest: input.providerAdapterContractDigest,
            readinessEvidenceDigest: readiness.evidenceDigest,
          },
          occurredAt: now,
        };
        await tx.insert(runtimePublishingDeliveryEvents).values({
          workspaceId: event.workspaceId,
          id: event.id,
          deliveryId: event.deliveryId,
          sequence: event.sequence,
          type: event.type,
          evidence: event.evidence,
          occurredAt: event.occurredAt,
        });
        await tx.insert(runtimePublishingDeliveryReadinessReceipts).values({
          workspaceId: input.workspaceId,
          id: `pdrr_${readiness.evidenceDigest.slice("sha256:".length)}`,
          deliveryId: input.deliveryId,
          effectGeneration: delivery.effectGeneration,
          effectAttempt: deliveryRows[0]!.nextEffectAttempt,
          effectKey: input.effectKey,
          intentDigest: input.intentDigest,
          providerAdapterContractDigest: input.providerAdapterContractDigest,
          executionFence: input.fence,
          // These fields retain the fresh Approval requester. Effect authority
          // itself is rechecked above from the release/retry origin and sealed
          // into authorizationEvidenceDigest (including Human retry authority).
          principalId: delivery.requestingPrincipalId,
          keyId: delivery.requestingKeyId,
          authorizationEvidenceDigest: readiness.authorizationEvidenceDigest,
          approvalRequestId: delivery.approvalRequestId,
          approvalDecisionId: delivery.approvalDecisionId,
          channelStateDigest: readiness.channelEvidenceDigest,
          credentialStateDigest: readiness.credentialEvidenceDigest,
          validationEvidenceDigest: readiness.validationEvidenceDigest,
          validationCurrentStateDigest: readiness.evidenceDigest,
          checkedAt: now,
          expiresAt: readiness.expiresAt,
        });
        const updatedRows = await tx.update(runtimePublishingDeliveries).set({
          state: "dispatching",
          readinessBlockCode: null,
          readinessEvidenceDigest: null,
          readinessBlockedAt: null,
          readinessRetryAt: null,
          readinessBlockCount: 0,
          effectContactStartedAt: now,
          nextEventSequence: contactSequence + 1,
          updatedAt: now,
        }).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).returning();
        const updated = requireWrittenRecord(
          updatedRows[0] ? rehydratePublishingDelivery(updatedRows[0]) : null,
        );
        return { kind: "started" as const, delivery: updated, event };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async blockForReadiness(
    input: Parameters<PublishingDeliveryRepository["blockForReadiness"]>[0],
  ) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now || !DIGEST.test(input.evidenceDigest) || input.retryAt <= now) {
          return { kind: "unavailable" as const };
        }
        const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = deliveryRows[0] ? rehydratePublishingDelivery(deliveryRows[0]) : null;
        if (!delivery || delivery.effectKey !== input.effectKey ||
          delivery.effectContactStartedAt !== null || delivery.providerOperationRef !== null) {
          return { kind: "stale" as const };
        }
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases)
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
          )).limit(1).for("update");
        const lease = leaseRows[0];
        if (lease && lease.releasedAt !== null && delivery.state === "blocked" &&
          delivery.readinessBlockCode === input.failureCode &&
          delivery.readinessEvidenceDigest === input.evidenceDigest &&
          delivery.readinessRetryAt?.getTime() === input.retryAt.getTime()) {
          const rows = await tx.select().from(runtimePublishingDeliveryEvents).where(and(
            eq(runtimePublishingDeliveryEvents.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryEvents.deliveryId, input.deliveryId),
            eq(runtimePublishingDeliveryEvents.type, "delivery.blocked"),
          )).orderBy(desc(runtimePublishingDeliveryEvents.sequence)).limit(1);
          const event = rows[0] ? rehydratePublishingDeliveryEvent(rows[0]) : null;
          return event?.type === "delivery.blocked"
            ? { kind: "replayed" as const, delivery, event }
            : { kind: "unavailable" as const };
        }
        if (!lease || lease.workerId !== input.workerId ||
          lease.leaseToken !== input.leaseToken || lease.fence !== input.fence ||
          lease.releasedAt || lease.expiresAt <= now || delivery.desiredState !== "publish" ||
          (delivery.state !== "dispatching" && delivery.state !== "blocked")) {
          return { kind: "stale" as const };
        }
        const outbox = input.outboxIntent;
        if (outbox.workspaceId !== delivery.workspaceId || outbox.deliveryId !== delivery.id ||
          outbox.purpose !== "publish" || outbox.state !== "pending" ||
          outbox.generation !== delivery.nextOutboxGeneration ||
          outbox.dedupeKey !== publishingDeliveryOutboxDedupeKey(
            delivery.workspaceId, delivery.id, delivery.nextOutboxGeneration,
          ) || outbox.availableAt.getTime() !== input.retryAt.getTime() ||
          outbox.deliveryToken !== null || outbox.claimedAt !== null ||
          outbox.deliveredAt !== null || outbox.deliveryAttempts !== 0) {
          return { kind: "unavailable" as const };
        }
        const priorOutbox = await tx.select({
          generation: runtimePublishingDeliveryOutboxIntents.generation,
        }).from(runtimePublishingDeliveryOutboxIntents).where(and(
          eq(runtimePublishingDeliveryOutboxIntents.workspaceId, delivery.workspaceId),
          eq(runtimePublishingDeliveryOutboxIntents.deliveryId, delivery.id),
        )).orderBy(desc(runtimePublishingDeliveryOutboxIntents.generation)).limit(1).for("share");
        if ((priorOutbox[0]?.generation ?? 0) + 1 !== outbox.generation) {
          return { kind: "unavailable" as const };
        }
        const blockCount = Math.min(2_147_483_647, delivery.readinessBlockCount + 1);
        const event: Extract<PublishingDeliveryEvent, { type: "delivery.blocked" }> = {
          schema: "publishing-delivery-event/v1",
          id: `pde_${randomUUID().replaceAll("-", "")}`,
          workspaceId: delivery.workspaceId,
          deliveryId: delivery.id,
          sequence: delivery.nextEventSequence,
          type: "delivery.blocked",
          evidence: {
            failureCode: input.failureCode,
            evidenceDigest: input.evidenceDigest,
            retryAt: input.retryAt.toISOString(),
            blockCount,
          },
          occurredAt: now,
        };
        await tx.insert(runtimePublishingDeliveryEvents).values(event);
        await tx.insert(runtimePublishingDeliveryOutboxIntents).values(outbox);
        const updatedRows = await tx.update(runtimePublishingDeliveries).set({
          state: "blocked",
          readinessBlockCode: input.failureCode,
          readinessEvidenceDigest: input.evidenceDigest,
          readinessBlockedAt: now,
          readinessRetryAt: input.retryAt,
          readinessBlockCount: blockCount,
          nextEventSequence: delivery.nextEventSequence + 1,
          nextOutboxGeneration: delivery.nextOutboxGeneration + 1,
          updatedAt: now,
        }).where(and(
          eq(runtimePublishingDeliveries.workspaceId, delivery.workspaceId),
          eq(runtimePublishingDeliveries.id, delivery.id),
        )).returning();
        await tx.update(runtimePublishingDeliveryExecutionLeases).set({ releasedAt: now })
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, delivery.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, delivery.id),
            eq(runtimePublishingDeliveryExecutionLeases.fence, input.fence),
          ));
        const updated = requireWrittenRecord(updatedRows[0]
          ? rehydratePublishingDelivery(updatedRows[0]) : null);
        return { kind: "blocked" as const, delivery: updated, event };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async failBeforeEffect(
    input: Parameters<PublishingDeliveryRepository["failBeforeEffect"]>[0],
  ) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const rows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = rows[0] ? rehydratePublishingDelivery(rows[0]) : null;
        if (!delivery || (delivery.state !== "scheduled" && delivery.state !== "dispatching") ||
          delivery.effectContactStartedAt !== null ||
          rows[0]!.nextEffectAttempt > 8 ||
          delivery.effectKey !== input.effectKey || !DIGEST.test(input.evidenceDigest) ||
          !/^[A-Z][A-Z0-9_]{0,79}$/.test(input.failureCode) ||
          !["transient", "terminal"].includes(input.failureClass) ||
          input.retryable !== (input.failureClass === "transient") ||
          input.effectDisposition !== "not_created") {
          return { kind: "stale" as const };
        }
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases).where(and(
          eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
        )).limit(1).for("update");
        const lease = leaseRows[0];
        if (!lease || lease.workerId !== input.workerId || lease.leaseToken !== input.leaseToken ||
          lease.fence !== input.fence || lease.releasedAt || lease.expiresAt <= now) {
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
            effectGeneration: delivery.effectGeneration,
            evidenceDigest: input.evidenceDigest,
            failureCode: input.failureCode,
            failureClass: input.failureClass,
            retryable: input.retryable,
            effectDisposition: "not_created",
          },
          occurredAt: now,
        };
        await tx.insert(runtimePublishingDeliveryEvents).values({
          workspaceId: event.workspaceId, id: event.id, deliveryId: event.deliveryId,
          sequence: event.sequence, type: event.type, evidence: event.evidence,
          occurredAt: now,
        });
        await tx.insert(runtimePublishingDeliveryEffectReceipts).values({
          workspaceId: input.workspaceId,
          id: `pder_${randomUUID().replaceAll("-", "")}`,
          deliveryId: input.deliveryId,
          effectGeneration: delivery.effectGeneration,
          effectAttempt: rows[0]!.nextEffectAttempt,
          effectKey: delivery.effectKey,
          intentDigest: delivery.intentDigest,
          providerAdapterContractDigest: delivery.providerAdapterContractDigest,
          mode: "launch",
          executionFence: input.fence,
          result: input.failureClass === "transient" ? "failed_transient" : "failed_terminal",
          effectDisposition: "not_created",
          failureClass: input.failureClass,
          failureRetryable: input.retryable,
          providerOperationRef: null,
          evidenceDigest: input.evidenceDigest,
          failureCode: input.failureCode,
          eventSequence: event.sequence,
          occurredAt: now,
        });
        const updated = await tx.update(runtimePublishingDeliveries).set({
          state: input.failureClass === "transient" ? "failed_transient" : "failed_terminal",
          providerOperationRef: null,
          latestEffectEvidenceDigest: input.evidenceDigest,
          failureCode: input.failureCode,
          failureClass: input.failureClass,
          failureRetryable: input.retryable,
          failureEffectDisposition: "not_created",
          dispatchStartedAt: null,
          completedAt: now,
          nextEffectAttempt: Math.min(9, rows[0]!.nextEffectAttempt + 1),
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
        const rows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = rows[0] ? rehydratePublishingDelivery(rows[0]) : null;
        if (!delivery || delivery.effectKey !== input.effectKey ||
          delivery.intentDigest !== input.intentDigest) return { kind: "stale" as const };
        const normalized = normalizePublishingDeliverySettlement({
          desiredState: delivery.desiredState,
          outcome: input.outcome,
          retryOutboxIntent: input.retryOutboxIntent,
        });
        let outcome: Parameters<PublishingDeliveryRepository["settleEffect"]>[0]["outcome"] =
          normalized.outcome;
        let retryOutboxIntent = normalized.retryOutboxIntent;
        const confirmationCap = outcome.kind === "confirmation_pending"
          ? normalizePublishingDeliveryConfirmationCap({
              deliveryState: delivery.state === "outcome_unknown" &&
                  delivery.failureCode === "CONFIRMATION_ATTEMPTS_EXHAUSTED"
                ? "confirmation_pending" : delivery.state,
              confirmationAttempts: rows[0]!.confirmationAttempts,
              deliveryId: delivery.id,
              effectKey: delivery.effectKey,
              effectGeneration: delivery.effectGeneration,
              providerOperationRef: outcome.providerOperationRef,
              sourceEvidenceDigest: outcome.evidenceDigest,
            })
          : null;
        const confirmationExhausted = confirmationCap !== null;
        if (confirmationCap) {
          outcome = confirmationCap;
          retryOutboxIntent = undefined;
        }
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases).where(and(
          eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
        )).limit(1).for("update");
        const lease = leaseRows[0];
        if (!lease || lease.workerId !== input.workerId || lease.leaseToken !== input.leaseToken ||
          lease.fence !== input.fence) {
          return { kind: "stale" as const };
        }
        if (lease.releasedAt) {
          if (delivery.latestEffectEvidenceDigest !== outcome.evidenceDigest) {
            return { kind: "stale" as const };
          }
          const replayType = outcome.kind === "retry_scheduled"
            ? "publication.retry_scheduled"
            : outcome.kind === "confirmation_pending"
              ? "publication.confirmation_pending"
              : outcome.kind === "failed"
                ? outcome.failureClass === "transient"
                  ? "publication.failed_transient" : "publication.failed_terminal"
              : `publication.${outcome.kind}`;
          const events = await tx.select().from(runtimePublishingDeliveryEvents).where(and(
            eq(runtimePublishingDeliveryEvents.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryEvents.deliveryId, input.deliveryId),
          )).orderBy(desc(runtimePublishingDeliveryEvents.sequence)).limit(1);
          const event = events[0] ? rehydratePublishingDeliveryEvent(events[0]) : null;
          return event && event.type === replayType &&
            "evidenceDigest" in event.evidence &&
            event.evidence.evidenceDigest === outcome.evidenceDigest
            ? { kind: "replayed" as const, delivery, event }
            : { kind: "stale" as const };
        }
        if (lease.expiresAt <= now) return { kind: "stale" as const };
        if (delivery.state !== "dispatching" && delivery.state !== "confirmation_pending") {
          return { kind: "stale" as const };
        }
        if (outcome.kind !== "retry_scheduled" && rows[0]!.nextEffectAttempt > 8) {
          return { kind: "stale" as const };
        }
        const needsFollowUp = outcome.kind === "retry_scheduled" ||
          outcome.kind === "confirmation_pending";
        if (needsFollowUp !== Boolean(retryOutboxIntent)) return { kind: "stale" as const };
        const nextState = outcome.kind === "retry_scheduled" ? "scheduled" :
          outcome.kind === "confirmation_pending" ? "confirmation_pending" :
          outcome.kind === "failed"
            ? outcome.failureClass === "transient" ? "failed_transient" : "failed_terminal" :
          outcome.kind;
        const eventType = outcome.kind === "retry_scheduled"
          ? "publication.retry_scheduled" :
          outcome.kind === "confirmation_pending"
            ? "publication.confirmation_pending"
            : outcome.kind === "failed"
              ? outcome.failureClass === "transient"
                ? "publication.failed_transient" : "publication.failed_terminal"
              : `publication.${outcome.kind}` as const;
        if (retryOutboxIntent) {
          const expectedAt = outcome.kind === "retry_scheduled"
            ? outcome.retryAt
            : outcome.kind === "confirmation_pending" ? outcome.pollAt : null;
          const prior = await tx.select({ generation: runtimePublishingDeliveryOutboxIntents.generation })
            .from(runtimePublishingDeliveryOutboxIntents).where(and(
              eq(runtimePublishingDeliveryOutboxIntents.workspaceId, input.workspaceId),
              eq(runtimePublishingDeliveryOutboxIntents.deliveryId, input.deliveryId),
            )).orderBy(desc(runtimePublishingDeliveryOutboxIntents.generation)).limit(1).for("share");
          if (!expectedAt || retryOutboxIntent.workspaceId !== input.workspaceId ||
            retryOutboxIntent.deliveryId !== input.deliveryId ||
            retryOutboxIntent.generation !== delivery.nextOutboxGeneration ||
            (prior[0]?.generation ?? 0) + 1 !== delivery.nextOutboxGeneration ||
            retryOutboxIntent.dedupeKey !== publishingDeliveryOutboxDedupeKey(
              input.workspaceId,
              input.deliveryId,
              delivery.nextOutboxGeneration,
            ) ||
            retryOutboxIntent.state !== "pending" ||
            retryOutboxIntent.purpose !== "publish" ||
            retryOutboxIntent.availableAt.getTime() !== expectedAt.getTime() ||
            retryOutboxIntent.deliveryToken || retryOutboxIntent.claimedAt ||
            retryOutboxIntent.deliveredAt || retryOutboxIntent.deliveryAttempts !== 0) {
            return { kind: "stale" as const };
          }
        }
        const evidence = outcome.kind === "retry_scheduled" ? {
          effectKey: input.effectKey,
          evidenceDigest: outcome.evidenceDigest,
          failureCode: outcome.failureCode,
          retryAt: outcome.retryAt.toISOString(),
        } : outcome.kind === "confirmation_pending" ? {
          effectKey: input.effectKey,
          providerOperationRef: outcome.providerOperationRef,
          evidenceDigest: outcome.evidenceDigest,
          pollAt: outcome.pollAt.toISOString(),
        } : outcome.kind === "failed" ? {
          effectKey: input.effectKey,
          effectGeneration: delivery.effectGeneration,
          providerOperationRef: outcome.providerOperationRef,
          evidenceDigest: outcome.evidenceDigest,
          failureCode: outcome.failureCode,
          failureClass: outcome.failureClass,
          retryable: outcome.retryable,
            effectDisposition: outcome.effectDisposition,
        } : {
          effectKey: input.effectKey,
          providerOperationRef: outcome.providerOperationRef,
          evidenceDigest: outcome.evidenceDigest,
          failureCode: outcome.kind === "succeeded" ? null : outcome.failureCode,
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
        if (retryOutboxIntent) {
          await tx.insert(runtimePublishingDeliveryOutboxIntents).values(retryOutboxIntent);
        }
        if (outcome.kind !== "retry_scheduled") {
          if (!delivery.providerAdapterContractDigest) return { kind: "stale" as const };
          const result = outcome.kind === "failed"
            ? outcome.failureClass === "transient" ? "failed_transient" : "failed_terminal"
            : outcome.kind;
          await tx.insert(runtimePublishingDeliveryEffectReceipts).values({
            workspaceId: input.workspaceId,
            id: `pder_${randomUUID().replaceAll("-", "")}`,
            deliveryId: input.deliveryId,
            effectGeneration: delivery.effectGeneration,
            effectAttempt: rows[0]!.nextEffectAttempt,
            effectKey: delivery.effectKey,
            intentDigest: delivery.intentDigest,
            providerAdapterContractDigest: delivery.providerAdapterContractDigest,
            mode: delivery.state === "confirmation_pending" ? "observe" : "launch",
            executionFence: input.fence,
            result,
            effectDisposition: outcome.kind === "failed" ? outcome.effectDisposition :
              outcome.kind === "succeeded" || outcome.kind === "confirmation_pending"
                ? "provider_accepted" : "unknown",
            failureClass: outcome.kind === "failed" ? outcome.failureClass : null,
            failureRetryable: outcome.kind === "failed" ? outcome.retryable : null,
            providerOperationRef: outcome.providerOperationRef,
            evidenceDigest: outcome.evidenceDigest,
            failureCode: outcome.kind === "succeeded" || outcome.kind === "confirmation_pending"
              ? null : outcome.failureCode,
            eventSequence: event.sequence,
            occurredAt: now,
          });
        }
        const completed = ["succeeded", "failed_transient", "failed_terminal", "outcome_unknown"]
          .includes(nextState);
        const updated = await tx.update(runtimePublishingDeliveries).set({
          state: nextState,
          providerOperationRef: outcome.kind === "confirmation_pending" ||
            outcome.kind === "succeeded" || outcome.kind === "failed" ||
            outcome.kind === "outcome_unknown"
              ? outcome.providerOperationRef
              : null,
          latestEffectEvidenceDigest: outcome.evidenceDigest,
          failureCode: outcome.kind === "succeeded" ||
            outcome.kind === "confirmation_pending" ? null : outcome.failureCode,
          failureClass: outcome.kind === "failed" ? outcome.failureClass : null,
          failureRetryable: outcome.kind === "failed" ? outcome.retryable : null,
          failureEffectDisposition: outcome.kind === "failed" ? outcome.effectDisposition :
            outcome.kind === "outcome_unknown" ? "ambiguous" : null,
          confirmationAttempts: confirmationExhausted
            ? 3
            : delivery.state === "confirmation_pending" &&
                outcome.kind === "confirmation_pending"
              ? Math.min(3, rows[0]!.confirmationAttempts + 1)
              : rows[0]!.confirmationAttempts,
          // Only states that can have a later observation advance the next
          // receipt slot. Nine is an exhausted sentinel, never a receipt.
          nextEffectAttempt: outcome.kind === "confirmation_pending" ||
              outcome.kind === "outcome_unknown"
            ? rows[0]!.nextEffectAttempt + 1
            : rows[0]!.nextEffectAttempt,
          completedAt: completed ? now : null,
          nextEventSequence: delivery.nextEventSequence + 1,
          nextOutboxGeneration: retryOutboxIntent
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

  async acquireReconciliationLease(
    input: Parameters<PublishingDeliveryRepository["acquireReconciliationLease"]>[0],
  ) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = deliveryRows[0] ? rehydratePublishingDelivery(deliveryRows[0]) : null;
        if (!delivery) return { kind: "terminal" as const };
        if (publishingDeliveryReconciliationExhausted(delivery) ||
          delivery.state !== "outcome_unknown" ||
          !delivery.latestEffectEvidenceDigest ||
          !delivery.intentDigest || !delivery.providerAdapterContractDigest) {
          return { kind: "terminal" as const };
        }
        const requestRows = await tx.select().from(runtimePublishingDeliveryReconciliationRequests)
          .where(and(
            eq(runtimePublishingDeliveryReconciliationRequests.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryReconciliationRequests.deliveryId, input.deliveryId),
            eq(runtimePublishingDeliveryReconciliationRequests.sourceEvidenceDigest,
              delivery.latestEffectEvidenceDigest),
          )).orderBy(desc(runtimePublishingDeliveryReconciliationRequests.requestedAt)).limit(1)
          .for("update");
        const reconciliation = requestRows[0]
          ? rehydrateReconciliationRequest(requestRows[0]) : null;
        if (!reconciliation || reconciliation.sourceEffectKey !== delivery.effectKey ||
          reconciliation.sourceEffectGeneration !== delivery.effectGeneration ||
          reconciliation.sourceIntentDigest !== delivery.intentDigest ||
          reconciliation.sourceProviderAdapterContractDigest !==
            delivery.providerAdapterContractDigest) return { kind: "not_due" as const };
        const settled = await tx.select({ id: runtimePublishingDeliveryReconciliationReceipts.id })
          .from(runtimePublishingDeliveryReconciliationReceipts).where(and(
            eq(runtimePublishingDeliveryReconciliationReceipts.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryReconciliationReceipts.reconciliationId, reconciliation.id),
          )).limit(1);
        if (settled[0]) return { kind: "terminal" as const };
        const due = await tx.select().from(runtimePublishingDeliveryOutboxIntents).where(and(
          eq(runtimePublishingDeliveryOutboxIntents.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryOutboxIntents.deliveryId, input.deliveryId),
          eq(runtimePublishingDeliveryOutboxIntents.purpose, "reconcile"),
          eq(runtimePublishingDeliveryOutboxIntents.state, "delivered"),
          lte(runtimePublishingDeliveryOutboxIntents.availableAt, now),
        )).orderBy(desc(runtimePublishingDeliveryOutboxIntents.generation)).limit(1).for("share");
        if (!due[0]) return { kind: "not_due" as const };
        if (due[0].generation !== delivery.nextOutboxGeneration - 1) {
          return { kind: "not_due" as const };
        }
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases)
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
          )).limit(1).for("update");
        const current = leaseRows[0];
        if (current && !current.releasedAt && current.expiresAt > now) {
          return { kind: "busy" as const };
        }
        const fence = (current?.fence ?? BigInt(0)) + BigInt(1);
        const expiresAt = new Date(now.getTime() +
          Math.max(1, input.expiresAt.getTime() - input.now.getTime()));
        const leaseToken = randomUUID();
        const written = current
          ? await tx.update(runtimePublishingDeliveryExecutionLeases).set({
              workerId: input.workerId, leaseToken, fence, acquiredAt: now,
              expiresAt, renewedAt: now, releasedAt: null,
            }).where(and(
              eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
              eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
            )).returning()
          : await tx.insert(runtimePublishingDeliveryExecutionLeases).values({
              workspaceId: input.workspaceId, deliveryId: input.deliveryId,
              workerId: input.workerId, leaseToken, fence, acquiredAt: now,
              expiresAt, renewedAt: now, releasedAt: null,
            }).returning();
        const lease = requireWrittenRecord(written[0]
          ? rehydratePublishingDeliveryLease(written[0]) : null);
        return { kind: "acquired" as const, delivery, reconciliation, lease };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async settleReconciliation(
    input: Parameters<PublishingDeliveryRepository["settleReconciliation"]>[0],
  ) {
    try {
      return await this.database().transaction(async (tx) => {
        const now = await databaseNow(tx);
        if (!now) return { kind: "unavailable" as const };
        const deliveryRows = await tx.select().from(runtimePublishingDeliveries).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).limit(1).for("update");
        const delivery = deliveryRows[0] ? rehydratePublishingDelivery(deliveryRows[0]) : null;
        const requestRows = await tx.select().from(runtimePublishingDeliveryReconciliationRequests)
          .where(and(
            eq(runtimePublishingDeliveryReconciliationRequests.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryReconciliationRequests.id, input.reconciliationId),
            eq(runtimePublishingDeliveryReconciliationRequests.deliveryId, input.deliveryId),
          )).limit(1).for("update");
        const reconciliation = requestRows[0]
          ? rehydrateReconciliationRequest(requestRows[0]) : null;
        if (!delivery || !reconciliation || input.event.type !== "delivery.reconciled") {
          return { kind: "stale" as const };
        }
        const submittedEvent = input.event;
        const priorRows = await tx.select().from(runtimePublishingDeliveryReconciliationReceipts)
          .where(and(
            eq(runtimePublishingDeliveryReconciliationReceipts.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryReconciliationReceipts.reconciliationId,
              input.reconciliationId),
          )).limit(1).for("update");
        if (priorRows[0]) {
          const result = rehydrateReconciliationResult(priorRows[0]);
          const events = await tx.select().from(runtimePublishingDeliveryEvents).where(and(
            eq(runtimePublishingDeliveryEvents.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryEvents.deliveryId, input.deliveryId),
            eq(runtimePublishingDeliveryEvents.type, "delivery.reconciled"),
          )).orderBy(desc(runtimePublishingDeliveryEvents.sequence)).limit(1);
          const event = events[0] ? rehydratePublishingDeliveryEvent(events[0]) : null;
          return result && event?.type === "delivery.reconciled" &&
            result.sourceEvidenceDigest === input.sourceEvidenceDigest &&
            result.effectKey === input.effectKey &&
            result.effectGeneration === input.effectGeneration &&
            canonicalDigest(result.resolution) === canonicalDigest(input.resolution) &&
            delivery.latestEffectEvidenceDigest === result.resolution.evidenceDigest
            ? { kind: "replayed" as const, delivery, reconciliation, result, event }
            : { kind: "stale" as const };
        }
        if (delivery.state !== "outcome_unknown" ||
          delivery.effectKey !== input.effectKey || delivery.effectGeneration !== input.effectGeneration ||
          delivery.intentDigest !== input.intentDigest ||
          delivery.providerAdapterContractDigest !== input.providerAdapterContractDigest ||
          delivery.latestEffectEvidenceDigest !== input.sourceEvidenceDigest ||
          reconciliation.sourceEvidenceDigest !== input.sourceEvidenceDigest) {
          return { kind: "stale" as const };
        }
        // Attempt 8 is the final durable observation slot. Normalize a final
        // inconclusive observation to operator-required before writing either
        // the ordered event or receipts, leaving attempt 9 as an exhausted
        // sentinel which can never collide with the attempt unique key.
        const reconciliationExhausted =
          deliveryRows[0]!.nextEffectAttempt >= 8 &&
          input.resolution.kind === "still_unknown";
        const exhaustedEvidenceDigest = reconciliationExhausted
          ? canonicalDigest({
              schema: "publishing-delivery-reconciliation-exhausted/v1",
              deliveryId: delivery.id,
              reconciliationId: input.reconciliationId,
              effectKey: input.effectKey,
              effectGeneration: input.effectGeneration,
              sourceEvidenceDigest: input.sourceEvidenceDigest,
              providerOperationRef: input.resolution.providerOperationRef,
              effectAttempt: deliveryRows[0]!.nextEffectAttempt,
            })
          : null;
        const resolution = reconciliationExhausted ? {
          kind: "operator_required" as const,
          providerOperationRef: input.resolution.providerOperationRef,
          evidenceDigest: exhaustedEvidenceDigest!,
          failureCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
        } : input.resolution;
        const event: Extract<PublishingDeliveryEvent, { type: "delivery.reconciled" }> =
          reconciliationExhausted ? {
          ...submittedEvent,
          evidence: {
            reconciliationId: submittedEvent.evidence.reconciliationId,
            effectKey: submittedEvent.evidence.effectKey,
            effectGeneration: submittedEvent.evidence.effectGeneration,
            sourceEvidenceDigest: submittedEvent.evidence.sourceEvidenceDigest,
            evidenceDigest: exhaustedEvidenceDigest!,
            resolution: "operator_required" as const,
            providerOperationRef: input.resolution.providerOperationRef,
            failureCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
            retryable: null,
          },
        } : submittedEvent;
        if (deliveryRows[0]!.nextEffectAttempt > 8) {
          return { kind: "stale" as const };
        }
        const leaseRows = await tx.select().from(runtimePublishingDeliveryExecutionLeases)
          .where(and(
            eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
            eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
          )).limit(1).for("update");
        const lease = leaseRows[0];
        if (!lease || lease.workerId !== input.workerId || lease.leaseToken !== input.leaseToken ||
          lease.fence !== input.fence || lease.releasedAt || lease.expiresAt <= now ||
          event.type !== "delivery.reconciled" ||
          event.sequence !== delivery.nextEventSequence ||
          event.evidence.sourceEvidenceDigest !== input.sourceEvidenceDigest ||
          (!reconciliationExhausted &&
            event.evidence.evidenceDigest !== resolution.evidenceDigest)) {
          return { kind: "stale" as const };
        }
        const outcome = resolution.kind === "failed_known" ? "failed_known"
          : resolution.kind;
        const resultId = `pdrer_${randomUUID().replaceAll("-", "")}`;
        await tx.insert(runtimePublishingDeliveryEvents).values({
          workspaceId: event.workspaceId, id: event.id,
          deliveryId: event.deliveryId, sequence: event.sequence,
          type: event.type, evidence: event.evidence, occurredAt: now,
        });
        await tx.insert(runtimePublishingDeliveryReconciliationReceipts).values({
          workspaceId: input.workspaceId,
          id: resultId,
          reconciliationId: input.reconciliationId,
          deliveryId: input.deliveryId,
          sourceEvidenceDigest: input.sourceEvidenceDigest,
          resultEvidenceDigest: resolution.evidenceDigest,
          effectKey: input.effectKey,
          effectGeneration: input.effectGeneration,
          outcome,
          effectDisposition: resolution.kind === "failed_known"
            ? resolution.effectDisposition : null,
          failureClass: resolution.kind === "failed_known"
            ? resolution.failureClass : null,
          failureRetryable: resolution.kind === "failed_known"
            ? resolution.retryable : null,
          failureCode: resolution.kind === "succeeded"
            ? null : resolution.failureCode,
          providerOperationRef: resolution.providerOperationRef,
          eventSequence: event.sequence,
          outboxGeneration: null,
          reconciledAt: now,
        });
        await tx.insert(runtimePublishingDeliveryEffectReceipts).values({
          workspaceId: input.workspaceId,
          id: `pder_${randomUUID().replaceAll("-", "")}`,
          deliveryId: input.deliveryId,
          effectGeneration: input.effectGeneration,
          effectAttempt: deliveryRows[0]!.nextEffectAttempt,
          effectKey: input.effectKey,
          intentDigest: input.intentDigest,
          providerAdapterContractDigest: input.providerAdapterContractDigest,
          mode: "reconcile",
          executionFence: input.fence,
          result: resolution.kind === "failed_known"
            ? resolution.failureClass === "transient" ? "failed_transient" : "failed_terminal"
            : resolution.kind,
          effectDisposition: resolution.kind === "succeeded" ? "provider_accepted" :
            resolution.kind === "failed_known"
              ? resolution.effectDisposition : "unknown",
          failureClass: resolution.kind === "failed_known"
            ? resolution.failureClass : null,
          failureRetryable: resolution.kind === "failed_known"
            ? resolution.retryable : null,
          providerOperationRef: resolution.providerOperationRef,
          evidenceDigest: resolution.evidenceDigest,
          failureCode: resolution.kind === "succeeded" ? null : resolution.failureCode,
          eventSequence: event.sequence,
          occurredAt: now,
        });
        const nextState = resolution.kind === "succeeded" ? "succeeded" :
          resolution.kind === "failed_known"
            ? resolution.failureClass === "transient"
              ? "failed_transient" : "failed_terminal"
            : "outcome_unknown";
        const updatedRows = await tx.update(runtimePublishingDeliveries).set({
          state: nextState,
          providerOperationRef: resolution.providerOperationRef,
          latestEffectEvidenceDigest: resolution.evidenceDigest,
          failureCode: resolution.kind === "succeeded" ? null : resolution.failureCode,
          failureClass: resolution.kind === "failed_known"
            ? resolution.failureClass : null,
          failureRetryable: resolution.kind === "failed_known"
            ? resolution.retryable : null,
          failureEffectDisposition: resolution.kind === "failed_known"
            ? resolution.effectDisposition
            : resolution.kind === "succeeded" ? null : "ambiguous",
          completedAt: now,
          nextEventSequence: delivery.nextEventSequence + 1,
          nextEffectAttempt: deliveryRows[0]!.nextEffectAttempt + 1,
          updatedAt: now,
        }).where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveries.id, input.deliveryId),
        )).returning();
        await tx.update(runtimePublishingDeliveryExecutionLeases).set({ releasedAt: now }).where(and(
          eq(runtimePublishingDeliveryExecutionLeases.workspaceId, input.workspaceId),
          eq(runtimePublishingDeliveryExecutionLeases.deliveryId, input.deliveryId),
          eq(runtimePublishingDeliveryExecutionLeases.fence, input.fence),
        ));
        const updated = requireWrittenRecord(updatedRows[0]
          ? rehydratePublishingDelivery(updatedRows[0]) : null);
        const result = requireWrittenRecord(rehydrateReconciliationResult({
          workspaceId: input.workspaceId, id: resultId, reconciliationId: input.reconciliationId,
          deliveryId: input.deliveryId, sourceEvidenceDigest: input.sourceEvidenceDigest,
          resultEvidenceDigest: resolution.evidenceDigest, effectKey: input.effectKey,
          effectGeneration: input.effectGeneration, outcome,
          effectDisposition: resolution.kind === "failed_known"
            ? resolution.effectDisposition : null,
          failureClass: resolution.kind === "failed_known" ? resolution.failureClass : null,
          failureRetryable: resolution.kind === "failed_known" ? resolution.retryable : null,
          failureCode: resolution.kind === "succeeded" ? null : resolution.failureCode,
          providerOperationRef: resolution.providerOperationRef,
          eventSequence: event.sequence, outboxGeneration: null, reconciledAt: now,
        }));
        return { kind: "settled" as const, delivery: updated, reconciliation, result,
          event };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }
}
