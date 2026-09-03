import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { PublishingApprovalServiceError } from "./errors";
import { publishingApprovalRequestAuthorizationContractDigest } from "./authorization-contract";
import type {
  PublishingApprovalAuthorityPort,
  PublishingApprovalAgentDto,
  PublishingApprovalClock,
  PublishingApprovalDecision,
  PublishingApprovalDecisionRecord,
  PublishingApprovalDto,
  PublishingApprovalListFilters,
  PublishingApprovalListPosition,
  PublishingApprovalGovernancePolicyPort,
  PublishingApprovalPresentation,
  PublishingApprovalPresentationPort,
  PublishingApprovalRepository,
  PublishingApprovalRequestRecord,
  PublishingApprovalRevisionPort,
  PublishingApprovalStatus,
  PublishingApprovalValidationPort,
} from "./types";
import {
  approvalDigest,
  approvalEvidenceRef,
  approvalIdempotencyKey,
  approvalIdentifier,
  exactPublishingApprovalSelection,
  publishingApprovalInspectionDigest,
  publishingApprovalValidationBinding,
  sameValidationBinding,
} from "./validation";

const systemClock: PublishingApprovalClock = { now: () => new Date() };
export const MAX_PUBLISHING_APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1_000;

function date(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      `${label} must be a canonical UTC timestamp.`,
    );
  }
  return parsed;
}

export function publishingApprovalStatus(
  request: PublishingApprovalRequestRecord,
  at: Date,
): PublishingApprovalStatus {
  if (request.consumption) return "consumed";
  if (request.decision) return request.decision.decision;
  return request.decisionPolicy.expiresAt.getTime() <= at.getTime()
    ? "expired"
    : "pending";
}

export function publishingApprovalDto(
  request: PublishingApprovalRequestRecord,
  at: Date,
): PublishingApprovalDto {
  return {
    ...structuredClone(request),
    status: publishingApprovalStatus(request, at),
    inspectionDigest: publishingApprovalInspectionDigest(request),
    decisionPolicy: {
      mode: "expires_at",
      expiresAt: request.decisionPolicy.expiresAt.toISOString(),
    },
    createdAt: request.createdAt.toISOString(),
    decision: request.decision
      ? { ...structuredClone(request.decision), decidedAt: request.decision.decidedAt.toISOString() }
      : null,
    consumption: request.consumption
      ? { ...structuredClone(request.consumption), consumedAt: request.consumption.consumedAt.toISOString() }
      : null,
  };
}

export function publishingApprovalAgentDto(
  request: PublishingApprovalRequestRecord,
  at: Date,
): PublishingApprovalAgentDto {
  return {
    id: request.id,
    workspaceId: request.workspaceId,
    planId: request.planId,
    planRevisionId: request.planRevisionId,
    planRevision: request.planRevision,
    planRevisionDigest: request.planRevisionDigest,
    action: request.action,
    targetIds: [...request.targetIds],
    channelIds: [...request.channelIds],
    artifactIds: [...request.artifactIds],
    retrySource: structuredClone(request.retrySource),
    validation: structuredClone(request.validation),
    governancePolicy: structuredClone(request.governancePolicy ?? null),
    decisionPolicy: {
      mode: "expires_at",
      expiresAt: request.decisionPolicy.expiresAt.toISOString(),
    },
    status: publishingApprovalStatus(request, at),
    decision: request.decision
      ? {
          approvalRef: request.decision.id,
          decision: request.decision.decision,
          decidedAt: request.decision.decidedAt.toISOString(),
          authorizesExecution: false,
        }
      : null,
    consumption: request.consumption
      ? { consumed: true, consumedAt: request.consumption.consumedAt.toISOString() }
      : null,
    createdAt: request.createdAt.toISOString(),
    authorizesExecution: false,
  };
}

