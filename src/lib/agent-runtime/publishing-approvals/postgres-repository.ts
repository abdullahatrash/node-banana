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
import { ARTIFACT_ID_PATTERN } from "@/lib/agent-runtime/artifacts/validation";
import type { getDb } from "@/lib/db";
import {
  agentAuthorizationDecisions,
  agentKeys,
  agentPrincipals,
  artifactContents,
  artifacts,
  runtimePublishingApprovalAuthorityGrants,
  runtimePublishingApprovalAuthorityMutationReceipts,
  runtimePublishingApprovalAuthorityRevocations,
  runtimePublishingApprovalConsumptions,
  runtimePublishingApprovalDecisions,
  runtimePublishingApprovalMutationReceipts,
  runtimePublishingApprovalRequests,
  runtimePublishingApprovalRetrySources,
  runtimePublishingDeliveryRetryApprovalConsumptions,
  runtimePublishingDeliveries,
  runtimePublishingPlanRevisions,
  runtimePublishingPlans,
  runtimeSpendControls,
  socialAccounts,
  user,
  workspaceMembers,
  workspaceGovernanceResources,
} from "@/lib/db/schema";
import { readLinkedInAuthorKind } from "@/lib/social/linkedin-author-kind";
import {
  PUBLISHING_PLAN_LINKEDIN_CAPABILITIES,
  PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
  publishingPlanArtifactVersionDigest,
  publishingPlanChannelVersionDigest,
  publishingPlanLinkedInCapabilityVersion,
  publishingPlanPolicyStateDigest,
  publishingPlanRuntimePolicyContractDigest,
} from "../publishing-plans/production-digests";
import { rehydratePublishingPlanRevision } from "../publishing-plans/postgres-repository";
import type {
  PublishingPlanRevisionRecord,
} from "../publishing-plans/types";
import {
  PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES,
  publishingApprovalReleaseAuthorizationContractDigest,
  publishingApprovalRequestAuthorizationContractDigest,
} from "./authorization-contract";
import type {
  PublishingApprovalAuthorityAdminPort,
  PublishingApprovalAuthorityAdminMutationResult,
  PublishingApprovalAuthorityGrantRecord,
  PublishingApprovalAuthorityPort,
  PublishingApprovalAuthoritySession,
  PublishingApprovalConsumptionPort,
  PublishingApprovalConsumptionRecord,
  PublishingApprovalDecisionRecord,
  PublishingApprovalGovernanceBinding,
  PublishingApprovalMutationReceiptRecord,
  PublishingApprovalRepository,
  PublishingApprovalRequestRecord,
  PublishingApprovalRevisionPort,
  PublishingApprovalValidationPort,
  PublishingApprovalValidationSession,
} from "./types";
import {
  publishingApprovalInspectionDigest,
  publishingApprovalValidationBinding,
} from "./validation";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type RequestRow = typeof runtimePublishingApprovalRequests.$inferSelect;
type DecisionRow = typeof runtimePublishingApprovalDecisions.$inferSelect;
type ConsumptionRow = typeof runtimePublishingApprovalConsumptions.$inferSelect;
type GrantRow = typeof runtimePublishingApprovalAuthorityGrants.$inferSelect;
type RevocationRow =
  typeof runtimePublishingApprovalAuthorityRevocations.$inferSelect;

const AUTHORITY_SESSION_TTL_MS = 60_000;
const RELEASE_AUTHORIZATION_TTL_MS = 15 * 60_000;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const ARTIFACT_ID = new RegExp(ARTIFACT_ID_PATTERN);

class PublishingApprovalPersistenceUnavailable extends Error {}

function postgresDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new PublishingApprovalPersistenceUnavailable("Invalid database clock.");
  }
  return date;
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function sortedUnique(values: string[]): boolean {
  return (
    unique(values) &&
    values.every((value, index) => index === 0 || values[index - 1]! < value)
  );
}

function sameOrder(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function safeIds(value: unknown, max: number, sorted = false): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > max ||
    value.some((item) => typeof item !== "string" || !ID.test(item))
  ) {
    return null;
  }
  const ids = value as string[];
  return (sorted ? sortedUnique(ids) : unique(ids)) ? [...ids] : null;
}

function safeArtifactIds(value: unknown, sorted = false): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200 ||
    value.some((item) => typeof item !== "string" || !ARTIFACT_ID.test(item))) return null;
  const ids = value as string[];
  return (sorted ? sortedUnique(ids) : unique(ids)) ? [...ids] : null;
}

function safeEvidenceRef(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeGrantBindings(
  value: unknown,
): Array<{ channelId: string; grantId: string }> | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
  const grants: Array<{ channelId: string; grantId: string }> = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).sort().join(",") !== "channelId,grantId"
    ) return null;
    const binding = item as Record<string, unknown>;
    if (
      typeof binding.channelId !== "string" ||
      !ID.test(binding.channelId) ||
      typeof binding.grantId !== "string" ||
      !/^paag_[A-Za-z0-9_-]+$/.test(binding.grantId)
    ) return null;
    grants.push({ channelId: binding.channelId, grantId: binding.grantId });
  }
  return sortedUnique(grants.map((grant) => grant.channelId)) &&
    unique(grants.map((grant) => grant.grantId))
    ? grants
    : null;
}

function decisionRecord(row: DecisionRow | null): PublishingApprovalDecisionRecord | null {
  if (!row) return null;
  const authorityGrants = safeGrantBindings(row.authorityGrants);
  if (
    !authorityGrants ||
    !/^pad_[A-Za-z0-9_-]+$/.test(row.id) ||
    !ID.test(row.workspaceId) || !/^par_[A-Za-z0-9_-]+$/.test(row.requestId) ||
    !ID.test(row.decidedByUserId) || !safeEvidenceRef(row.authorityEvidenceRef) ||
    !DIGEST.test(row.authorityEvidenceDigest) ||
    !DIGEST.test(row.inspectionDigest) ||
    row.authorizesExecution !== false ||
    (row.outcome !== "approved" && row.outcome !== "denied")
  ) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    approvalRequestId: row.requestId,
    decision: row.outcome,
    decidedByUserId: row.decidedByUserId,
    authorityEvidenceRef: row.authorityEvidenceRef,
    authorityEvidenceDigest: row.authorityEvidenceDigest,
    authorityGrants,
    inspectionDigest: row.inspectionDigest,
    decidedAt: row.decidedAt,
    authorizesExecution: false,
  };
}

function authorizedResources(value: unknown): {
  channelIds: string[];
  artifactIds: string[];
} | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "artifactIds,channelIds"
  ) return null;
  const input = value as Record<string, unknown>;
  const channelIds = safeIds(input.channelIds, 50, true);
  const artifactIds = safeArtifactIds(input.artifactIds, true);
  return channelIds && artifactIds ? { channelIds, artifactIds } : null;
}

function governanceBinding(value: unknown): PublishingApprovalGovernanceBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "governanceRequestId,policyDigest,policyId,policyRevision,schema" ||
    row.schema !== "publishing-approval-governance-binding/v1" ||
    typeof row.governanceRequestId !== "string" || !ID.test(row.governanceRequestId) ||
    typeof row.policyId !== "string" || !ID.test(row.policyId) ||
    typeof row.policyRevision !== "number" || !Number.isInteger(row.policyRevision) || row.policyRevision < 1 ||
    typeof row.policyDigest !== "string" || !DIGEST.test(row.policyDigest)
  ) return null;
  return row as unknown as PublishingApprovalGovernanceBinding;
}

function consumptionRecord(row: ConsumptionRow | null): PublishingApprovalConsumptionRecord | null {
  if (!row) return null;
  const resources = authorizedResources(row.authorizedResources);
  if (
    !resources ||
    !/^pac_[A-Za-z0-9_-]+$/.test(row.id) || !ID.test(row.workspaceId) ||
    !/^par_[A-Za-z0-9_-]+$/.test(row.approvalRequestId) ||
    !/^pad_[A-Za-z0-9_-]+$/.test(row.decisionId) ||
    !ID.test(row.consumingPrincipalId) || !ID.test(row.consumingKeyId) ||
    !safeEvidenceRef(row.authorizationEvidenceRef) ||
    row.capability !== "publishing_plan_revisions.release@1" ||
    row.authorizationContractDigest !== publishingApprovalReleaseAuthorizationContractDigest() ||
    row.authorizationIssuedAt >= row.authorizationExpiresAt ||
    row.consumedAt < row.authorizationIssuedAt || row.consumedAt >= row.authorizationExpiresAt
  ) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    approvalRequestId: row.approvalRequestId,
    decisionId: row.decisionId,
    consumingPrincipalId: row.consumingPrincipalId,
    consumingKeyId: row.consumingKeyId,
    capability: "publishing_plan_revisions.release@1",
    authorizationContractDigest: row.authorizationContractDigest,
    authorizationEvidenceRef: row.authorizationEvidenceRef,
    authorizedResources: resources,
    authorizationIssuedAt: row.authorizationIssuedAt,
    authorizationExpiresAt: row.authorizationExpiresAt,
    consumedAt: row.consumedAt,
  };
}

