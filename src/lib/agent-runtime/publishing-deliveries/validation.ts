import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { ARTIFACT_ID_PATTERN } from "../artifacts/validation";
import {
  publishingApprovalReleaseAuthorizationContractDigest,
} from "../publishing-approvals/authorization-contract";
import type {
  PublishingApprovalRequestRecord,
  PublishingApprovalValidationSession,
} from "../publishing-approvals/types";
import type { PublishingPlanRevisionRecord } from "../publishing-plans/types";
import {
  PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
  publishingPlanLinkedInCapabilityVersion,
  publishingPlanRuntimePolicyContractDigest,
} from "../publishing-plans/production-digests";
import { PublishingDeliveryServiceError } from "./errors";
import { PUBLISHING_DELIVERY_EFFECT_KEY_PATTERN } from "./keys";
import type {
  PublishingDeliveryAcceptedRef,
  PublishingDeliveryAuthorizationSession,
  PublishingDeliveryDto,
  PublishingDeliveryRecord,
  PublishingDeliveryTargetSnapshot,
} from "./types";

export const PUBLISHING_DELIVERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
export const PUBLISHING_DELIVERY_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
export { PUBLISHING_DELIVERY_EFFECT_KEY_PATTERN } from "./keys";

/** Exhaustion is retained terminal operator-required truth, despite outcome_unknown state. */
export function publishingDeliveryReconciliationExhausted(
  delivery: Pick<PublishingDeliveryRecord, "state" | "failureCode" | "nextEffectAttempt">,
): boolean {
  return delivery.state === "outcome_unknown" &&
    delivery.failureCode === "RECONCILIATION_ATTEMPTS_EXHAUSTED" &&
    delivery.nextEffectAttempt >= 9;
}

export function publishingDeliveryIdentifier(value: string, label: string): string {
  const result = value.trim();
  if (!PUBLISHING_DELIVERY_ID_PATTERN.test(result)) {
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  return result;
}

export function publishingDeliveryArtifactIdentifier(value: string): string {
  const result = value.trim();
  if (!ARTIFACT_ID_PATTERN.test(result)) {
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_INVALID_INPUT",
      "Artifact ID is invalid.",
    );
  }
  return result;
}

export function publishingDeliveryIdempotencyKey(value: string): string {
  const result = value.trim();
  if (!/^[!-~]{8,200}$/.test(result)) {
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_INVALID_INPUT",
      "A scoped idempotency key is required.",
    );
  }
  return result;
}