export function publishingApprovalAgentDtoFromDto(
  request: PublishingApprovalDto,
): PublishingApprovalAgentDto {
  return {
    id: request.id,
    workspaceId: request.workspaceId,
    planId: request.planId,
    planRevisionId: request.planRevisionId,
    planRevision: request.planRevision,
    planRevisionDigest: request.planRevisionDigest,
    action: request.action,
    targetIds: [...request.targetIds],
    channelIds: [...request.channelIds],
    artifactIds: [...request.artifactIds],
    retrySource: structuredClone(request.retrySource),
    validation: structuredClone(request.validation),
    governancePolicy: structuredClone(request.governancePolicy ?? null),
    decisionPolicy: structuredClone(request.decisionPolicy),
    status: request.status,
    decision: request.decision
      ? {
          approvalRef: request.decision.id,
          decision: request.decision.decision,
          decidedAt: request.decision.decidedAt,
          authorizesExecution: false,
        }
      : null,
    consumption: request.consumption
      ? { consumed: true, consumedAt: request.consumption.consumedAt }
      : null,
    createdAt: request.createdAt,
    authorizesExecution: false,
  };
}

function requestFingerprint(input: object): string {
  try {
    return canonicalDigest({
      capability: "publishing_approvals.request@1",
      ...input,
    });
  } catch {
    throw new PublishingApprovalServiceError(
      "PUBLISHING_APPROVAL_INVALID_INPUT",
      "The Approval request must be canonical JSON.",
    );
  }
}

function validValidationSession(input: {
  session: NonNullable<Awaited<ReturnType<PublishingApprovalValidationPort["verifyCurrent"]>>>;
  workspaceId: string;
  revisionId: string;
  revisionDigest: string;
  targetIds: string[];
  binding: PublishingApprovalRequestRecord["validation"];
  now: Date;
}): boolean {
  const { session } = input;
  return (
    session.schema === "publishing-approval-validation-session/v1" &&
    /^[A-Za-z0-9_-]{1,200}$/.test(session.id) &&
    session.workspaceId === input.workspaceId &&
    session.planRevisionId === input.revisionId &&
    session.planRevisionDigest === input.revisionDigest &&
    canonicalDigest(session.targetIds) === canonicalDigest(input.targetIds) &&
    !new Set(session.targetIds).has("") &&
    new Set(session.targetIds).size === session.targetIds.length &&
    sameValidationBinding(session.binding, input.binding) &&
    session.expiresAt.toISOString() === input.binding.expiresAt &&
    session.issuedAt.getTime() >= new Date(input.binding.evaluatedAt).getTime() &&
    session.issuedAt.getTime() <= input.now.getTime() &&
    session.expiresAt.getTime() > input.now.getTime()
  );
}

function validAuthoritySession(input: {
  session: NonNullable<Awaited<ReturnType<PublishingApprovalAuthorityPort["checkCurrent"]>>>;
  workspaceId: string;
  userId: string;
  action: "publish";
  channelIds: string[];
  now: Date;
}): boolean {
  const { session } = input;
  const grantChannels = session.grants.map((grant) => grant.channelId);
  const grantIds = session.grants.map((grant) => grant.grantId);
  return (
    session.schema === "publishing-approval-authority-session/v1" &&
    /^[A-Za-z0-9_-]{1,200}$/.test(session.id) &&
    session.workspaceId === input.workspaceId &&
    session.userId === input.userId &&
    (session.subjectRole === "owner" || session.subjectRole === "admin" || session.subjectRole === "member") &&
    session.action === input.action &&
    canonicalDigest(session.channelIds) === canonicalDigest(input.channelIds) &&
    canonicalDigest(grantChannels) === canonicalDigest(input.channelIds) &&
    new Set(session.channelIds).size === session.channelIds.length &&
    new Set(grantChannels).size === grantChannels.length &&
    new Set(grantIds).size === grantIds.length &&
    session.grants.every(
      (grant) =>
        /^[A-Za-z0-9_-]{1,200}$/.test(grant.channelId) &&
        /^[A-Za-z0-9_-]{1,200}$/.test(grant.grantId),
    ) &&
    /^[^\u0000-\u001f\u007f]{1,200}$/.test(session.evidenceRef) &&
    /^sha256:[a-f0-9]{64}$/.test(session.evidenceDigest) &&
    session.issuedAt.getTime() <= input.now.getTime() &&
    session.expiresAt.getTime() > input.now.getTime()
  );
}