function requestRecord(input: {
  request: RequestRow;
  decision: DecisionRow | null;
  consumption: ConsumptionRow | null;
}): PublishingApprovalRequestRecord | null {
  const row = input.request;
  const targetIds = safeIds(row.targetIds, 50);
  const channelIds = safeIds(row.channelIds, 50, true);
  const artifactIds = safeArtifactIds(row.artifactIds, true);
  const decision = decisionRecord(input.decision);
  const consumption = consumptionRecord(input.consumption);
  const policy = row.governancePolicy == null ? null : governanceBinding(row.governancePolicy);
  if (
    !targetIds ||
    !channelIds ||
    !artifactIds ||
    (row.governancePolicy != null && !policy) ||
    !/^par_[A-Za-z0-9_-]+$/.test(row.id) || !ID.test(row.workspaceId) ||
    !ID.test(row.planId) || !ID.test(row.planRevisionId) || row.planRevision < 1 ||
    !ID.test(row.requestingPrincipalId) || !ID.test(row.requestingKeyId) ||
    !safeEvidenceRef(row.requestAuthorizationEvidenceRef) ||
    canonicalDigest(targetIds) !== row.targetSetDigest ||
    row.action !== "publish" ||
    row.requestAuthorizationCapability !== "publishing_approvals.request@1" ||
    row.requestAuthorizationContractDigest !== publishingApprovalRequestAuthorizationContractDigest() ||
    !DIGEST.test(row.planRevisionDigest) ||
    !DIGEST.test(row.validationEvidenceDigest) ||
    !DIGEST.test(row.validationCurrentStateDigest) ||
    !DIGEST.test(row.validationContextDigest) ||
    !DIGEST.test(row.validationRuntimePolicyContractDigest) ||
    ((row.retrySourceDeliveryId === null) !==
      (row.retrySourceEvidenceDigest === null)) ||
    (row.retrySourceDeliveryId !== null && !ID.test(row.retrySourceDeliveryId)) ||
    (row.retrySourceEvidenceDigest !== null &&
      !DIGEST.test(row.retrySourceEvidenceDigest)) ||
    row.validationRuntimePolicyIdentity !== PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY ||
    row.validationRuntimePolicyContractDigest !== publishingPlanRuntimePolicyContractDigest() ||
    row.decisionPolicyMode !== "expires_at" ||
    row.validationEvaluatedAt >= row.validationExpiresAt ||
    row.createdAt >= row.decisionPolicyExpiresAt ||
    row.decisionPolicyExpiresAt > row.validationExpiresAt ||
    row.authorizesExecution !== false ||
    (input.decision && !decision) ||
    (input.consumption && !consumption) ||
    (decision && decision.approvalRequestId !== row.id) ||
    (decision && decision.decidedAt < row.createdAt) ||
    (consumption && consumption.approvalRequestId !== row.id) ||
    (consumption && (!decision || consumption.decisionId !== decision.id))
  ) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    planId: row.planId,
    planRevisionId: row.planRevisionId,
    planRevision: row.planRevision,
    planRevisionDigest: row.planRevisionDigest,
    action: "publish",
    targetIds,
    channelIds,
    artifactIds,
    retrySource: row.retrySourceDeliveryId === null ? null : {
      deliveryId: row.retrySourceDeliveryId,
      evidenceDigest: row.retrySourceEvidenceDigest!,
    },
    requestingPrincipalId: row.requestingPrincipalId,
    requestingKeyId: row.requestingKeyId,
    requestAuthorization: {
      capability: "publishing_approvals.request@1",
      contractDigest: row.requestAuthorizationContractDigest,
      evidenceRef: row.requestAuthorizationEvidenceRef,
      resources: { channelIds: [...channelIds], artifactIds: [...artifactIds] },
    },
    validation: {
      evidenceDigest: row.validationEvidenceDigest,
      currentStateDigest: row.validationCurrentStateDigest,
      contextId: row.validationContextId,
      contextDigest: row.validationContextDigest,
      evaluatedAt: row.validationEvaluatedAt.toISOString(),
      expiresAt: row.validationExpiresAt.toISOString(),
      runtimePolicyIdentity: row.validationRuntimePolicyIdentity,
      runtimePolicyContractDigest: row.validationRuntimePolicyContractDigest,
    },
    governancePolicy: policy,
    decisionPolicy: { mode: "expires_at", expiresAt: row.decisionPolicyExpiresAt },
    createdAt: row.createdAt,
    decision,
    consumption,
    authorizesExecution: false,
  };
}

function grantRecord(
  grant: GrantRow,
  revocation: RevocationRow | null,
): PublishingApprovalAuthorityGrantRecord | null {
  if (grant.action !== "publish" || !/^paag_[A-Za-z0-9_-]+$/.test(grant.id) ||
    !ID.test(grant.workspaceId) || !ID.test(grant.userId) || !ID.test(grant.channelId) ||
    !ID.test(grant.issuedByUserId) ||
    !["owner", "admin", "member"].includes(grant.subjectRoleAtIssue) ||
    (grant.expiresAt !== null && grant.expiresAt <= grant.issuedAt) ||
    (revocation && (!ID.test(revocation.revokedByUserId) || revocation.revokedAt < grant.issuedAt))) return null;
  return {
    id: grant.id,
    workspaceId: grant.workspaceId,
    userId: grant.userId,
    subjectRoleAtIssue: grant.subjectRoleAtIssue as "owner" | "admin" | "member",
    channelId: grant.channelId,
    action: "publish",
    issuedByUserId: grant.issuedByUserId,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    revokedAt: revocation?.revokedAt ?? null,
    revokedByUserId: revocation?.revokedByUserId ?? null,
  };
}

function receiptLock(input: {
  workspaceId: string;
  actorKind: string;
  actorId: string;
  capability: string;
  idempotencyKey: string;
}): string {
  return JSON.stringify(["publishing-approval-receipt", input.workspaceId,
    input.actorKind, input.actorId, input.capability, input.idempotencyKey]);
}

function approvalLock(workspaceId: string, requestId: string): string {
  return JSON.stringify(["publishing-approval-request", workspaceId, requestId]);
}