export function publishingDeliveryDigest(value: string, label: string): string {
  if (!PUBLISHING_DELIVERY_DIGEST_PATTERN.test(value)) {
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  return value;
}

export function exactApprovedRequest(input: {
  approval: PublishingApprovalRequestRecord | null;
  workspaceId: string;
  principalId: string;
  approvalRequestId: string;
  now: Date;
}): input is typeof input & { approval: PublishingApprovalRequestRecord } {
  const { approval } = input;
  if (!approval || !approval.decision) return false;
  return (
    approval.id === input.approvalRequestId &&
    approval.workspaceId === input.workspaceId &&
    approval.requestingPrincipalId === input.principalId &&
    approval.action === "publish" &&
    approval.decision.approvalRequestId === approval.id &&
    approval.decision.workspaceId === approval.workspaceId &&
    approval.decision.decision === "approved" &&
    approval.decision.authorizesExecution === false &&
    approval.authorizesExecution === false &&
    approval.decision.decidedAt.getTime() <= input.now.getTime() &&
    approval.decision.decidedAt.getTime() <= approval.decisionPolicy.expiresAt.getTime() &&
    approval.consumption === null &&
    new Set(approval.targetIds).size === approval.targetIds.length &&
    new Set(approval.channelIds).size === approval.channelIds.length &&
    new Set(approval.artifactIds).size === approval.artifactIds.length &&
    approval.targetIds.length > 0 &&
    approval.channelIds.length > 0 &&
    approval.artifactIds.length > 0
  );
}

export function validPublishingDeliveryAuthorizationSession(input: {
  session: PublishingDeliveryAuthorizationSession | null;
  workspaceId: string;
  principalId: string;
  keyId: string;
  capability: "publishing_plan_revisions.release@1";
  authorizationContractDigest: string;
  authorizationEvidenceRef: string;
  channelIds: string[];
  artifactIds: string[];
  now: Date;
}): input is typeof input & { session: PublishingDeliveryAuthorizationSession } {
  const { session } = input;
  if (!session) return false;
  return (
    session.schema === "publishing-delivery-authorization-session/v1" &&
    PUBLISHING_DELIVERY_ID_PATTERN.test(session.id) &&
    session.workspaceId === input.workspaceId &&
    session.principalId === input.principalId &&
    session.keyId === input.keyId &&
    session.capability === input.capability &&
    session.contractDigest === input.authorizationContractDigest &&
    session.contractDigest === publishingApprovalReleaseAuthorizationContractDigest() &&
    session.evidenceRef === input.authorizationEvidenceRef &&
    /^[^\u0000-\u001f\u007f]{1,200}$/.test(session.evidenceRef) &&
    canonicalDigest([...session.resources.channelIds].sort()) === canonicalDigest([...input.channelIds].sort()) &&
    canonicalDigest([...session.resources.artifactIds].sort()) === canonicalDigest([...input.artifactIds].sort()) &&
    new Set(session.resources.channelIds).size === session.resources.channelIds.length &&
    new Set(session.resources.artifactIds).size === session.resources.artifactIds.length &&
    session.issuedAt.getTime() <= input.now.getTime() &&
    session.expiresAt.getTime() > input.now.getTime()
  );
}

export function validPublishingDeliveryValidationSession(input: {
  session: PublishingApprovalValidationSession | null;
  approval: PublishingApprovalRequestRecord;
  revision: PublishingPlanRevisionRecord;
  now: Date;
}): input is typeof input & { session: PublishingApprovalValidationSession } {
  const { session, approval, revision } = input;
  if (!session) return false;
  return (
    session.schema === "publishing-approval-validation-session/v1" &&
    PUBLISHING_DELIVERY_ID_PATTERN.test(session.id) &&
    session.workspaceId === input.approval.workspaceId &&
    session.planRevisionId === revision.id &&
    session.planRevisionDigest === revision.definitionDigest &&
    canonicalDigest(session.targetIds) === canonicalDigest(approval.targetIds) &&
    canonicalDigest(session.binding) === canonicalDigest(approval.validation) &&
    session.expiresAt.toISOString() === approval.validation.expiresAt &&
    session.issuedAt.getTime() >= new Date(approval.validation.evaluatedAt).getTime() &&
    canonicalDigest(revision.validationEvidence) === approval.validation.evidenceDigest &&
    revision.validationEvidence.definitionDigest === revision.definitionDigest &&
    revision.validationEvidence.currentStateDigest === approval.validation.currentStateDigest &&
    revision.validationEvidence.runtimePolicy.identity === PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY &&
    revision.validationEvidence.runtimePolicy.contractDigest === publishingPlanRuntimePolicyContractDigest() &&
    revision.validationEvidence.targets.length === revision.definition.targets.length &&
    revision.validationEvidence.targets.every(
      (target) =>
        target.blockerCodes.length === 0 &&
        target.channel.platform === "linkedin" &&
        target.channel.capabilityVersion === publishingPlanLinkedInCapabilityVersion(),
    ) &&
    session.issuedAt.getTime() <= input.now.getTime() &&
    session.expiresAt.getTime() > input.now.getTime()
  );
}

export function publishingDeliveryTargetSnapshot(input: {
  revision: PublishingPlanRevisionRecord;
  targetId: string;
}): PublishingDeliveryTargetSnapshot {
  const target = input.revision.definition.targets.find(
    (candidate) => candidate.targetId === input.targetId,
  );
  const validation = input.revision.validationEvidence.targets.find(
    (candidate) => candidate.targetId === input.targetId,
  );
  if (!target || !validation || validation.channel.id !== target.channelId) {
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_VALIDATION_STALE",
      "The approved target no longer has exact validation evidence.",
    );
  }
  const artifactIds = [target.contentArtifactId, ...target.mediaArtifactIds];
  if (
    validation.targetId !== target.targetId ||
    validation.artifacts.length !== artifactIds.length ||
    validation.artifacts.some(
      (artifact, index) =>
        artifact.id !== artifactIds[index] ||
        !PUBLISHING_DELIVERY_DIGEST_PATTERN.test(artifact.digest) ||
        !PUBLISHING_DELIVERY_DIGEST_PATTERN.test(artifact.snapshotDigest) ||
        (index === 0 ? artifact.kind !== "text" : artifact.kind !== "image"),
    ) ||
    validation.settingsDigest !== canonicalDigest(target.settings) ||
    validation.publishAt !== target.timing.publishAt ||
    !PUBLISHING_DELIVERY_DIGEST_PATTERN.test(validation.policyEvidenceDigest) ||
    !PUBLISHING_DELIVERY_DIGEST_PATTERN.test(validation.policyStateDigest) ||
    validation.blockerCodes.length !== 0
  ) {
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_VALIDATION_STALE",
      "The approved target snapshot is not exactly bound to successful validation evidence.",
    );
  }
  const value = {
    schema: "publishing-delivery-target-snapshot/v1" as const,
    target: structuredClone(target),
    validation: structuredClone(validation),
    targetDigest: canonicalDigest({ target, validation }),
  };
  return value;
}

export function publishingDeliveryDto(
  record: PublishingDeliveryRecord,
): PublishingDeliveryDto {
  return {
    ...structuredClone(record),
    publishAt: record.publishAt.toISOString(),
    acceptedAt: record.acceptedAt.toISOString(),
    scheduledAt: record.scheduledAt.toISOString(),
    dispatchStartedAt: record.dispatchStartedAt?.toISOString() ?? null,
    effectContactStartedAt:
      record.effectContactStartedAt?.toISOString() ?? null,
    readinessBlockedAt: record.readinessBlockedAt?.toISOString() ?? null,
    readinessRetryAt: record.readinessRetryAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
    externallyCompleted:
      record.state === "succeeded"
        ? true
        : record.state === "outcome_unknown" ||
            record.state === "confirmation_pending"
          ? null
          : false,
  };
}

export function publishingDeliveryAcceptedRef(
  record: PublishingDeliveryRecord,
): PublishingDeliveryAcceptedRef {
  return {
    id: record.id,
    targetId: record.targetId,
    channelId: record.channelId,
    publishAt: record.publishAt.toISOString(),
    state: "scheduled",
    effectKey: record.effectKey,
    acceptedAt: record.acceptedAt.toISOString(),
    scheduledAt: record.scheduledAt.toISOString(),
    externallyCompleted: false,
  };
}