function failResult(kind: string): never {
  switch (kind) {
    case "conflict":
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_IDEMPOTENCY_CONFLICT", "The idempotency key is already bound to another Approval mutation.");
    case "stale_revision":
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_STALE_REVISION", "Only the current immutable Plan Revision may be approved.");
    case "stale_validation":
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_STALE_VALIDATION", "Publish Validation evidence changed or expired before commit.");
    case "stale_view":
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_STALE_VIEW", "Refresh the exact Approval request before deciding.");
    case "authority_stale":
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_AUTHORITY_REQUIRED", "Current explicit Approval Authority is required for every affected Channel.");
    case "expired":
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_EXPIRED", "The Approval decision window expired.");
    case "final":
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_FINAL", "The Approval request already has a final decision.");
    default:
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_PERSISTENCE_UNAVAILABLE", "The durable Approval mutation could not be committed.");
  }
}

export class PublishingApprovalService {
  constructor(
    private readonly repository: PublishingApprovalRepository,
    private readonly revisions: PublishingApprovalRevisionPort,
    private readonly validation: PublishingApprovalValidationPort,
    private readonly authority: PublishingApprovalAuthorityPort,
    private readonly presentation?: PublishingApprovalPresentationPort,
    private readonly clock: PublishingApprovalClock = systemClock,
    private readonly governancePolicy?: PublishingApprovalGovernancePolicyPort,
  ) {}