async function lockReceipt(
  tx: Tx,
  input: Parameters<PublishingApprovalRepository["readMutationReceipt"]>[0],
): Promise<Awaited<ReturnType<PublishingApprovalRepository["readMutationReceipt"]>>> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${receiptLock(input)}, 0))`);
  const rows = await tx.select().from(runtimePublishingApprovalMutationReceipts)
    .where(and(
      eq(runtimePublishingApprovalMutationReceipts.workspaceId, input.workspaceId),
      eq(runtimePublishingApprovalMutationReceipts.actorKind, input.actorKind),
      eq(runtimePublishingApprovalMutationReceipts.actorId, input.actorId),
      eq(runtimePublishingApprovalMutationReceipts.capability, input.capability),
      eq(runtimePublishingApprovalMutationReceipts.idempotencyKey, input.idempotencyKey),
    )).limit(1).for("update");
  const found = rows[0];
  if (!found) return { kind: "absent" };
  return found.requestFingerprint === input.requestFingerprint
    ? { kind: "replayed", approvalRequestId: found.approvalRequestId, decisionId: found.decisionId }
    : { kind: "conflict" };
}

export async function selectPublishingApprovalRequest(
  db: Db | Tx,
  input: { workspaceId: string; approvalRequestId: string; requestingPrincipalId?: string },
): Promise<PublishingApprovalRequestRecord | null> {
  const rows = await db.select({
    request: runtimePublishingApprovalRequests,
    decision: runtimePublishingApprovalDecisions,
    consumption: runtimePublishingApprovalConsumptions,
  }).from(runtimePublishingApprovalRequests)
    .leftJoin(runtimePublishingApprovalDecisions, and(
      eq(runtimePublishingApprovalDecisions.workspaceId, runtimePublishingApprovalRequests.workspaceId),
      eq(runtimePublishingApprovalDecisions.requestId, runtimePublishingApprovalRequests.id),
    ))
    .leftJoin(runtimePublishingApprovalConsumptions, and(
      eq(runtimePublishingApprovalConsumptions.workspaceId, runtimePublishingApprovalRequests.workspaceId),
      eq(runtimePublishingApprovalConsumptions.approvalRequestId, runtimePublishingApprovalRequests.id),
    ))
    .where(and(
      eq(runtimePublishingApprovalRequests.workspaceId, input.workspaceId),
      eq(runtimePublishingApprovalRequests.id, input.approvalRequestId),
      input.requestingPrincipalId
        ? eq(runtimePublishingApprovalRequests.requestingPrincipalId, input.requestingPrincipalId)
        : undefined,
    )).limit(1);
  return rows[0] ? requestRecord(rows[0]) : null;
}

function validationSessionMatches(
  request: PublishingApprovalRequestRecord,
  session: PublishingApprovalValidationSession,
): boolean {
  return session.schema === "publishing-approval-validation-session/v1" &&
    session.workspaceId === request.workspaceId &&
    session.planRevisionId === request.planRevisionId &&
    session.planRevisionDigest === request.planRevisionDigest &&
    sameOrder(session.targetIds, request.targetIds) &&
    canonicalDigest(session.binding) === canonicalDigest(request.validation) &&
    session.expiresAt.getTime() === new Date(request.validation.expiresAt).getTime() &&
    session.issuedAt >= new Date(request.validation.evaluatedAt) &&
    session.issuedAt <= session.expiresAt;
}

export async function lockCurrentPublishingApprovalRevision(
  tx: Tx,
  request: PublishingApprovalRequestRecord,
): Promise<PublishingPlanRevisionRecord | null> {
  const heads = await tx.select().from(runtimePublishingPlans).where(and(
    eq(runtimePublishingPlans.workspaceId, request.workspaceId),
    eq(runtimePublishingPlans.id, request.planId),
  )).limit(1).for("share");
  if (heads[0]?.currentRevision !== request.planRevision) return null;
  return lockRetainedPublishingApprovalRevision(tx, request);
}

/**
 * Locks the exact revision sealed into a consumed Approval. Unlike admission-time
 * validation this deliberately does not require the Plan to still point at that
 * revision: a later Plan edit cannot rewrite or revoke an already accepted
 * Delivery.
 */
export async function lockRetainedPublishingApprovalRevision(
  tx: Tx,
  request: PublishingApprovalRequestRecord,
): Promise<PublishingPlanRevisionRecord | null> {
  const revisions = await tx.select().from(runtimePublishingPlanRevisions).where(and(
    eq(runtimePublishingPlanRevisions.workspaceId, request.workspaceId),
    eq(runtimePublishingPlanRevisions.planId, request.planId),
    eq(runtimePublishingPlanRevisions.id, request.planRevisionId),
    eq(runtimePublishingPlanRevisions.revision, request.planRevision),
    eq(runtimePublishingPlanRevisions.definitionDigest, request.planRevisionDigest),
  )).limit(1).for("share");
  const revision = revisions[0]
    ? rehydratePublishingPlanRevision(revisions[0])
    : null;
  if (!revision) return null;
  const targetIds = revision.definition.targets
    .filter((target) => request.targetIds.includes(target.targetId))
    .map((target) => target.targetId);
  const selectedTargets = revision.definition.targets
    .filter((target) => request.targetIds.includes(target.targetId));
  const selectedArtifactIds = [...new Set(selectedTargets.flatMap((target) => [
    target.contentArtifactId,
    ...target.mediaArtifactIds,
  ]))].sort();
  return sameOrder(targetIds, request.targetIds) &&
    sameSet(request.channelIds, selectedTargets
      .map((target) => target.channelId).filter((id, i, all) => all.indexOf(id) === i)) &&
    sameOrder(request.artifactIds, selectedArtifactIds) &&
    canonicalDigest(publishingApprovalValidationBinding({ revision, targetIds })) ===
      canonicalDigest(request.validation)
    ? revision
    : null;
}

export async function verifyCurrentPublishingPlanEvidence(
  tx: Tx,
  revision: PublishingPlanRevisionRecord,
  validationExpiresAt: Date,
  targetIds?: string[],
  options?: { allowDuePublishAt?: boolean },
): Promise<Date | null> {
  const evidence = revision.validationEvidence;
  const selectedTargetIds = targetIds ? new Set(targetIds) : null;
  const targets = selectedTargetIds
    ? revision.definition.targets.filter((target) => selectedTargetIds.has(target.targetId))
    : revision.definition.targets;
  if (selectedTargetIds && targets.length !== selectedTargetIds.size) return null;
  const artifactIds = [...new Set(targets.flatMap((target) => [
    target.contentArtifactId,
    ...target.mediaArtifactIds,
  ]))].sort();
  const channelIds = [...new Set(targets.map((target) => target.channelId))].sort();
  const initialClock = await tx.select({ databaseNow: sql<unknown>`statement_timestamp()` })
    .from(runtimePublishingPlanRevisions)
    .where(and(eq(runtimePublishingPlanRevisions.workspaceId, revision.workspaceId), eq(runtimePublishingPlanRevisions.id, revision.id)))
    .limit(1);
  const databaseNow = initialClock[0] ? postgresDate(initialClock[0].databaseNow) : null;
  if (!databaseNow || databaseNow >= validationExpiresAt) return null;

  const artifactRows = await tx.select({ artifact: artifacts, content: artifactContents })
    .from(artifacts).innerJoin(artifactContents, and(
      eq(artifactContents.workspaceId, artifacts.workspaceId),
      eq(artifactContents.digest, artifacts.contentDigest),
    )).where(and(
      eq(artifacts.workspaceId, revision.workspaceId),
      inArray(artifacts.id, artifactIds),
    )).orderBy(asc(artifacts.id)).for("share");
  if (artifactRows.length !== artifactIds.length) return null;
  const artifactById = new Map(artifactRows.map((row) => [row.artifact.id, row] as const));

  const channels = await tx.select().from(socialAccounts).where(and(
      eq(socialAccounts.workspaceId, revision.workspaceId),
      inArray(socialAccounts.id, channelIds),
    )).orderBy(asc(socialAccounts.id)).for("share");
  if (channels.length !== channelIds.length) return null;
  const channelById = new Map(channels.map((row) => [row.id, row] as const));

  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-budget-spend:${revision.workspaceId}`}, 0))`);
  const spendRows = await tx.select().from(runtimeSpendControls)
    .where(eq(runtimeSpendControls.workspaceId, revision.workspaceId)).limit(1).for("share");
  const suspended = spendRows[0]?.suspended ?? false;
  const policyContractDigest = publishingPlanRuntimePolicyContractDigest();
  const policyStateDigest = publishingPlanPolicyStateDigest({
    identity: PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
    contractDigest: policyContractDigest,
    workspaceId: revision.workspaceId,
    suspended,
  });
  if (
    suspended ||
    evidence.runtimePolicy.identity !== PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY ||
    evidence.runtimePolicy.contractDigest !== policyContractDigest
  ) return null;

  const capabilityVersion = publishingPlanLinkedInCapabilityVersion();
  for (const target of targets) {
    const targetEvidence = evidence.targets.find((candidate) =>
      candidate.targetId === target.targetId);
    const account = channelById.get(target.channelId);
    const authorKind = account ? readLinkedInAuthorKind(account.additionalSettings) : null;
    if (
      !targetEvidence?.channel || !account || account.platform !== "linkedin" ||
      !authorKind || account.disabled || account.requiresReauth ||
      (account.tokenExpiresAt !== null && account.tokenExpiresAt <= databaseNow && !account.refreshTokenEncrypted) ||
      target.settings.type !== authorKind || targetEvidence.channel.authorKind !== authorKind ||
      targetEvidence.channel.capabilityVersion !== capabilityVersion ||
      targetEvidence.policyStateDigest !== policyStateDigest
    ) return null;
    const channelVersionDigest = publishingPlanChannelVersionDigest({
      id: account.id, workspaceId: account.workspaceId, platform: "linkedin", authorKind,
      disabled: account.disabled, requiresReauth: account.requiresReauth,
      tokenExpiresAt: account.tokenExpiresAt,
      hasRefreshToken: Boolean(account.refreshTokenEncrypted),
      updatedAt: account.updatedAt, capabilityVersion,
    });
    const channelSnapshotDigest = canonicalDigest({
      id: account.id, workspaceId: account.workspaceId, platform: "linkedin", authorKind,
      versionDigest: channelVersionDigest, state: "active", capabilityVersion,
      maxContentLength: PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.maxContentLength,
      supportsImages: PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.supportsImages,
      maxImages: PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.maxImages,
    });
    if (targetEvidence.channel.snapshotDigest !== channelSnapshotDigest) return null;

    const targetArtifactIds = [target.contentArtifactId, ...target.mediaArtifactIds];
    if (targetEvidence.artifacts.length !== targetArtifactIds.length) return null;
    for (const [artifactIndex, artifactId] of targetArtifactIds.entries()) {
      const row = artifactById.get(artifactId);
      const snapshot = targetEvidence.artifacts[artifactIndex];
      if (!row || !snapshot || row.artifact.deletedAt !== null ||
        snapshot.id !== artifactId || snapshot.digest !== row.artifact.contentDigest ||
        snapshot.kind !== row.artifact.kind || snapshot.mediaType !== row.artifact.mediaType ||
        snapshot.sizeBytes !== row.artifact.sizeBytes) return null;
      const versionDigest = publishingPlanArtifactVersionDigest({
        id: row.artifact.id, workspaceId: row.artifact.workspaceId,
        digest: row.artifact.contentDigest, kind: row.artifact.kind as "text" | "image",
        mediaType: row.artifact.mediaType, sizeBytes: row.artifact.sizeBytes,
        width: row.content.width, height: row.content.height,
        createdAt: row.artifact.createdAt, deletedAt: row.artifact.deletedAt,
      });
      if (snapshot.snapshotDigest !== canonicalDigest({
        id: row.artifact.id, workspaceId: row.artifact.workspaceId,
        digest: row.artifact.contentDigest, versionDigest, kind: row.artifact.kind,
        mediaType: row.artifact.mediaType, sizeBytes: row.artifact.sizeBytes,
        width: row.content.width, height: row.content.height, deletedAt: null,
      })) return null;
    }
  }

  const finalClock = await tx.select({ databaseNow: sql<unknown>`clock_timestamp()` })
    .from(runtimePublishingPlanRevisions)
    .where(and(eq(runtimePublishingPlanRevisions.workspaceId, revision.workspaceId), eq(runtimePublishingPlanRevisions.id, revision.id)))
    .limit(1);
  const finalNow = finalClock[0] ? postgresDate(finalClock[0].databaseNow) : null;
  return finalNow && finalNow < validationExpiresAt &&
    !channels.some((channel) =>
      channel.tokenExpiresAt !== null &&
      channel.tokenExpiresAt <= finalNow &&
      !channel.refreshTokenEncrypted,
    ) &&
    (options?.allowDuePublishAt === true || !targets.some((target) =>
      target.timing.kind === "scheduled" &&
      new Date(target.timing.publishAt) <= finalNow,
    ))
    ? finalNow
    : null;
}

async function verifyRequestAuthorization(
  tx: Tx,
  request: PublishingApprovalRequestRecord,
  at: Date,
): Promise<boolean> {
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
      eq(agentAuthorizationDecisions.workspaceId, request.workspaceId),
      eq(agentAuthorizationDecisions.principalId, request.requestingPrincipalId),
      eq(agentAuthorizationDecisions.keyId, request.requestingKeyId),
      eq(agentAuthorizationDecisions.operatorTraceRef, request.requestAuthorization.evidenceRef),
      eq(agentAuthorizationDecisions.capabilityName, PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.request.name),
      eq(agentAuthorizationDecisions.capabilityVersion, PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.request.version),
      eq(agentAuthorizationDecisions.authorizationContractDigest, request.requestAuthorization.contractDigest),
      eq(agentAuthorizationDecisions.outcome, "allowed"),
    )).limit(1).for("share");
  const row = rows[0];
  if (!row || row.principalStatus !== "active" || row.principalRevokedAt ||
    row.keyRevokedAt || (row.keyExpiresAt && row.keyExpiresAt <= at)) return false;
  const channels = row.decision.resources.filter((r) => r.kind === "channel").map((r) => r.id);
  const artifactsAllowed = row.decision.resources.filter((r) => r.kind === "artifact").map((r) => r.id);
  return unique(channels) && unique(artifactsAllowed) &&
    sameSet(channels, request.channelIds) && sameSet(artifactsAllowed, request.artifactIds);
}

async function lockCurrentApprovalRetrySource(
  tx: Tx,
  request: PublishingApprovalRequestRecord,
): Promise<boolean> {
  if (!request.retrySource) return true;
  const sources = await tx.select().from(runtimePublishingDeliveries).where(and(
    eq(runtimePublishingDeliveries.workspaceId, request.workspaceId),
    eq(runtimePublishingDeliveries.id, request.retrySource.deliveryId),
  )).limit(1).for("share");
  const source = sources[0];
  const normalizedFailure = source && (
    (source.state === "failed_transient" && source.failureClass === "transient" &&
      source.failureRetryable === true) ||
    (source.state === "failed_terminal" && source.failureClass === "terminal" &&
      source.failureRetryable === false)
  );
  return Boolean(source && source.desiredState === "publish" && normalizedFailure &&
    (source.failureEffectDisposition === "not_created" ||
      source.failureEffectDisposition === "provider_failed_known") &&
    source.latestEffectEvidenceDigest === request.retrySource.evidenceDigest &&
    source.requestingPrincipalId === request.requestingPrincipalId &&
    source.planId === request.planId &&
    source.planRevisionId === request.planRevisionId &&
    source.planRevision === request.planRevision &&
    source.planRevisionDigest === request.planRevisionDigest &&
    sameOrder(request.targetIds, [source.targetId]) &&
    sameOrder(request.channelIds, [source.channelId]) &&
    sameSet(request.artifactIds, source.artifactIds));
}

function authorityEvidence(input: {
  workspaceId: string; userId: string; subjectRole: "owner" | "admin" | "member";
  action: "publish"; channelIds: string[];
  grants: Array<{ channelId: string; grantId: string }>;
  issuedAt: Date; expiresAt: Date;
}): { evidenceRef: string; evidenceDigest: string } {
  const evidenceDigest = canonicalDigest({
    schema: "publishing-approval-authority-evidence/v1",
    workspaceId: input.workspaceId, userId: input.userId,
    subjectRole: input.subjectRole, action: input.action,
    channelIds: input.channelIds, grants: input.grants,
    issuedAt: input.issuedAt.toISOString(), expiresAt: input.expiresAt.toISOString(),
  });
  return { evidenceDigest, evidenceRef: `paae_${evidenceDigest.slice("sha256:".length)}` };
}

async function lockCurrentAuthority(
  tx: Tx,
  session: PublishingApprovalAuthoritySession,
  request: PublishingApprovalRequestRecord,
  at: Date,
): Promise<boolean> {
  if (
    session.schema !== "publishing-approval-authority-session/v1" ||
    session.workspaceId !== request.workspaceId ||
    session.action !== request.action ||
    !sameOrder(session.channelIds, request.channelIds) ||
    session.grants.length !== request.channelIds.length ||
    !sameOrder(session.grants.map((grant) => grant.channelId), request.channelIds) ||
    session.issuedAt > at || session.expiresAt <= at
  ) return false;
  const expected = authorityEvidence(session);
  if (expected.evidenceDigest !== session.evidenceDigest || expected.evidenceRef !== session.evidenceRef) return false;

  const members = await tx.select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers).innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, request.workspaceId), eq(workspaceMembers.userId, session.userId)))
    .limit(1).for("share");
  if (!members[0] || members[0].role !== session.subjectRole ||
    !["owner", "admin", "member"].includes(session.subjectRole)) return false;

  const grantIds = session.grants.map((grant) => grant.grantId).sort();
  // Lock grant parents in one deterministic order. A revocation insert must
  // acquire an FK key-share lock on the same parent, so this closes the race
  // between the decision's authority check and an administrator revoking it.
  const grantRows = await tx.select().from(runtimePublishingApprovalAuthorityGrants)
    .where(and(
      eq(runtimePublishingApprovalAuthorityGrants.workspaceId, request.workspaceId),
      inArray(runtimePublishingApprovalAuthorityGrants.id, grantIds),
    )).orderBy(asc(runtimePublishingApprovalAuthorityGrants.id)).for("update");
  if (grantRows.length !== grantIds.length) return false;
  const revocationRows = await tx.select().from(runtimePublishingApprovalAuthorityRevocations)
    .where(and(
      eq(runtimePublishingApprovalAuthorityRevocations.workspaceId, request.workspaceId),
      inArray(runtimePublishingApprovalAuthorityRevocations.grantId, grantIds),
    ));
  const revoked = new Set(revocationRows.map((row) => row.grantId));
  const byId = new Map(grantRows.map((grant) => [grant.id, grant] as const));
  return session.grants.every((binding) => {
    const grant = byId.get(binding.grantId);
    return grant && grant.userId === session.userId &&
      grant.channelId === binding.channelId && grant.action === request.action &&
      grant.issuedAt <= at && !revoked.has(grant.id) &&
      (!grant.expiresAt || grant.expiresAt > at);
  });
}

function receiptValues(
  receipt: PublishingApprovalMutationReceiptRecord,
  request?: PublishingApprovalRequestRecord,
) {
  return {
    ...receipt,
    principalId: receipt.actorKind === "agent" ? receipt.actorId : null,
    keyId: receipt.actorKind === "agent" ? request?.requestingKeyId ?? null : null,
    authorizationEvidenceRef: receipt.actorKind === "agent"
      ? request?.requestAuthorization.evidenceRef ?? null : null,
    userId: receipt.actorKind === "human" ? receipt.actorId : null,
  };
}

export class DrizzlePublishingApprovalRepository
  implements PublishingApprovalRepository, PublishingApprovalConsumptionPort {
  constructor(private readonly database: () => Db) {}

  async readMutationReceipt(input: Parameters<PublishingApprovalRepository["readMutationReceipt"]>[0]) {
    try {
      const rows = await this.database().select().from(runtimePublishingApprovalMutationReceipts)
        .where(and(
          eq(runtimePublishingApprovalMutationReceipts.workspaceId, input.workspaceId),
          eq(runtimePublishingApprovalMutationReceipts.actorKind, input.actorKind),
          eq(runtimePublishingApprovalMutationReceipts.actorId, input.actorId),
          eq(runtimePublishingApprovalMutationReceipts.capability, input.capability),
          eq(runtimePublishingApprovalMutationReceipts.idempotencyKey, input.idempotencyKey),
        )).limit(1);
      const found = rows[0];
      if (!found) return { kind: "absent" as const };
      return found.requestFingerprint === input.requestFingerprint
        ? { kind: "replayed" as const, approvalRequestId: found.approvalRequestId, decisionId: found.decisionId }
        : { kind: "conflict" as const };
    } catch { return { kind: "absent" as const }; }
  }

  async createRequest(input: Parameters<PublishingApprovalRepository["createRequest"]>[0]) {
    const request = input.request;
    if (
      request.decision || request.consumption || request.authorizesExecution !== false ||
      request.requestAuthorization.contractDigest !== publishingApprovalRequestAuthorizationContractDigest() ||
      request.validation.runtimePolicyIdentity !== PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY ||
      request.validation.runtimePolicyContractDigest !== publishingPlanRuntimePolicyContractDigest() ||
      request.workspaceId !== input.receipt.workspaceId ||
      request.requestingPrincipalId !== input.receipt.actorId ||
      input.receipt.actorKind !== "agent" ||
      input.receipt.approvalRequestId !== request.id ||
      input.receipt.decisionId !== null ||
      !validationSessionMatches(request, input.validationSession) ||
      !safeIds(request.targetIds, 50) || !safeIds(request.channelIds, 50, true) ||
      !safeArtifactIds(request.artifactIds, true)
    ) return { kind: "unavailable" as const };
    try {
      return await this.database().transaction(async (tx) => {
        const receipt = await lockReceipt(tx, input.receipt);
        if (receipt.kind === "conflict") return { kind: "conflict" as const };
        if (receipt.kind === "replayed") {
          const replay = await selectPublishingApprovalRequest(tx, { workspaceId: request.workspaceId, approvalRequestId: receipt.approvalRequestId, requestingPrincipalId: request.requestingPrincipalId });
          return replay ? { kind: "replayed" as const, request: replay } : { kind: "unavailable" as const };
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${approvalLock(request.workspaceId, request.id)}, 0))`);
        const revision = await lockCurrentPublishingApprovalRevision(tx, request);
        if (!revision) return { kind: "stale_revision" as const };
        if (!await lockCurrentApprovalRetrySource(tx, request)) {
          return { kind: "stale_validation" as const };
        }
        const finalNow = await verifyCurrentPublishingPlanEvidence(
          tx, revision, input.validationSession.expiresAt, undefined,
          { allowDuePublishAt: request.retrySource !== null },
        );
        if (!finalNow || finalNow >= request.decisionPolicy.expiresAt ||
          finalNow < input.validationSession.issuedAt) return { kind: "stale_validation" as const };
        if (!await verifyRequestAuthorization(tx, request, finalNow)) return { kind: "unavailable" as const };
        // Authorization rows are locked after the initial evidence check and may
        // have waited. Re-run concrete evidence checks so Channel tokens and
        // scheduled times cannot become stale while those locks are acquired.
        const authorizationNow = await verifyCurrentPublishingPlanEvidence(
          tx,
          revision,
          input.validationSession.expiresAt,
          undefined,
          { allowDuePublishAt: request.retrySource !== null },
        );
        if (!authorizationNow || authorizationNow >= request.decisionPolicy.expiresAt ||
          authorizationNow >= input.validationSession.expiresAt ||
          authorizationNow < input.validationSession.issuedAt ||
          (request.retrySource === null && revision.definition.targets.some((target) =>
            target.timing.kind === "scheduled" &&
            new Date(target.timing.publishAt) <= authorizationNow,
          ))) {
          return { kind: "stale_validation" as const };
        }
        if (!await verifyRequestAuthorization(tx, request, authorizationNow)) {
          return { kind: "unavailable" as const };
        }
        if (!await lockCurrentApprovalRetrySource(tx, request)) {
          return { kind: "stale_validation" as const };
        }
        await tx.insert(runtimePublishingApprovalRequests).values({
          workspaceId: request.workspaceId, id: request.id, planId: request.planId,
          planRevisionId: request.planRevisionId, planRevision: request.planRevision,
          planRevisionDigest: request.planRevisionDigest, action: request.action,
          targetIds: request.targetIds, targetSetDigest: canonicalDigest(request.targetIds),
          channelIds: request.channelIds, artifactIds: request.artifactIds,
          retrySourceDeliveryId: request.retrySource?.deliveryId ?? null,
          retrySourceEvidenceDigest: request.retrySource?.evidenceDigest ?? null,
          requestingPrincipalId: request.requestingPrincipalId, requestingKeyId: request.requestingKeyId,
          requestAuthorizationCapability: request.requestAuthorization.capability,
          requestAuthorizationContractDigest: request.requestAuthorization.contractDigest,
          requestAuthorizationEvidenceRef: request.requestAuthorization.evidenceRef,
          validationEvidenceDigest: request.validation.evidenceDigest,
          validationCurrentStateDigest: request.validation.currentStateDigest,
          validationContextId: request.validation.contextId,
          validationContextDigest: request.validation.contextDigest,
          validationEvaluatedAt: new Date(request.validation.evaluatedAt),
          validationExpiresAt: new Date(request.validation.expiresAt),
          validationRuntimePolicyIdentity: request.validation.runtimePolicyIdentity,
          validationRuntimePolicyContractDigest: request.validation.runtimePolicyContractDigest,
          governancePolicy: request.governancePolicy,
          decisionPolicyMode: request.decisionPolicy.mode,
          decisionPolicyExpiresAt: request.decisionPolicy.expiresAt,
          authorizesExecution: false, createdAt: request.createdAt,
        });
        if (request.retrySource) {
          await tx.insert(runtimePublishingApprovalRetrySources).values({
            workspaceId: request.workspaceId,
            approvalRequestId: request.id,
            sourceDeliveryId: request.retrySource.deliveryId,
            sourceEvidenceDigest: request.retrySource.evidenceDigest,
            createdAt: authorizationNow,
          });
        }
        await tx.insert(runtimePublishingApprovalMutationReceipts).values(receiptValues(input.receipt, request));
        return { kind: "created" as const, request: structuredClone(request) };
      });
    } catch { return { kind: "unavailable" as const }; }
  }

  getRequest(input: Parameters<PublishingApprovalRepository["getRequest"]>[0]) {
    return selectPublishingApprovalRequest(this.database(), input);
  }

  async listRequests(input: Parameters<PublishingApprovalRepository["listRequests"]>[0]) {
    const status = input.filters.status;
    const rows = await this.database().select({
      request: runtimePublishingApprovalRequests,
      decision: runtimePublishingApprovalDecisions,
      consumption: runtimePublishingApprovalConsumptions,
    }).from(runtimePublishingApprovalRequests)
      .leftJoin(runtimePublishingApprovalDecisions, and(
        eq(runtimePublishingApprovalDecisions.workspaceId, runtimePublishingApprovalRequests.workspaceId),
        eq(runtimePublishingApprovalDecisions.requestId, runtimePublishingApprovalRequests.id),
      )).leftJoin(runtimePublishingApprovalConsumptions, and(
        eq(runtimePublishingApprovalConsumptions.workspaceId, runtimePublishingApprovalRequests.workspaceId),
        eq(runtimePublishingApprovalConsumptions.approvalRequestId, runtimePublishingApprovalRequests.id),
      )).where(and(
        eq(runtimePublishingApprovalRequests.workspaceId, input.workspaceId),
        input.filters.requestingPrincipalId ? eq(runtimePublishingApprovalRequests.requestingPrincipalId, input.filters.requestingPrincipalId) : undefined,
        input.filters.planRevisionId ? eq(runtimePublishingApprovalRequests.planRevisionId, input.filters.planRevisionId) : undefined,
        input.filters.authorizedChannelIds ? sql`${runtimePublishingApprovalRequests.channelIds} <@ ${JSON.stringify(input.filters.authorizedChannelIds)}::jsonb` : undefined,
        input.filters.authorizedArtifactIds ? sql`${runtimePublishingApprovalRequests.artifactIds} <@ ${JSON.stringify(input.filters.authorizedArtifactIds)}::jsonb` : undefined,
        status === "consumed" ? sql`${runtimePublishingApprovalConsumptions.id} is not null` :
          status === "approved" ? and(eq(runtimePublishingApprovalDecisions.outcome, "approved"), isNull(runtimePublishingApprovalConsumptions.id)) :
          status === "denied" ? eq(runtimePublishingApprovalDecisions.outcome, "denied") :
          status === "expired" ? and(isNull(runtimePublishingApprovalDecisions.id), sql`${runtimePublishingApprovalRequests.decisionPolicyExpiresAt} <= ${input.evaluatedAt}`) :
          status === "pending" ? and(isNull(runtimePublishingApprovalDecisions.id), gt(runtimePublishingApprovalRequests.decisionPolicyExpiresAt, input.evaluatedAt)) : undefined,
        input.before ? or(
          lt(runtimePublishingApprovalRequests.createdAt, input.before.createdAt),
          and(eq(runtimePublishingApprovalRequests.createdAt, input.before.createdAt), lt(runtimePublishingApprovalRequests.id, input.before.id)),
        ) : undefined,
      )).orderBy(desc(runtimePublishingApprovalRequests.createdAt), desc(runtimePublishingApprovalRequests.id))
      .limit(input.limit);
    return rows.map(requestRecord).filter((row): row is PublishingApprovalRequestRecord => Boolean(row));
  }

  async decide(input: Parameters<PublishingApprovalRepository["decide"]>[0]) {
    if (
      input.receipt.actorKind !== "human" || input.receipt.actorId !== input.decision.decidedByUserId ||
      input.receipt.approvalRequestId !== input.decision.approvalRequestId ||
      input.receipt.decisionId !== input.decision.id ||
      input.decision.inspectionDigest !== input.expectedInspectionDigest ||
      input.decision.workspaceId !== input.receipt.workspaceId ||
      !/^pad_[A-Za-z0-9_-]+$/.test(input.decision.id) ||
      !safeEvidenceRef(input.decision.authorityEvidenceRef) ||
      !DIGEST.test(input.decision.authorityEvidenceDigest) ||
      input.decision.authorityEvidenceRef !== input.authoritySession.evidenceRef ||
      input.decision.authorityEvidenceDigest !== input.authoritySession.evidenceDigest ||
      canonicalDigest(input.authoritySession.grants) !== canonicalDigest(input.decision.authorityGrants)
    ) return { kind: "unavailable" as const };
    try {
      return await this.database().transaction(async (tx) => {
        const receipt = await lockReceipt(tx, input.receipt);
        if (receipt.kind === "conflict") return { kind: "conflict" as const };
        if (receipt.kind === "replayed") {
          const replay = await selectPublishingApprovalRequest(tx, { workspaceId: input.decision.workspaceId, approvalRequestId: receipt.approvalRequestId });
          return replay ? { kind: "replayed" as const, request: replay } : { kind: "unavailable" as const };
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${approvalLock(input.decision.workspaceId, input.decision.approvalRequestId)}, 0))`);
        const request = await selectPublishingApprovalRequest(tx, { workspaceId: input.decision.workspaceId, approvalRequestId: input.decision.approvalRequestId });
        if (!request) return { kind: "unavailable" as const };
        if (publishingApprovalInspectionDigest(request) !== input.expectedInspectionDigest) return { kind: "stale_view" as const };
        if (request.decision) return { kind: "final" as const };
        const initialClock = await tx.select({ databaseNow: sql<unknown>`statement_timestamp()` })
          .from(runtimePublishingApprovalRequests)
          .where(and(eq(runtimePublishingApprovalRequests.workspaceId, request.workspaceId), eq(runtimePublishingApprovalRequests.id, request.id))).limit(1);
        const databaseNow = initialClock[0] ? postgresDate(initialClock[0].databaseNow) : null;
        if (!databaseNow || databaseNow >= request.decisionPolicy.expiresAt) return { kind: "expired" as const };
        if (!validationSessionMatches(request, input.validationSession)) return { kind: "stale_validation" as const };
        const revision = await lockCurrentPublishingApprovalRevision(tx, request);
        if (!revision) return { kind: "stale_revision" as const };
        if (!await lockCurrentApprovalRetrySource(tx, request)) {
          return { kind: "stale_validation" as const };
        }
        const evidenceNow = await verifyCurrentPublishingPlanEvidence(
          tx, revision, input.validationSession.expiresAt, undefined,
          { allowDuePublishAt: request.retrySource !== null },
        );
        if (!evidenceNow || evidenceNow < input.validationSession.issuedAt) return { kind: "stale_validation" as const };
        if (!await lockCurrentAuthority(tx, input.authoritySession, request, evidenceNow)) return { kind: "authority_stale" as const };
        // Authority locks can wait after the first evidence read. Revalidate all
        // concrete evidence with a fresh DB clock before persisting the decision.
        const finalNow = await verifyCurrentPublishingPlanEvidence(
          tx,
          revision,
          input.validationSession.expiresAt,
          undefined,
          { allowDuePublishAt: request.retrySource !== null },
        );
        if (!finalNow || finalNow >= request.decisionPolicy.expiresAt) return { kind: "expired" as const };
        if (finalNow >= input.validationSession.expiresAt) return { kind: "stale_validation" as const };
        if (finalNow >= input.authoritySession.expiresAt ||
          !await lockCurrentAuthority(tx, input.authoritySession, request, finalNow)) return { kind: "authority_stale" as const };
        if (!await lockCurrentApprovalRetrySource(tx, request)) {
          return { kind: "stale_validation" as const };
        }
        const decision: PublishingApprovalDecisionRecord = { ...input.decision, decidedAt: finalNow };
        await tx.insert(runtimePublishingApprovalDecisions).values({
          workspaceId: decision.workspaceId, id: decision.id,
          requestId: decision.approvalRequestId, outcome: decision.decision,
          decidedByUserId: decision.decidedByUserId,
          authorityEvidenceRef: decision.authorityEvidenceRef,
          authorityEvidenceDigest: decision.authorityEvidenceDigest,
          authorityGrants: decision.authorityGrants,
          inspectionDigest: decision.inspectionDigest,
          authorizesExecution: false, decidedAt: decision.decidedAt,
        });
        await tx.insert(runtimePublishingApprovalMutationReceipts).values(receiptValues(input.receipt));
        return { kind: "decided" as const, request: { ...request, decision } };
      });
    } catch { return { kind: "unavailable" as const }; }
  }

  async consume(input: Parameters<PublishingApprovalConsumptionPort["consume"]>[0]) {
    const consumption = input.consumption;
    try {
      return await this.database().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["publishing-approval-consumption", consumption.workspaceId, consumption.decisionId])}, 0))`);
        const prior = await tx.select({ id: runtimePublishingApprovalConsumptions.id })
          .from(runtimePublishingApprovalConsumptions).where(and(
            eq(runtimePublishingApprovalConsumptions.workspaceId, consumption.workspaceId),
            eq(runtimePublishingApprovalConsumptions.decisionId, consumption.decisionId),
          )).limit(1).for("update");
        const retryPrior = await tx.select({
          id: runtimePublishingDeliveryRetryApprovalConsumptions.id,
        }).from(runtimePublishingDeliveryRetryApprovalConsumptions).where(and(
          eq(runtimePublishingDeliveryRetryApprovalConsumptions.workspaceId,
            consumption.workspaceId),
          eq(runtimePublishingDeliveryRetryApprovalConsumptions.approvalDecisionId,
            consumption.decisionId),
        )).limit(1).for("update");
        if (prior[0] || retryPrior[0]) return "already_consumed" as const;
        const request = await selectPublishingApprovalRequest(tx, { workspaceId: consumption.workspaceId, approvalRequestId: consumption.approvalRequestId });
        if (!request?.decision || request.decision.decision !== "approved" ||
          request.decision.id !== consumption.decisionId || request.consumption ||
          consumption.capability !== "publishing_plan_revisions.release@1" ||
          consumption.authorizationContractDigest !== publishingApprovalReleaseAuthorizationContractDigest() ||
          !sameSet(consumption.authorizedResources.channelIds, request.channelIds) ||
          !sameSet(consumption.authorizedResources.artifactIds, request.artifactIds)) return "invalid" as const;
        if (!request.governancePolicy) return "invalid" as const;
        const governanceRows = await tx.select({
          status: workspaceGovernanceResources.status,
          body: workspaceGovernanceResources.body,
        }).from(workspaceGovernanceResources).where(and(
          eq(workspaceGovernanceResources.workspaceId, request.workspaceId),
          eq(workspaceGovernanceResources.kind, "approval_request"),
          eq(workspaceGovernanceResources.id, request.governancePolicy.governanceRequestId),
        )).limit(1).for("share");
        const governance = governanceRows[0];
        const governanceBody = governance?.body as Record<string, unknown> | undefined;
        if (
          governance?.status !== "accepted" ||
          governanceBody?.purpose !== "publishing_approval" ||
          governanceBody.runtimeApprovalRequestId !== request.id ||
          governanceBody.planRevisionId !== request.planRevisionId ||
          governanceBody.planRevisionDigest !== request.planRevisionDigest ||
          governanceBody.policyId !== request.governancePolicy.policyId ||
          governanceBody.policyRevision !== request.governancePolicy.policyRevision ||
          governanceBody.policyDigest !== request.governancePolicy.policyDigest
        ) return "invalid" as const;
        const authRows = await tx.select({
          decision: agentAuthorizationDecisions,
          principalStatus: agentPrincipals.status, principalRevokedAt: agentPrincipals.revokedAt,
          keyRevokedAt: agentKeys.revokedAt, keyExpiresAt: agentKeys.expiresAt,
          databaseNow: sql<unknown>`statement_timestamp()`,
        }).from(agentAuthorizationDecisions)
          .innerJoin(agentPrincipals, and(eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId), eq(agentPrincipals.id, agentAuthorizationDecisions.principalId)))
          .innerJoin(agentKeys, and(eq(agentKeys.principalId, agentAuthorizationDecisions.principalId), eq(agentKeys.id, agentAuthorizationDecisions.keyId)))
          .where(and(
            eq(agentAuthorizationDecisions.workspaceId, consumption.workspaceId),
            eq(agentAuthorizationDecisions.principalId, consumption.consumingPrincipalId),
            eq(agentAuthorizationDecisions.keyId, consumption.consumingKeyId),
            eq(agentAuthorizationDecisions.operatorTraceRef, consumption.authorizationEvidenceRef),
            eq(agentAuthorizationDecisions.capabilityName, "publishing_plan_revisions.release"),
            eq(agentAuthorizationDecisions.capabilityVersion, 1),
            eq(agentAuthorizationDecisions.authorizationContractDigest, consumption.authorizationContractDigest),
            eq(agentAuthorizationDecisions.outcome, "allowed"),
          )).limit(1).for("share");
        const auth = authRows[0];
        const now = auth ? postgresDate(auth.databaseNow) : null;
        if (!auth || !now || auth.principalStatus !== "active" || auth.principalRevokedAt || auth.keyRevokedAt ||
          (auth.keyExpiresAt && auth.keyExpiresAt <= now) ||
          auth.decision.createdAt.getTime() !== consumption.authorizationIssuedAt.getTime() ||
          consumption.authorizationExpiresAt.getTime() !== Math.min(
            auth.decision.createdAt.getTime() + RELEASE_AUTHORIZATION_TTL_MS,
            auth.keyExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
          ) || now >= consumption.authorizationExpiresAt) return "authorization_stale" as const;
        const channels = auth.decision.resources.filter((r) => r.kind === "channel").map((r) => r.id);
        const artifactIds = auth.decision.resources.filter((r) => r.kind === "artifact").map((r) => r.id);
        if (!sameSet(channels, request.channelIds) || !sameSet(artifactIds, request.artifactIds)) return "authorization_stale" as const;
        const finalClock = await tx.select({ databaseNow: sql<unknown>`clock_timestamp()` })
          .from(agentAuthorizationDecisions).where(eq(agentAuthorizationDecisions.id, auth.decision.id)).limit(1);
        const finalNow = finalClock[0] ? postgresDate(finalClock[0].databaseNow) : null;
        if (!finalNow || finalNow >= consumption.authorizationExpiresAt ||
          (auth.keyExpiresAt && auth.keyExpiresAt <= finalNow)) return "authorization_stale" as const;
        await tx.insert(runtimePublishingApprovalConsumptions).values({ ...consumption, consumedAt: finalNow });
        return "consumed" as const;
      });
    } catch { return "invalid" as const; }
  }
}

