import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { PublishingApprovalServiceError } from "./errors";
import type {
  PublishingApprovalRequestRecord,
  PublishingApprovalValidationBinding,
} from "./types";
import type { PublishingPlanRevisionRecord } from "../publishing-plans/types";
import { ARTIFACT_ID_PATTERN } from "../artifacts/validation";
import {
  PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
  publishingPlanLinkedInCapabilityVersion,
  publishingPlanRuntimePolicyContractDigest,
} from "../publishing-plans/production-digests";

const ID = /^[A-Za-z0-9_-]{1,200}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/;

export function approvalIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!ID.test(normalized)) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  return normalized;
}

export function approvalEvidenceRef(value: string, label: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_PERSISTENCE_UNAVAILABLE",
      `${label} is unavailable.`,
    );
  }
  return normalized;
}

export function approvalIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!IDEMPOTENCY_KEY.test(normalized)) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      "A stable idempotency key between 8 and 200 visible ASCII characters is required.",
    );
  }
  return normalized;
}

export function approvalDigest(value: string, label: string): string {
  if (!DIGEST.test(value)) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  return value;
}

function exactUniqueIds(values: string[], label: string, max: number): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > max) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      `${label} must contain between 1 and ${max} identifiers.`,
    );
  }
  const normalized = values.map((value) => approvalIdentifier(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      `${label} must not contain duplicates.`,
    );
  }
  return normalized;
}

function exactUniqueArtifactIds(values: string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 200) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      "Artifact IDs must contain between 1 and 200 identifiers.",
    );
  }
  const normalized = values.map((value) => value.trim());
  if (
    normalized.some(
      (value) => value.length > 200 || !new RegExp(ARTIFACT_ID_PATTERN).test(value),
    ) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      "Artifact IDs are invalid or duplicated.",
    );
  }
  return normalized;
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export interface ExactPublishingApprovalSelection {
  targetIds: string[];
  channelIds: string[];
  artifactIds: string[];
}

export function exactPublishingApprovalSelection(input: {
  revision: PublishingPlanRevisionRecord;
  targetIds: string[];
  channelIds: string[];
  artifactIds: string[];
}): ExactPublishingApprovalSelection {
  const requestedTargets = exactUniqueIds(input.targetIds, "Target IDs", 50);
  const requestedChannels = exactUniqueIds(input.channelIds, "Channel IDs", 50);
  const requestedArtifacts = exactUniqueArtifactIds(input.artifactIds);
  const targetSet = new Set(requestedTargets);
  const selected = input.revision.definition.targets.filter((target) =>
    targetSet.has(target.targetId),
  );
  if (selected.length !== requestedTargets.length) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      "Every requested Target must exist in the exact Plan Revision.",
    );
  }
  const targetIds = selected.map((target) => target.targetId);
  const channelIds = [...new Set(selected.map((target) => target.channelId))].sort();
  const artifactIds = [
    ...new Set(
      selected.flatMap((target) => [
        target.contentArtifactId,
        ...target.mediaArtifactIds,
      ]),
    ),
  ].sort();
  if (!sameSet(channelIds, requestedChannels) || !sameSet(artifactIds, requestedArtifacts)) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      "Channel and Artifact manifests must exactly match the selected Targets.",
    );
  }
  return { targetIds, channelIds, artifactIds };
}

export function publishingApprovalValidationBinding(input: {
  revision: PublishingPlanRevisionRecord;
  targetIds: string[];
}): PublishingApprovalValidationBinding {
  const evidence = input.revision.validationEvidence;
  if (
    evidence.runtimePolicy.identity !== PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY ||
    evidence.runtimePolicy.contractDigest !==
      publishingPlanRuntimePolicyContractDigest() ||
    evidence.targets.some(
      (target) =>
        target.channel.platform !== "linkedin" ||
        target.channel.capabilityVersion !==
          publishingPlanLinkedInCapabilityVersion(),
    )
  ) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_STALE_VALIDATION",
      "Publish Validation does not use the current LinkedIn and runtime-policy contracts.",
    );
  }
  const selected = new Set(input.targetIds);
  const targets = evidence.targets.filter((target) => selected.has(target.targetId));
  if (targets.length !== input.targetIds.length) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_STALE_VALIDATION",
      "Current validation does not cover every selected Target.",
    );
  }
  return {
    evidenceDigest: canonicalDigest(evidence),
    currentStateDigest: evidence.currentStateDigest,
    contextId: evidence.context.contextId,
    contextDigest: evidence.context.contextDigest,
    evaluatedAt: evidence.evaluatedAt,
    expiresAt: evidence.context.expiresAt,
    runtimePolicyIdentity: evidence.runtimePolicy.identity,
    runtimePolicyContractDigest: evidence.runtimePolicy.contractDigest,
  };
}

export function sameValidationBinding(
  left: PublishingApprovalValidationBinding,
  right: PublishingApprovalValidationBinding,
): boolean {
  return canonicalDigest(left) === canonicalDigest(right);
}

export function publishingApprovalInspectionDigest(
  request: PublishingApprovalRequestRecord,
): string {
  return canonicalDigest({
    schema: "publishing-approval-inspection/v1",
    id: request.id,
    workspaceId: request.workspaceId,
    planId: request.planId,
    planRevisionId: request.planRevisionId,
    planRevision: request.planRevision,
    planRevisionDigest: request.planRevisionDigest,
    action: request.action,
    targetIds: request.targetIds,
    channelIds: request.channelIds,
    artifactIds: request.artifactIds,
    requestingPrincipalId: request.requestingPrincipalId,
    requestAuthorization: request.requestAuthorization,
    validation: request.validation,
    decisionPolicy: {
      mode: request.decisionPolicy.mode,
      expiresAt: request.decisionPolicy.expiresAt.toISOString(),
    },
    createdAt: request.createdAt.toISOString(),
    decision: request.decision
      ? {
          id: request.decision.id,
          decision: request.decision.decision,
          decidedByUserId: request.decision.decidedByUserId,
          authorityEvidenceDigest: request.decision.authorityEvidenceDigest,
          authorityGrants: request.decision.authorityGrants,
          inspectionDigest: request.decision.inspectionDigest,
          decidedAt: request.decision.decidedAt.toISOString(),
        }
      : null,
    consumption: request.consumption
      ? {
          id: request.consumption.id,
          decisionId: request.consumption.decisionId,
          capability: request.consumption.capability,
          authorizationContractDigest:
            request.consumption.authorizationContractDigest,
          authorizedResources: request.consumption.authorizedResources,
          consumedAt: request.consumption.consumedAt.toISOString(),
        }
      : null,
  });
}