  async request(input: {
    workspaceId: string;
    principalId: string;
    keyId: string;
    requestAuthorizationEvidenceRef: string;
    requestAuthorizationContractDigest: string;
    idempotencyKey: string;
    revisionId: string;
    action: "publish";
    targetIds: string[];
    channelIds: string[];
    artifactIds: string[];
    retrySource?: { deliveryId: string; evidenceDigest: string };
    policyId?: string;
    policyRevision?: number;
    expiresAt: string;
  }): Promise<PublishingApprovalDto> {
    const now = this.clock.now();
    if (input.action !== "publish") {
      throw new PublishingApprovalServiceError(
        "PUBLISHING_APPROVAL_INVALID_INPUT",
        "The Publishing Approval action is invalid.",
      );
    }
    const principalId = approvalIdentifier(input.principalId, "Requesting Principal");
    const keyId = approvalIdentifier(input.keyId, "Requesting key");
    const revisionId = approvalIdentifier(input.revisionId, "Plan Revision ID");
    const retrySource = input.retrySource
      ? {
          deliveryId: approvalIdentifier(input.retrySource.deliveryId, "Retry source Delivery ID"),
          evidenceDigest: approvalDigest(
            input.retrySource.evidenceDigest,
            "Retry source evidence digest",
          ),
        }
      : null;
    const key = approvalIdempotencyKey(input.idempotencyKey);
    const authorizationEvidenceRef = approvalEvidenceRef(input.requestAuthorizationEvidenceRef, "Request authorization evidence");
    const authorizationContractDigest = approvalDigest(input.requestAuthorizationContractDigest, "Request authorization contract digest");
    if (authorizationContractDigest !== publishingApprovalRequestAuthorizationContractDigest()) {
      throw new PublishingApprovalServiceError(
        "PUBLISHING_APPROVAL_INVALID_INPUT",
        "The exact Publishing Approval request authorization contract is required.",
      );
    }
    const expiresAt = date(input.expiresAt, "Approval expiry");
    const revision = await this.revisions.getRevision({ workspaceId: input.workspaceId, revisionId });
    if (!revision) failResult("stale_revision");
    const selection = exactPublishingApprovalSelection({
      revision,
      targetIds: input.targetIds,
      channelIds: input.channelIds,
      artifactIds: input.artifactIds,
    });
    const fingerprint = requestFingerprint({
      revisionId,
      action: input.action,
      ...selection,
      expiresAt: expiresAt.toISOString(),
      authorizationContractDigest,
      retrySource,
      policyId: input.policyId ?? null,
      policyRevision: input.policyRevision ?? null,
    });
    const prior = await this.repository.readMutationReceipt({
      workspaceId: input.workspaceId,
      actorKind: "agent",
      actorId: principalId,
      capability: "publishing_approvals.request@1",
      idempotencyKey: key,
      requestFingerprint: fingerprint,
    });
    if (prior.kind === "conflict") failResult("conflict");
    if (prior.kind === "replayed") {
      const replay = await this.repository.getRequest({ workspaceId: input.workspaceId, approvalRequestId: prior.approvalRequestId, requestingPrincipalId: principalId });
      if (!replay) failResult("unavailable");
      return publishingApprovalDto(replay, now);
    }
    if (
      expiresAt.getTime() <= now.getTime() ||
      expiresAt.getTime() - now.getTime() > MAX_PUBLISHING_APPROVAL_WINDOW_MS
    ) {
      throw new PublishingApprovalServiceError(
        "PUBLISHING_APPROVAL_INVALID_INPUT",
        "Approval expiry must be in the future and no more than 24 hours away.",
      );
    }
    const currentRevision = await this.revisions.getCurrentRevision({ workspaceId: input.workspaceId, revisionId });
    if (!currentRevision || currentRevision.definitionDigest !== revision.definitionDigest) failResult("stale_revision");
    const expectedBinding = publishingApprovalValidationBinding({ revision, targetIds: selection.targetIds });
    const session = await this.validation.verifyCurrent({
      workspaceId: input.workspaceId,
      revision,
      targetIds: selection.targetIds,
      evaluatedAt: now,
      mode: retrySource ? "retry_due" : "release",
    });
    if (
      !session ||
      !validValidationSession({ session, workspaceId: input.workspaceId, revisionId: revision.id, revisionDigest: revision.definitionDigest, targetIds: selection.targetIds, binding: expectedBinding, now }) ||
      expiresAt.getTime() > session.expiresAt.getTime()
    ) failResult("stale_validation");
    const requestId = `par_${canonicalDigest({
      workspaceId: input.workspaceId,
      principalId,
      capability: "publishing_approvals.request@1",
      key,
    }).slice("sha256:".length)}`;
    let governancePolicy = null;
    if (this.governancePolicy) {
      if (!input.policyId || !input.policyRevision) {
        throw new PublishingApprovalServiceError(
          "PUBLISHING_APPROVAL_INVALID_INPUT",
          "An exact active Workspace Publishing Approval Policy revision is required.",
        );
      }
      governancePolicy = await this.governancePolicy.bind({
        workspaceId: input.workspaceId,
        runtimeApprovalRequestId: requestId,
        requestingPrincipalId: principalId,
        planId: revision.planId,
        planRevisionId: revision.id,
        planRevision: revision.revision,
        planRevisionDigest: revision.definitionDigest,
        policyId: approvalIdentifier(input.policyId, "Publishing Approval Policy"),
        policyRevision: input.policyRevision,
        expiresAt,
        requestedAt: now,
      });
      if (!governancePolicy) {
        throw new PublishingApprovalServiceError(
          "PUBLISHING_APPROVAL_STALE_VALIDATION",
          "The exact active Workspace Publishing Approval Policy revision is unavailable.",
        );
      }
    }
    const request: PublishingApprovalRequestRecord = {
      id: requestId,
      workspaceId: input.workspaceId,
      planId: revision.planId,
      planRevisionId: revision.id,
      planRevision: revision.revision,
      planRevisionDigest: revision.definitionDigest,
      action: "publish",
      ...selection,
      retrySource,
      requestingPrincipalId: principalId,
      requestingKeyId: keyId,
      requestAuthorization: {
        capability: "publishing_approvals.request@1",
        contractDigest: authorizationContractDigest,
        evidenceRef: authorizationEvidenceRef,
        resources: { channelIds: selection.channelIds, artifactIds: selection.artifactIds },
      },
      validation: expectedBinding,
      governancePolicy,
      decisionPolicy: { mode: "expires_at", expiresAt },
      createdAt: now,
      decision: null,
      consumption: null,
      authorizesExecution: false,
    };
    const result = await this.repository.createRequest({
      request,
      receipt: {
        workspaceId: input.workspaceId,
        actorKind: "agent",
        actorId: principalId,
        capability: "publishing_approvals.request@1",
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        approvalRequestId: request.id,
        decisionId: null,
        createdAt: now,
      },
      validationSession: session,
    });
    if (result.kind !== "created" && result.kind !== "replayed") failResult(result.kind);
    return publishingApprovalDto(result.request, now);
  }