export class DrizzlePublishingApprovalRevisionRepository
  implements PublishingApprovalRevisionPort, PublishingApprovalValidationPort {
  constructor(private readonly database: () => Db) {}

  async getRevision(input: Parameters<PublishingApprovalRevisionPort["getRevision"]>[0]) {
    const rows = await this.database().select().from(runtimePublishingPlanRevisions)
      .where(and(
        eq(runtimePublishingPlanRevisions.workspaceId, input.workspaceId),
        eq(runtimePublishingPlanRevisions.id, input.revisionId),
      )).limit(1);
    return rows[0] ? rehydratePublishingPlanRevision(rows[0]) : null;
  }

  async getCurrentRevision(input: Parameters<PublishingApprovalRevisionPort["getCurrentRevision"]>[0]) {
    const rows = await this.database().select({ revision: runtimePublishingPlanRevisions })
      .from(runtimePublishingPlanRevisions)
      .innerJoin(runtimePublishingPlans, and(
        eq(runtimePublishingPlans.workspaceId, runtimePublishingPlanRevisions.workspaceId),
        eq(runtimePublishingPlans.id, runtimePublishingPlanRevisions.planId),
        eq(runtimePublishingPlans.currentRevision, runtimePublishingPlanRevisions.revision),
      )).where(and(
        eq(runtimePublishingPlanRevisions.workspaceId, input.workspaceId),
        eq(runtimePublishingPlanRevisions.id, input.revisionId),
      )).limit(1);
    return rows[0] ? rehydratePublishingPlanRevision(rows[0].revision) : null;
  }

  async verifyCurrent(input: Parameters<PublishingApprovalValidationPort["verifyCurrent"]>[0]) {
    if (input.revision.workspaceId !== input.workspaceId || !unique(input.targetIds)) return null;
    try {
      return await this.database().transaction(async (tx) => {
        const heads = await tx.select().from(runtimePublishingPlans).where(and(
          eq(runtimePublishingPlans.workspaceId, input.workspaceId),
          eq(runtimePublishingPlans.id, input.revision.planId),
          eq(runtimePublishingPlans.currentRevision, input.revision.revision),
        )).limit(1).for("share");
        if (!heads[0]) return null;
        const rows = await tx.select().from(runtimePublishingPlanRevisions).where(and(
          eq(runtimePublishingPlanRevisions.workspaceId, input.workspaceId),
          eq(runtimePublishingPlanRevisions.id, input.revision.id),
          eq(runtimePublishingPlanRevisions.definitionDigest, input.revision.definitionDigest),
        )).limit(1).for("share");
        const revision = rows[0]
          ? rehydratePublishingPlanRevision(rows[0])
          : null;
        if (!revision || canonicalDigest(revision.definition) !== canonicalDigest(input.revision.definition)) return null;
        const orderedTargetIds = revision.definition.targets
          .filter((target) => input.targetIds.includes(target.targetId))
          .map((target) => target.targetId);
        if (!sameOrder(orderedTargetIds, input.targetIds)) return null;
        const binding = publishingApprovalValidationBinding({ revision, targetIds: orderedTargetIds });
        const expiresAt = new Date(binding.expiresAt);
        const issuedAt = await verifyCurrentPublishingPlanEvidence(
          tx,
          revision,
          expiresAt,
          undefined,
          { allowDuePublishAt: input.mode === "retry_due" },
        );
        if (!issuedAt || issuedAt < input.evaluatedAt || issuedAt >= expiresAt) return null;
        const evidenceDigest = canonicalDigest({
          schema: "publishing-approval-validation-session/v1",
          workspaceId: input.workspaceId,
          planRevisionId: revision.id,
          planRevisionDigest: revision.definitionDigest,
          targetIds: orderedTargetIds,
          binding,
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });
        return {
          schema: "publishing-approval-validation-session/v1" as const,
          id: `pavs_${evidenceDigest.slice("sha256:".length)}`,
          workspaceId: input.workspaceId,
          planRevisionId: revision.id,
          planRevisionDigest: revision.definitionDigest,
          targetIds: orderedTargetIds,
          binding,
          issuedAt,
          expiresAt,
        };
      });
    } catch { return null; }
  }
}