  async decide(input: {
    workspaceId: string;
    userId: string;
    idempotencyKey: string;
    approvalRequestId: string;
    expectedInspectionDigest: string;
    decision: PublishingApprovalDecision;
  }): Promise<PublishingApprovalDto> {
    const now = this.clock.now();
    const userId = approvalIdentifier(input.userId, "Human user");
    const approvalRequestId = approvalIdentifier(input.approvalRequestId, "Approval Request ID");
    const key = approvalIdempotencyKey(input.idempotencyKey);
    const expectedInspectionDigest = approvalDigest(input.expectedInspectionDigest, "Inspection digest");
    const fingerprint = canonicalDigest({
      capability: "publishing_approvals.decide@1",
      approvalRequestId,
      expectedInspectionDigest,
      decision: input.decision,
    });
    const prior = await this.repository.readMutationReceipt({
      workspaceId: input.workspaceId,
      actorKind: "human",
      actorId: userId,
      capability: "publishing_approvals.decide@1",
      idempotencyKey: key,
      requestFingerprint: fingerprint,
    });
    if (prior.kind === "conflict") failResult("conflict");
    if (prior.kind === "replayed") {
      const replay = await this.repository.getRequest({ workspaceId: input.workspaceId, approvalRequestId: prior.approvalRequestId });
      if (!replay) failResult("unavailable");
      return publishingApprovalDto(replay, now);
    }
    const request = await this.repository.getRequest({ workspaceId: input.workspaceId, approvalRequestId });
    if (!request) {
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_NOT_FOUND", "The Approval request is unavailable.");
    }
    if (publishingApprovalInspectionDigest(request) !== expectedInspectionDigest) {
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_STALE_VIEW", "Refresh the exact Approval request before deciding.");
    }
    if (request.decision) failResult("final");
    if (request.decisionPolicy.expiresAt.getTime() <= now.getTime()) failResult("expired");
    const revision = await this.revisions.getCurrentRevision({ workspaceId: input.workspaceId, revisionId: request.planRevisionId });
    if (!revision || revision.definitionDigest !== request.planRevisionDigest) failResult("stale_revision");
    const validationSession = await this.validation.verifyCurrent({
      workspaceId: input.workspaceId,
      revision,
      targetIds: request.targetIds,
      evaluatedAt: now,
      mode: request.retrySource ? "retry_due" : "release",
    });
    if (
      !validationSession ||
      !validValidationSession({ session: validationSession, workspaceId: input.workspaceId, revisionId: request.planRevisionId, revisionDigest: request.planRevisionDigest, targetIds: request.targetIds, binding: request.validation, now })
    ) failResult("stale_validation");
    const authoritySession = await this.authority.checkCurrent({
      workspaceId: input.workspaceId,
      userId,
      action: request.action,
      channelIds: request.channelIds,
      evaluatedAt: now,
    });
    if (
      !authoritySession ||
      !validAuthoritySession({ session: authoritySession, workspaceId: input.workspaceId, userId, action: request.action, channelIds: request.channelIds, now })
    ) failResult("authority_stale");
    if (this.governancePolicy) {
      if (!request.governancePolicy) failResult("unavailable");
      const policyResult = await this.governancePolicy.decide({
        workspaceId: input.workspaceId,
        binding: request.governancePolicy,
        runtimeApprovalRequestId: request.id,
        userId,
        legacyRole: authoritySession.subjectRole,
        decision: input.decision === "approved" ? "approve" : "reject",
        idempotencyKey: key,
        decidedAt: now,
      });
      if (policyResult === "pending") return publishingApprovalDto(request, now);
      if (policyResult === "expired") failResult("expired");
      if (policyResult === "forbidden") failResult("authority_stale");
      if (policyResult === "conflict") failResult("conflict");
      if (policyResult === "unavailable") failResult("unavailable");
      if (
        (policyResult === "accepted" && input.decision !== "approved") ||
        (policyResult === "rejected" && input.decision !== "denied")
      ) failResult("unavailable");
    }
    const decision: PublishingApprovalDecisionRecord = {
      id: `pad_${randomUUID().replaceAll("-", "")}`,
      workspaceId: input.workspaceId,
      approvalRequestId,
      decision: input.decision,
      decidedByUserId: userId,
      authorityEvidenceRef: approvalEvidenceRef(authoritySession.evidenceRef, "Approval Authority evidence"),
      authorityEvidenceDigest: approvalDigest(authoritySession.evidenceDigest, "Approval Authority evidence digest"),
      authorityGrants: structuredClone(authoritySession.grants),
      inspectionDigest: expectedInspectionDigest,
      decidedAt: now,
      authorizesExecution: false,
    };
    const result = await this.repository.decide({
      decision,
      expectedInspectionDigest,
      receipt: {
        workspaceId: input.workspaceId,
        actorKind: "human",
        actorId: userId,
        capability: "publishing_approvals.decide@1",
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        approvalRequestId,
        decisionId: decision.id,
        createdAt: now,
      },
      authoritySession,
      validationSession,
    });
    if (result.kind !== "decided" && result.kind !== "replayed") failResult(result.kind);
    return publishingApprovalDto(result.request, now);
  }

  async get(input: {
    workspaceId: string;
    approvalRequestId: string;
    viewer: { kind: "agent"; principalId: string; authorizedChannelIds: string[]; authorizedArtifactIds: string[] } | { kind: "human"; userId: string };
  }): Promise<PublishingApprovalDto> {
    const request = await this.repository.getRequest({
      workspaceId: input.workspaceId,
      approvalRequestId: approvalIdentifier(input.approvalRequestId, "Approval Request ID"),
      ...(input.viewer.kind === "agent" ? { requestingPrincipalId: approvalIdentifier(input.viewer.principalId, "Viewing Principal") } : {}),
    });
    if (!request) throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_NOT_FOUND", "The Approval request is unavailable.");
    if (input.viewer.kind === "agent") {
      const viewer = input.viewer;
      if (
        request.channelIds.some((id) => !viewer.authorizedChannelIds.includes(id)) ||
        request.artifactIds.some((id) => !viewer.authorizedArtifactIds.includes(id))
      ) {
        throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_NOT_FOUND", "The Approval request is unavailable.");
      }
    }
    return publishingApprovalDto(request, this.clock.now());
  }

  async getAgent(input: {
    workspaceId: string;
    approvalRequestId: string;
    viewer: { principalId: string; authorizedChannelIds: string[]; authorizedArtifactIds: string[] };
  }): Promise<PublishingApprovalAgentDto> {
    return publishingApprovalAgentDtoFromDto(
      await this.get({ ...input, viewer: { kind: "agent", ...input.viewer } }),
    );
  }