async function readAuthorityAdminReceipt(
  tx: Tx,
  input: {
    workspaceId: string;
    actorUserId: string;
    capability: "publishing_approval_authority.issue@1" | "publishing_approval_authority.revoke@1";
    idempotencyKey: string;
    requestFingerprint: string;
  },
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
    "publishing-approval-authority-receipt", input.workspaceId,
    input.actorUserId, input.capability, input.idempotencyKey,
  ])}, 0))`);
  const rows = await tx.select().from(runtimePublishingApprovalAuthorityMutationReceipts)
    .where(and(
      eq(runtimePublishingApprovalAuthorityMutationReceipts.workspaceId, input.workspaceId),
      eq(runtimePublishingApprovalAuthorityMutationReceipts.actorUserId, input.actorUserId),
      eq(runtimePublishingApprovalAuthorityMutationReceipts.capability, input.capability),
      eq(runtimePublishingApprovalAuthorityMutationReceipts.idempotencyKey, input.idempotencyKey),
    )).limit(1).for("update");
  const row = rows[0];
  if (!row) return { kind: "absent" as const };
  return row.requestFingerprint === input.requestFingerprint
    ? { kind: "replayed" as const, grantId: row.grantId }
    : { kind: "conflict" as const };
}

export class DrizzlePublishingApprovalAuthorityRepository
  implements PublishingApprovalAuthorityPort, PublishingApprovalAuthorityAdminPort {
  constructor(private readonly database: () => Db) {}

  async issueGrantIdempotent(input: {
    workspaceId: string;
    userId: string;
    channelId: string;
    action: "publish";
    issuedByUserId: string;
    expiresAt: Date | null;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<PublishingApprovalAuthorityAdminMutationResult> {
    if (!/^[!-~]{8,200}$/.test(input.idempotencyKey) || !DIGEST.test(input.requestFingerprint)) {
      return { kind: "unavailable" };
    }
    try {
      return await this.database().transaction(async (tx) => {
        const receiptInput = {
          workspaceId: input.workspaceId,
          actorUserId: input.issuedByUserId,
          capability: "publishing_approval_authority.issue@1" as const,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
        };
        const receipt = await readAuthorityAdminReceipt(tx, receiptInput);
        if (receipt.kind === "conflict") return { kind: "conflict" as const };
        if (receipt.kind === "replayed") {
          const rows = await tx.select({
            grant: runtimePublishingApprovalAuthorityGrants,
            revocation: runtimePublishingApprovalAuthorityRevocations,
          }).from(runtimePublishingApprovalAuthorityGrants)
            .leftJoin(runtimePublishingApprovalAuthorityRevocations, and(
              eq(runtimePublishingApprovalAuthorityRevocations.workspaceId, runtimePublishingApprovalAuthorityGrants.workspaceId),
              eq(runtimePublishingApprovalAuthorityRevocations.grantId, runtimePublishingApprovalAuthorityGrants.id),
            )).where(and(eq(runtimePublishingApprovalAuthorityGrants.workspaceId, input.workspaceId), eq(runtimePublishingApprovalAuthorityGrants.id, receipt.grantId)))
            .limit(1);
          const replay = rows[0] ? grantRecord(rows[0].grant, rows[0].revocation) : null;
          return replay ? { kind: "replayed" as const, grant: replay } : { kind: "unavailable" as const };
        }
        const admins = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.issuedByUserId), inArray(workspaceMembers.role, ["owner", "admin"])))
          .limit(1).for("share");
        if (!admins[0]) return { kind: "forbidden" as const };
        const subjects = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId)))
          .limit(1).for("share");
        const channels = await tx.select({ id: socialAccounts.id }).from(socialAccounts)
          .where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.id, input.channelId), eq(socialAccounts.platform, "linkedin"), eq(socialAccounts.disabled, false), eq(socialAccounts.requiresReauth, false)))
          .limit(1).for("share");
        if (!subjects[0] || !channels[0]) return { kind: "not_found" as const };
        const clockRows = await tx.select({ databaseNow: sql<unknown>`clock_timestamp()` })
          .from(workspaceMembers).where(and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.issuedByUserId),
          )).limit(1);
        const committedAt = clockRows[0] ? postgresDate(clockRows[0].databaseNow) : null;
        if (input.action !== "publish" || !committedAt ||
          (input.expiresAt && input.expiresAt <= committedAt)) {
          return { kind: "unavailable" as const };
        }
        const committedGrant: PublishingApprovalAuthorityGrantRecord = {
          id: `paag_${randomUUID().replaceAll("-", "")}`,
          workspaceId: input.workspaceId,
          userId: input.userId,
          subjectRoleAtIssue: subjects[0].role,
          channelId: input.channelId,
          action: "publish",
          issuedByUserId: input.issuedByUserId,
          issuedAt: committedAt,
          expiresAt: input.expiresAt,
          revokedAt: null,
          revokedByUserId: null,
        };
        const inserted = await tx.insert(runtimePublishingApprovalAuthorityGrants).values({
          id: committedGrant.id, workspaceId: committedGrant.workspaceId, userId: committedGrant.userId,
          subjectRoleAtIssue: committedGrant.subjectRoleAtIssue, channelId: committedGrant.channelId,
          action: committedGrant.action, issuedByUserId: committedGrant.issuedByUserId,
          issuedAt: committedGrant.issuedAt, expiresAt: committedGrant.expiresAt,
        }).returning({ issuedAt: runtimePublishingApprovalAuthorityGrants.issuedAt });
        const storedGrant = { ...committedGrant, issuedAt: inserted[0]?.issuedAt ?? committedAt };
        await tx.insert(runtimePublishingApprovalAuthorityMutationReceipts).values({
          ...receiptInput, grantId: committedGrant.id, createdAt: committedAt,
        });
        return { kind: "created" as const, grant: structuredClone(storedGrant) };
      });
    } catch { return { kind: "unavailable" }; }
  }

  async revokeGrantIdempotent(input: {
    workspaceId: string;
    grantId: string;
    revokedByUserId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<PublishingApprovalAuthorityAdminMutationResult> {
    if (!/^[!-~]{8,200}$/.test(input.idempotencyKey) || !DIGEST.test(input.requestFingerprint)) {
      return { kind: "unavailable" };
    }
    try {
      return await this.database().transaction(async (tx) => {
        const receiptInput = {
          workspaceId: input.workspaceId, actorUserId: input.revokedByUserId,
          capability: "publishing_approval_authority.revoke@1" as const,
          idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint,
        };
        const receipt = await readAuthorityAdminReceipt(tx, receiptInput);
        if (receipt.kind === "conflict") return { kind: "conflict" as const };
        const admins = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.revokedByUserId), inArray(workspaceMembers.role, ["owner", "admin"])))
          .limit(1).for("share");
        if (!admins[0]) return { kind: "forbidden" as const };
        const grantId = receipt.kind === "replayed" ? receipt.grantId : input.grantId;
        const grantRows = await tx.select().from(runtimePublishingApprovalAuthorityGrants)
          .where(and(
            eq(runtimePublishingApprovalAuthorityGrants.workspaceId, input.workspaceId),
            eq(runtimePublishingApprovalAuthorityGrants.id, grantId),
          )).limit(1).for("update");
        if (!grantRows[0]) return receipt.kind === "replayed" ? { kind: "unavailable" as const } : { kind: "not_found" as const };
        const revocationRows = await tx.select().from(runtimePublishingApprovalAuthorityRevocations)
          .where(and(
            eq(runtimePublishingApprovalAuthorityRevocations.workspaceId, input.workspaceId),
            eq(runtimePublishingApprovalAuthorityRevocations.grantId, grantId),
          )).limit(1);
        if (receipt.kind === "replayed") {
          const replay = grantRecord(grantRows[0], revocationRows[0] ?? null);
          return replay ? { kind: "replayed" as const, grant: replay } : { kind: "unavailable" as const };
        }
        const clockRows = await tx.select({ databaseNow: sql<unknown>`clock_timestamp()` })
          .from(runtimePublishingApprovalAuthorityGrants)
          .where(and(eq(runtimePublishingApprovalAuthorityGrants.workspaceId, input.workspaceId), eq(runtimePublishingApprovalAuthorityGrants.id, input.grantId)))
          .limit(1);
        const committedAt = clockRows[0] ? postgresDate(clockRows[0].databaseNow) : null;
        if (!committedAt) return { kind: "unavailable" as const };
        let revocation = revocationRows[0] ?? {
          workspaceId: input.workspaceId, grantId: input.grantId,
          revokedByUserId: input.revokedByUserId, revokedAt: committedAt,
        };
        if (!revocationRows[0]) {
          const inserted = await tx.insert(runtimePublishingApprovalAuthorityRevocations)
            .values(revocation)
            .returning({ revokedAt: runtimePublishingApprovalAuthorityRevocations.revokedAt });
          revocation = { ...revocation, revokedAt: inserted[0]?.revokedAt ?? committedAt };
        }
        await tx.insert(runtimePublishingApprovalAuthorityMutationReceipts).values({
          ...receiptInput, grantId: input.grantId, createdAt: committedAt,
        });
        const result = grantRecord(grantRows[0], revocation);
        return result ? { kind: "created" as const, grant: result } : { kind: "unavailable" as const };
      });
    } catch { return { kind: "unavailable" }; }
  }

  async checkCurrent(input: Parameters<PublishingApprovalAuthorityPort["checkCurrent"]>[0]) {
    if (!sortedUnique(input.channelIds) || input.action !== "publish") return null;
    const rows = await this.database().select({
      grant: runtimePublishingApprovalAuthorityGrants,
      revocation: runtimePublishingApprovalAuthorityRevocations,
      memberUserId: workspaceMembers.userId,
      memberRole: workspaceMembers.role,
      databaseNow: sql<unknown>`clock_timestamp()`,
    }).from(runtimePublishingApprovalAuthorityGrants)
      .innerJoin(workspaceMembers, and(
        eq(workspaceMembers.workspaceId, runtimePublishingApprovalAuthorityGrants.workspaceId),
        eq(workspaceMembers.userId, runtimePublishingApprovalAuthorityGrants.userId),
      )).leftJoin(runtimePublishingApprovalAuthorityRevocations, and(
        eq(runtimePublishingApprovalAuthorityRevocations.workspaceId, runtimePublishingApprovalAuthorityGrants.workspaceId),
        eq(runtimePublishingApprovalAuthorityRevocations.grantId, runtimePublishingApprovalAuthorityGrants.id),
      )).where(and(
        eq(runtimePublishingApprovalAuthorityGrants.workspaceId, input.workspaceId),
        eq(runtimePublishingApprovalAuthorityGrants.userId, input.userId),
        eq(runtimePublishingApprovalAuthorityGrants.action, input.action),
        inArray(runtimePublishingApprovalAuthorityGrants.channelId, input.channelIds),
        lte(runtimePublishingApprovalAuthorityGrants.issuedAt, input.evaluatedAt),
        isNull(runtimePublishingApprovalAuthorityRevocations.grantId),
        or(isNull(runtimePublishingApprovalAuthorityGrants.expiresAt), gt(runtimePublishingApprovalAuthorityGrants.expiresAt, input.evaluatedAt)),
      )).orderBy(
        asc(runtimePublishingApprovalAuthorityGrants.channelId),
        desc(runtimePublishingApprovalAuthorityGrants.issuedAt),
        desc(runtimePublishingApprovalAuthorityGrants.id),
      );
    if (!rows[0]) return null;
    const subjectRole = rows[0].memberRole;
    const issuedAt = postgresDate(rows[0].databaseNow);
    if (issuedAt < input.evaluatedAt || issuedAt.getTime() - input.evaluatedAt.getTime() > 5_000) return null;
    const grants: Array<{ channelId: string; grantId: string }> = [];
    for (const channelId of input.channelIds) {
      const row = rows.find((candidate) => candidate.grant.channelId === channelId &&
        candidate.grant.issuedAt <= issuedAt &&
        (!candidate.grant.expiresAt || candidate.grant.expiresAt > issuedAt));
      if (!row) return null;
      grants.push({ channelId, grantId: row.grant.id });
    }
    const expiresAt = new Date(Math.min(
      issuedAt.getTime() + AUTHORITY_SESSION_TTL_MS,
      ...grants.map((binding) => rows.find((row) => row.grant.id === binding.grantId)!.grant.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY),
    ));
    const evidence = authorityEvidence({ ...input, subjectRole, grants, issuedAt, expiresAt });
    return {
      schema: "publishing-approval-authority-session/v1" as const,
      id: `paas_${evidence.evidenceDigest.slice("sha256:".length)}`,
      workspaceId: input.workspaceId, userId: input.userId, subjectRole,
      action: input.action,
      channelIds: [...input.channelIds], grants, ...evidence, issuedAt, expiresAt,
    };
  }

  async listGrants(input: Parameters<PublishingApprovalAuthorityAdminPort["listGrants"]>[0]) {
    const rows = await this.database().select({
      grant: runtimePublishingApprovalAuthorityGrants,
      revocation: runtimePublishingApprovalAuthorityRevocations,
    }).from(runtimePublishingApprovalAuthorityGrants)
      .leftJoin(runtimePublishingApprovalAuthorityRevocations, and(
        eq(runtimePublishingApprovalAuthorityRevocations.workspaceId, runtimePublishingApprovalAuthorityGrants.workspaceId),
        eq(runtimePublishingApprovalAuthorityRevocations.grantId, runtimePublishingApprovalAuthorityGrants.id),
      )).where(and(
        eq(runtimePublishingApprovalAuthorityGrants.workspaceId, input.workspaceId),
        input.userId ? eq(runtimePublishingApprovalAuthorityGrants.userId, input.userId) : undefined,
        input.channelId ? eq(runtimePublishingApprovalAuthorityGrants.channelId, input.channelId) : undefined,
      )).orderBy(desc(runtimePublishingApprovalAuthorityGrants.issuedAt), desc(runtimePublishingApprovalAuthorityGrants.id));
    return rows.map((row) => grantRecord(row.grant, row.revocation)).filter((row): row is PublishingApprovalAuthorityGrantRecord => Boolean(row));
  }

}