  async list(input: {
    workspaceId: string;
    filters: PublishingApprovalListFilters;
    before?: PublishingApprovalListPosition;
    limit: number;
    viewer: { kind: "agent"; principalId: string; authorizedChannelIds: string[]; authorizedArtifactIds: string[] } | { kind: "human"; userId: string };
  }): Promise<PublishingApprovalDto[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 101) {
      throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_INVALID_INPUT", "Approval list limit is invalid.");
    }
    const at = this.clock.now();
    const filters: PublishingApprovalListFilters = {
      ...input.filters,
      ...(input.viewer.kind === "agent"
        ? {
            requestingPrincipalId: approvalIdentifier(input.viewer.principalId, "Viewing Principal"),
            authorizedChannelIds: input.viewer.authorizedChannelIds,
            authorizedArtifactIds: input.viewer.authorizedArtifactIds,
          }
        : {}),
    };
    return (await this.repository.listRequests({
      workspaceId: input.workspaceId,
      filters,
      before: input.before,
      limit: input.limit,
      evaluatedAt: at,
    })).map((request) => publishingApprovalDto(request, at));
  }

  async listAgent(input: {
    workspaceId: string;
    filters: PublishingApprovalListFilters;
    before?: PublishingApprovalListPosition;
    limit: number;
    viewer: { principalId: string; authorizedChannelIds: string[]; authorizedArtifactIds: string[] };
  }): Promise<PublishingApprovalAgentDto[]> {
    return (await this.list({ ...input, viewer: { kind: "agent", ...input.viewer } })).map(
      publishingApprovalAgentDtoFromDto,
    );
  }

  async inspectForHuman(input: {
    workspaceId: string;
    userId: string;
    approvalRequestId: string;
  }): Promise<PublishingApprovalPresentation> {
    if (!this.presentation) failResult("unavailable");
    const now = this.clock.now();
    const request = await this.repository.getRequest({ workspaceId: input.workspaceId, approvalRequestId: approvalIdentifier(input.approvalRequestId, "Approval Request ID") });
    if (!request) throw new PublishingApprovalServiceError("PUBLISHING_APPROVAL_NOT_FOUND", "The Approval request is unavailable.");
    const revision = await this.revisions.getRevision({ workspaceId: input.workspaceId, revisionId: request.planRevisionId });
    if (!revision || revision.definitionDigest !== request.planRevisionDigest) failResult("unavailable");
    const currentRevision = await this.revisions.getCurrentRevision({ workspaceId: input.workspaceId, revisionId: request.planRevisionId });
    const humanUserId = approvalIdentifier(input.userId, "Human user");
    const authority = await this.authority.checkCurrent({ workspaceId: input.workspaceId, userId: humanUserId, action: request.action, channelIds: request.channelIds, evaluatedAt: now });
    const validation = currentRevision
      ? await this.validation.verifyCurrent({
          workspaceId: input.workspaceId,
          revision,
          targetIds: request.targetIds,
          evaluatedAt: now,
          mode: request.retrySource ? "retry_due" : "release",
        })
      : null;
    const grants = new Map(authority?.grants.map((grant) => [grant.channelId, grant.grantId]) ?? []);
    const blockerCodes: PublishingApprovalPresentation["decisionEligibility"]["blockerCodes"] = [];
    if (request.decision) blockerCodes.push("REQUEST_FINAL");
    if (!request.decision && request.decisionPolicy.expiresAt.getTime() <= now.getTime()) blockerCodes.push("REQUEST_EXPIRED");
    if (!currentRevision) blockerCodes.push("REVISION_SUPERSEDED");
    if (!validation || !validValidationSession({ session: validation, workspaceId: input.workspaceId, revisionId: request.planRevisionId, revisionDigest: request.planRevisionDigest, targetIds: request.targetIds, binding: request.validation, now })) blockerCodes.push("VALIDATION_STALE");
    if (!authority || !validAuthoritySession({ session: authority, workspaceId: input.workspaceId, userId: humanUserId, action: request.action, channelIds: request.channelIds, now })) blockerCodes.push("AUTHORITY_MISSING");
    return {
      schema: "publishing-approval-presentation/v1",
      approval: publishingApprovalDto(request, now),
      targets: await this.presentation.present({ approval: request, revision, actorUserId: input.userId, presentedAt: now }),
      decisionEligibility: { eligible: blockerCodes.length === 0, blockerCodes },
      authorityCoverage: request.targetIds.map((targetId) => {
        const target = revision.definition.targets.find((item) => item.targetId === targetId)!;
        const grantId = grants.get(target.channelId);
        return { targetId, channelId: target.channelId, action: request.action, covered: Boolean(grantId), grantRefs: grantId ? [grantId] : [] };
      }),
    };
  }
}
