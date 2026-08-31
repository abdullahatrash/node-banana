import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  publishingDeliveryCancelAuthorizationContractDigest,
  publishingDeliveryReconcileAuthorizationContractDigest,
  publishingDeliveryReleaseAuthorizationContractDigest,
  publishingDeliveryRetryAuthorizationContractDigest,
} from "./authorization-contract";
import { PublishingDeliveryServiceError } from "./errors";
import {
  publishingDeliveryEffectKey,
  publishingDeliveryOutboxDedupeKey,
} from "./keys";
import type {
  PublishingDeliveryAuthorizationPort,
  PublishingDeliveryCancellationActor,
  PublishingDeliveryCancellationAuthorizationPort,
  PublishingDeliveryCancellationAuthorizationSession,
  PublishingDeliveryCancellationDto,
  PublishingDeliveryCancellationRecord,
  PublishingDeliveryClock,
  PublishingDeliveryDurableAcceptance,
  PublishingDeliveryEvent,
  PublishingDeliveryEventDto,
  PublishingDeliveryListFilters,
  PublishingDeliveryListPosition,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryReconciliationDto,
  PublishingDeliveryReconciliationProjection,
  PublishingDeliveryRecoveryActor,
  PublishingDeliveryRecoveryAuthorizationPort,
  PublishingDeliveryRecoveryAuthorizationSession,
  PublishingDeliveryRepository,
  PublishingDeliveryRetryDto,
  PublishingDeliveryRetryRecord,
  PublishingDeliveryRevisionPort,
  PublishingDeliveryValidationPort,
} from "./types";
import {
  exactApprovedRequest,
  publishingDeliveryAcceptedRef,
  publishingDeliveryArtifactIdentifier,
  publishingDeliveryDto,
  publishingDeliveryIdempotencyKey,
  publishingDeliveryIdentifier,
  publishingDeliveryReconciliationExhausted,
  publishingDeliveryTargetSnapshot,
  validPublishingDeliveryAuthorizationSession,
  validPublishingDeliveryValidationSession,
} from "./validation";

const systemClock: PublishingDeliveryClock = { now: () => new Date() };
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function sameExactSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    canonicalDigest([...left].sort()) === canonicalDigest([...right].sort())
  );
}

function authorizedManifests(channelValues: string[], artifactValues: string[]) {
  const channelIds = channelValues.map((value) => publishingDeliveryIdentifier(value, "Channel ID"));
  const artifactIds = artifactValues.map(publishingDeliveryArtifactIdentifier);
  if (
    channelIds.length === 0 ||
    artifactIds.length === 0 ||
    new Set(channelIds).size !== channelIds.length ||
    new Set(artifactIds).size !== artifactIds.length
  ) {
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_INVALID_INPUT",
      "Publishing Delivery authorization manifests must be non-empty and unique.",
    );
  }
  return { channelIds, artifactIds };
}

export type PublishingDeliveryInspectionActor =
  | { kind: "agent"; principalId: string }
  | { kind: "human"; userId: string };

type PublishingDeliveryInspectionInput =
  | {
      actor: PublishingDeliveryInspectionActor;
      principalId?: never;
      authorizedChannelIds: string[];
      authorizedArtifactIds: string[];
    }
  | {
      actor?: never;
      principalId: string;
      authorizedChannelIds: string[];
      authorizedArtifactIds: string[];
    };

function inspectionScope(input: PublishingDeliveryInspectionInput): {
  consumingPrincipalId?: string;
  authorizedChannelIds?: string[];
  authorizedArtifactIds?: string[];
} {
  if (input.actor?.kind === "human") {
    publishingDeliveryIdentifier(input.actor.userId, "Human user ID");
    return {};
  }
  const rawPrincipalId = input.actor?.kind === "agent"
    ? input.actor.principalId
    : input.principalId;
  if (!rawPrincipalId) {
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_INVALID_INPUT",
      "Publishing Delivery inspection actor is invalid.",
    );
  }
  const principalId = publishingDeliveryIdentifier(rawPrincipalId, "Principal ID");
  const manifests = authorizedManifests(
    input.authorizedChannelIds,
    input.authorizedArtifactIds,
  );
  return {
    consumingPrincipalId: principalId,
    authorizedChannelIds: manifests.channelIds,
    authorizedArtifactIds: manifests.artifactIds,
  };
}

function eventId(deliveryId: string, sequence: number): string {
  return `pde_${deliveryId}_${sequence}`;
}

function sameActor(
  left: PublishingDeliveryCancellationActor,
  right: PublishingDeliveryCancellationActor,
): boolean {
  return canonicalDigest(left) === canonicalDigest(right);
}

function validCancellationAuthorization(input: {
  session: PublishingDeliveryCancellationAuthorizationSession | null;
  workspaceId: string;
  actor: PublishingDeliveryCancellationActor;
  contractDigest: string;
  evidenceRef: string;
  channelIds: string[];
  artifactIds: string[];
  now: Date;
}): input is typeof input & {
  session: PublishingDeliveryCancellationAuthorizationSession;
} {
  const { session } = input;
  if (
    !session ||
    session.schema !== "publishing-delivery-cancellation-authorization-session/v1" ||
    session.workspaceId !== input.workspaceId ||
    session.capability !== "publishing_deliveries.cancel@1" ||
    session.contractDigest !== input.contractDigest ||
    session.admissionEvidenceRef !== input.evidenceRef ||
    !/^[^\u0000-\u001f\u007f]{1,200}$/.test(session.evidenceRef) ||
    !DIGEST.test(session.evidenceDigest) ||
    !sameActor(session.actor, input.actor) ||
    !sameExactSet(session.resources.channelIds, input.channelIds) ||
    !sameExactSet(session.resources.artifactIds, input.artifactIds) ||
    session.issuedAt >= session.expiresAt ||
    session.expiresAt <= input.now
  ) return false;
  return session.actor.kind === "agent"
    ? session.humanGrants.length === 0
    : session.actor.kind === "human" &&
        session.humanGrants.length === input.channelIds.length &&
        new Set(session.humanGrants.map((grant) => grant.channelId)).size ===
          input.channelIds.length &&
        input.channelIds.every((channelId) =>
          session.humanGrants.some((grant) => grant.channelId === channelId),
        );
}

function validRecoveryAuthorization(input: {
  session: PublishingDeliveryRecoveryAuthorizationSession | null;
  workspaceId: string;
  actor: PublishingDeliveryRecoveryActor;
  capability: "publishing_deliveries.retry@1" | "publishing_deliveries.reconcile@1";
  contractDigest: string;
  evidenceRef: string;
  channelIds: string[];
  artifactIds: string[];
  now: Date;
}): input is typeof input & { session: PublishingDeliveryRecoveryAuthorizationSession } {
  const { session } = input;
  if (
    !session ||
    session.schema !== "publishing-delivery-recovery-authorization-session/v1" ||
    session.workspaceId !== input.workspaceId ||
    session.capability !== input.capability ||
    session.contractDigest !== input.contractDigest ||
    session.admissionEvidenceRef !== input.evidenceRef ||
    !/^[^\u0000-\u001f\u007f]{1,200}$/.test(session.evidenceRef) ||
    !DIGEST.test(session.evidenceDigest) ||
    !sameActor(session.actor, input.actor) ||
    !sameExactSet(session.resources.channelIds, input.channelIds) ||
    !sameExactSet(session.resources.artifactIds, input.artifactIds) ||
    session.issuedAt >= session.expiresAt ||
    session.expiresAt <= input.now
  ) return false;
  return session.actor.kind === "agent"
    ? session.humanGrants.length === 0
    : session.humanGrants.length === input.channelIds.length &&
        new Set(session.humanGrants.map((grant) => grant.channelId)).size ===
          input.channelIds.length &&
        input.channelIds.every((channelId) =>
          session.humanGrants.some((grant) => grant.channelId === channelId),
        );
}

function retryDto(input: {
  retry: PublishingDeliveryRetryRecord;
  delivery: PublishingDeliveryRecord;
}): PublishingDeliveryRetryDto {
  return {
    schema: "publishing-delivery-retry/v1",
    retryId: input.retry.id,
    sourceDeliveryId: input.retry.sourceDeliveryId,
    sourceEvidenceDigest: input.retry.sourceEvidenceDigest,
    delivery: publishingDeliveryAcceptedRef(input.delivery),
    requestedAt: input.retry.requestedAt.toISOString(),
    durable: true,
    externallyCompleted: false,
  };
}

function reconciliationDto(
  projection: PublishingDeliveryReconciliationProjection,
): PublishingDeliveryReconciliationDto {
  const result = projection.result?.resolution ?? null;
  const resolution = !result
    ? null
    : result.kind === "failed_known"
      ? result.failureClass === "transient" ? "failed_transient" : "failed_terminal"
      : result.kind;
  return {
    schema: "publishing-delivery-reconciliation/v1",
    reconciliationId: projection.request.id,
    deliveryId: projection.request.deliveryId,
    sourceEvidenceDigest: projection.request.sourceEvidenceDigest,
    effectKey: projection.request.sourceEffectKey,
    effectGeneration: projection.request.sourceEffectGeneration,
    status: projection.result ? "completed" : "queued",
    resolution,
    requestedAt: projection.request.requestedAt.toISOString(),
    completedAt: projection.result?.completedAt.toISOString() ?? null,
    durable: true,
    externallyCompleted: !result || result.kind === "still_unknown" || result.kind === "operator_required"
      ? null
      : result.kind === "succeeded",
  };
}

function cancellationDto(input: {
  id: string;
  deliveryId: string;
  stateAtRequest: PublishingDeliveryCancellationDto["stateAtRequest"];
  outcome: PublishingDeliveryCancellationDto["outcome"];
  externallyCompletedAtRequest: boolean | null;
  requestedAt: Date;
}): PublishingDeliveryCancellationDto {
  return {
    schema: "publishing-delivery-cancellation/v1",
    cancellationId: input.id,
    deliveryId: input.deliveryId,
    desiredState: "cancel",
    stateAtRequest: input.stateAtRequest,
    outcome: input.outcome,
    externallyCompletedAtRequest: input.externallyCompletedAtRequest,
    requestedAt: input.requestedAt.toISOString(),
    durable: true,
    externallyReversed: false,
  };
}

function fail(kind: Exclude<
  Awaited<ReturnType<PublishingDeliveryRepository["release"]>>["kind"],
  "created" | "replayed"
>): never {
  switch (kind) {
    case "conflict":
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another exact release.",
      );
    case "approval_invalid":
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_APPROVAL_INVALID",
        "The exact approved request is not valid for release.",
      );
    case "approval_consumed":
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_APPROVAL_CONSUMED",
        "The Approval decision was already released.",
      );
    case "stale_revision":
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_STALE_REVISION",
        "The approved Plan Revision is no longer current.",
      );
    case "authorization_stale":
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_AUTHORIZATION_STALE",
        "Exact current release authorization is required.",
      );
    case "validation_stale":
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_VALIDATION_STALE",
        "Publish Validation changed or expired before release commit.",
      );
    default:
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
        "Durable release could not be committed.",
      );
  }
}

function acceptance(input: {
  release: {
    id: string;
    approvalRequestId: string;
    approvalDecisionId: string;
    acceptedDeliveries: PublishingDeliveryDurableAcceptance["deliveries"];
    createdAt: Date;
  };
}): PublishingDeliveryDurableAcceptance {
  const acceptedAt = input.release.createdAt.toISOString();
  const refs = input.release.acceptedDeliveries;
  const validRefs =
    refs.length > 0 &&
    new Set(refs.map((item) => item.id)).size === refs.length &&
    new Set(refs.map((item) => item.targetId)).size === refs.length &&
    refs.every((item) => {
      const publishAt = new Date(item.publishAt);
      return (
        /^[A-Za-z0-9_-]{1,200}$/.test(item.id) &&
        /^[A-Za-z0-9_-]{1,200}$/.test(item.targetId) &&
        /^[A-Za-z0-9_-]{1,200}$/.test(item.channelId) &&
        item.state === "scheduled" &&
        /^publishing-effect:v1:[A-Za-z0-9_-]{1,200}:[A-Za-z0-9_-]{1,200}$/.test(item.effectKey) &&
        Number.isFinite(publishAt.getTime()) &&
        publishAt.toISOString() === item.publishAt &&
        item.acceptedAt === acceptedAt &&
        item.scheduledAt === acceptedAt &&
        item.externallyCompleted === false
      );
    });
  if (!validRefs) fail("unavailable");
  return {
    schema: "publishing-delivery-durable-acceptance/v1",
    releaseId: input.release.id,
    approvalRequestId: input.release.approvalRequestId,
    approvalDecisionId: input.release.approvalDecisionId,
    deliveries: structuredClone(input.release.acceptedDeliveries),
    acceptedAt,
    durable: true,
    externallyCompleted: false,
  };
}

export class PublishingDeliveryService {
  constructor(
    private readonly repository: PublishingDeliveryRepository,
    private readonly revisions: PublishingDeliveryRevisionPort,
    private readonly validation: PublishingDeliveryValidationPort,
    private readonly authorization: PublishingDeliveryAuthorizationPort,
    private readonly clock: PublishingDeliveryClock = systemClock,
    private readonly cancellationAuthorization?:
      PublishingDeliveryCancellationAuthorizationPort,
    private readonly recoveryAuthorization?:
      PublishingDeliveryRecoveryAuthorizationPort,
  ) {}

  async release(input: {
    workspaceId: string;
    principalId: string;
    keyId: string;
    approvalRequestId: string;
    channelIds: string[];
    artifactIds: string[];
    idempotencyKey: string;
    authorizationEvidenceRef: string;
    authorizationContractDigest: string;
  }): Promise<PublishingDeliveryDurableAcceptance> {
    const now = this.clock.now();
    const principalId = publishingDeliveryIdentifier(input.principalId, "Principal ID");
    const keyId = publishingDeliveryIdentifier(input.keyId, "Key ID");
    const approvalRequestId = publishingDeliveryIdentifier(
      input.approvalRequestId,
      "Approval Request ID",
    );
    const idempotencyKey = publishingDeliveryIdempotencyKey(input.idempotencyKey);
    const contractDigest = publishingDeliveryReleaseAuthorizationContractDigest();
    if (input.authorizationContractDigest !== contractDigest) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_AUTHORIZATION_STALE",
        "The exact release authorization contract is required.",
      );
    }
    if (!/^[^\u0000-\u001f\u007f]{1,200}$/.test(input.authorizationEvidenceRef)) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_AUTHORIZATION_STALE",
        "Release authorization evidence is unavailable.",
      );
    }
    const { channelIds, artifactIds } = authorizedManifests(
      input.channelIds,
      input.artifactIds,
    );
    const requestFingerprint = canonicalDigest({
      schema: "publishing-delivery-release-request/v1",
      approvalRequestId,
      channelIds: [...channelIds].sort(),
      artifactIds: [...artifactIds].sort(),
      authorizationContractDigest: contractDigest,
    });
    const prior = await this.repository.readReleaseReceipt({
      workspaceId: input.workspaceId,
      principalId,
      capability: "publishing_plan_revisions.release@1",
      idempotencyKey,
      requestFingerprint,
    });
    if (prior.kind === "conflict") fail("conflict");
    if (prior.kind === "replayed") {
      const release = await this.repository.getRelease({
        workspaceId: input.workspaceId,
        releaseId: prior.releaseId,
        consumingPrincipalId: principalId,
      });
      if (!release) fail("unavailable");
      return acceptance({ release });
    }

    const approval = await this.repository.getApprovalForRelease({
      workspaceId: input.workspaceId,
      approvalRequestId,
      requestingPrincipalId: principalId,
    });
    if (approval?.consumption) fail("approval_consumed");
    if (!exactApprovedRequest({ approval, workspaceId: input.workspaceId, principalId, approvalRequestId, now })) {
      fail("approval_invalid");
    }
    if (!approval?.decision || approval.retrySource !== null) fail("approval_invalid");
    const approved = approval;
    const approvedDecision = approval.decision;
    if (
      !sameExactSet(channelIds, approved.channelIds) ||
      !sameExactSet(artifactIds, approved.artifactIds)
    ) {
      fail("authorization_stale");
    }
    const revision = await this.revisions.getCurrentRevision({
      workspaceId: input.workspaceId,
      revisionId: approved.planRevisionId,
    });
    if (
      !revision ||
      revision.planId !== approved.planId ||
      revision.revision !== approved.planRevision ||
      revision.definitionDigest !== approved.planRevisionDigest
    ) {
      fail("stale_revision");
    }
    const approvedTargets = approved.targetIds.map((targetId) =>
      revision.definition.targets.find((target) => target.targetId === targetId),
    );
    if (approvedTargets.some((target) => !target)) fail("validation_stale");
    const derivedChannels = approvedTargets.map((target) => target!.channelId);
    const derivedArtifacts = approvedTargets.flatMap((target) => [
      target!.contentArtifactId,
      ...target!.mediaArtifactIds,
    ]);
    if (
      !sameExactSet([...new Set(derivedChannels)], approved.channelIds) ||
      !sameExactSet([...new Set(derivedArtifacts)], approved.artifactIds)
    ) fail("validation_stale");
    const authorizationSession = await this.authorization.checkCurrent({
      workspaceId: input.workspaceId,
      principalId,
      keyId,
      capability: "publishing_plan_revisions.release@1",
      authorizationContractDigest: contractDigest,
      authorizationEvidenceRef: input.authorizationEvidenceRef,
      channelIds,
      artifactIds,
      evaluatedAt: now,
    });
    if (!validPublishingDeliveryAuthorizationSession({
      session: authorizationSession,
      workspaceId: input.workspaceId,
      principalId,
      keyId,
      capability: "publishing_plan_revisions.release@1",
      authorizationContractDigest: contractDigest,
      authorizationEvidenceRef: input.authorizationEvidenceRef,
      channelIds: approved.channelIds,
      artifactIds: approved.artifactIds,
      now,
    })) {
      fail("authorization_stale");
    }
    if (!authorizationSession) fail("authorization_stale");
    const currentAuthorization = authorizationSession;
    const validationSession = await this.validation.verifyCurrent({
      workspaceId: input.workspaceId,
      revision,
      targetIds: approved.targetIds,
      evaluatedAt: now,
      mode: "release",
    });
    if (!validPublishingDeliveryValidationSession({
      session: validationSession,
      approval: approved,
      revision,
      now,
    })) {
      fail("validation_stale");
    }
    if (!validationSession) fail("validation_stale");
    const currentValidation = validationSession;

    const releaseId = id("pdr");
    const deliveries: PublishingDeliveryRecord[] = approved.targetIds.map((targetId) => {
      const targetSnapshot = publishingDeliveryTargetSnapshot({ revision, targetId });
      const deliveryId = id("pdl");
      const publishAt = new Date(targetSnapshot.target.timing.publishAt);
      if (!Number.isFinite(publishAt.getTime())) fail("validation_stale");
      const artifacts = [
        targetSnapshot.target.contentArtifactId,
        ...targetSnapshot.target.mediaArtifactIds,
      ];
      return {
        id: deliveryId,
        workspaceId: input.workspaceId,
        sourceDeliveryId: null,
        retryId: null,
        releaseId,
        planId: revision.planId,
        planRevisionId: revision.id,
        planRevision: revision.revision,
        planRevisionDigest: revision.definitionDigest,
        approvalRequestId: approved.id,
        approvalDecisionId: approvedDecision.id,
        requestingPrincipalId: approved.requestingPrincipalId,
        requestingKeyId: approved.requestingKeyId,
        targetId,
        channelId: targetSnapshot.target.channelId,
        artifactIds: artifacts,
        targetSnapshot,
        targetSnapshotDigest: canonicalDigest(targetSnapshot),
        publishAt,
        desiredState: "publish",
        state: "scheduled",
        effectKey: publishingDeliveryEffectKey(input.workspaceId, deliveryId),
        effectGeneration: 1,
        intentDigest: null,
        providerAdapterContractDigest: null,
        nextEffectAttempt: 1,
        providerOperationRef: null,
        latestEffectEvidenceDigest: null,
        failureCode: null,
        failureClass: null,
        failureRetryable: null,
        failureEffectDisposition: null,
        readinessBlockCode: null,
        readinessEvidenceDigest: null,
        readinessBlockedAt: null,
        readinessRetryAt: null,
        readinessBlockCount: 0,
        nextEventSequence: 3,
        nextOutboxGeneration: 2,
        acceptedAt: now,
        scheduledAt: now,
        dispatchStartedAt: null,
        effectContactStartedAt: null,
        completedAt: null,
        updatedAt: now,
      };
    });
    const firstEvents: PublishingDeliveryEvent[] = deliveries.flatMap((delivery) => [
      {
        schema: "publishing-delivery-event/v1" as const,
        id: eventId(delivery.id, 1),
        workspaceId: delivery.workspaceId,
        deliveryId: delivery.id,
        sequence: 1,
        type: "delivery.accepted" as const,
      evidence: {
        origin: "release" as const,
        releaseId,
        sourceDeliveryId: null,
        retryId: null,
        approvalRequestId: approved.id,
          approvalDecisionId: approvedDecision.id,
          targetSnapshotDigest: delivery.targetSnapshotDigest,
        },
        occurredAt: now,
      },
      {
        schema: "publishing-delivery-event/v1" as const,
        id: eventId(delivery.id, 2),
        workspaceId: delivery.workspaceId,
        deliveryId: delivery.id,
        sequence: 2,
        type: "delivery.scheduled" as const,
        evidence: { publishAt: delivery.publishAt.toISOString() },
        occurredAt: now,
      },
    ]);
    const outboxIntents: PublishingDeliveryOutboxIntentRecord[] = deliveries.map(
      (delivery) => ({
        id: id("pdo"),
        workspaceId: delivery.workspaceId,
        deliveryId: delivery.id,
        purpose: "publish" as const,
        dedupeKey: publishingDeliveryOutboxDedupeKey(
          delivery.workspaceId,
          delivery.id,
          1,
        ),
        generation: 1,
        state: "pending",
        availableAt: delivery.publishAt,
        deliveryToken: null,
        deliveryAttempts: 0,
        claimedAt: null,
        deliveredAt: null,
      }),
    );
    const acceptedDeliveries = deliveries.map(publishingDeliveryAcceptedRef);
    const release = {
      id: releaseId,
      workspaceId: input.workspaceId,
      planId: revision.planId,
      planRevisionId: revision.id,
      planRevision: revision.revision,
      planRevisionDigest: revision.definitionDigest,
      approvalRequestId: approved.id,
      approvalDecisionId: approvedDecision.id,
      consumingPrincipalId: principalId,
      consumingKeyId: keyId,
      capability: "publishing_plan_revisions.release@1" as const,
      authorizationContractDigest: contractDigest,
      authorizationEvidenceRef: currentAuthorization.evidenceRef,
      authorizedResources: structuredClone(currentAuthorization.resources),
      authorizationIssuedAt: currentAuthorization.issuedAt,
      authorizationExpiresAt: currentAuthorization.expiresAt,
      validationSessionId: currentValidation.id,
      validationEvidenceDigest: approved.validation.evidenceDigest,
      validationCurrentStateDigest: approved.validation.currentStateDigest,
      acceptedDeliveries,
      createdAt: now,
    };
    const result = await this.repository.release({
      release,
      approval: approved,
      revision,
      approvalConsumption: {
        id: id("pac"),
        workspaceId: input.workspaceId,
        approvalRequestId: approved.id,
        decisionId: approvedDecision.id,
        consumingPrincipalId: principalId,
        consumingKeyId: keyId,
        capability: "publishing_plan_revisions.release@1",
        authorizationContractDigest: contractDigest,
        authorizationEvidenceRef: currentAuthorization.evidenceRef,
        authorizedResources: structuredClone(currentAuthorization.resources),
        authorizationIssuedAt: currentAuthorization.issuedAt,
        authorizationExpiresAt: currentAuthorization.expiresAt,
        consumedAt: now,
      },
      authorizationSession: currentAuthorization,
      validationSession: currentValidation,
      deliveries,
      firstEvents,
      outboxIntents,
      receipt: {
        workspaceId: input.workspaceId,
        principalId,
        capability: "publishing_plan_revisions.release@1",
        idempotencyKey,
        requestFingerprint,
        releaseId,
        createdAt: now,
      },
    });
    if (result.kind !== "created" && result.kind !== "replayed") fail(result.kind);
    return acceptance({ release: result.release });
  }

  async cancel(input: {
    workspaceId: string;
    actor: PublishingDeliveryCancellationActor;
    deliveryId: string;
    channelIds: string[];
    artifactIds: string[];
    authorizationEvidenceRef: string;
    authorizationContractDigest: string;
  }): Promise<PublishingDeliveryCancellationDto> {
    const now = this.clock.now();
    const deliveryId = publishingDeliveryIdentifier(input.deliveryId, "Delivery ID");
    const actor: PublishingDeliveryCancellationActor = input.actor.kind === "agent"
      ? {
          kind: "agent",
          principalId: publishingDeliveryIdentifier(input.actor.principalId, "Principal ID"),
          keyId: publishingDeliveryIdentifier(input.actor.keyId, "Key ID"),
        }
      : {
          kind: "human",
          userId: publishingDeliveryIdentifier(input.actor.userId, "User ID"),
        };
    const manifests = authorizedManifests(input.channelIds, input.artifactIds);
    const contractDigest = publishingDeliveryCancelAuthorizationContractDigest();
    if (
      input.authorizationContractDigest !== contractDigest ||
      !/^[^\u0000-\u001f\u007f]{1,200}$/.test(input.authorizationEvidenceRef)
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED",
        "Exact current Publishing Delivery cancellation authority is required.",
      );
    }
    let replay: PublishingDeliveryCancellationRecord | null;
    try {
      replay = await this.repository.getCancellation({
        workspaceId: input.workspaceId,
        deliveryId,
        actor,
      });
    } catch {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
        "Publishing Delivery Cancellation evidence is unavailable.",
      );
    }
    if (
      replay &&
      sameExactSet(manifests.channelIds, replay.authorizedResources.channelIds) &&
      sameExactSet(manifests.artifactIds, replay.authorizedResources.artifactIds)
    ) {
      return cancellationDto({
        id: replay.id,
        deliveryId: replay.deliveryId,
        stateAtRequest: replay.stateAtRequest,
        outcome: replay.outcome,
        externallyCompletedAtRequest: replay.externallyCompletedAtRequest,
        requestedAt: replay.requestedAt,
      });
    }
    const delivery = await this.repository.getDelivery({
      workspaceId: input.workspaceId,
      deliveryId,
      authorizedChannelIds: manifests.channelIds,
      authorizedArtifactIds: manifests.artifactIds,
    });
    if (!delivery) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_NOT_FOUND",
        "The Publishing Delivery is unavailable.",
      );
    }
    if (
      !sameExactSet(manifests.channelIds, [delivery.channelId]) ||
      !sameExactSet(manifests.artifactIds, delivery.artifactIds)
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED",
        "Exact current Publishing Delivery cancellation authority is required.",
      );
    }
    const session = await this.cancellationAuthorization?.checkCurrent({
      workspaceId: input.workspaceId,
      actor,
      capability: "publishing_deliveries.cancel@1",
      authorizationContractDigest: contractDigest,
      authorizationEvidenceRef: input.authorizationEvidenceRef,
      channelIds: manifests.channelIds,
      artifactIds: manifests.artifactIds,
      evaluatedAt: now,
    }) ?? null;
    if (!validCancellationAuthorization({
      session,
      workspaceId: input.workspaceId,
      actor,
      contractDigest,
      evidenceRef: input.authorizationEvidenceRef,
      channelIds: manifests.channelIds,
      artifactIds: manifests.artifactIds,
      now,
    })) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED",
        "Exact current Publishing Delivery cancellation authority is required.",
      );
    }
    if (!session) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED",
        "Exact current Publishing Delivery cancellation authority is required.",
      );
    }
    const result = await this.repository.cancel({
      workspaceId: input.workspaceId,
      deliveryId,
      cancellationId: id("pdc"),
      actor,
      authorizationSession: session,
      requestedAt: now,
    });
    if (result.kind === "not_found") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_NOT_FOUND",
        "The Publishing Delivery is unavailable.",
      );
    }
    if (result.kind === "authorization_stale") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED",
        "Exact current Publishing Delivery cancellation authority is required.",
      );
    }
    if (result.kind === "unavailable") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
        "Durable Publishing Delivery cancellation could not be committed.",
      );
    }
    if (result.kind !== "created" && result.kind !== "replayed") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
        "Durable Publishing Delivery cancellation could not be committed.",
      );
    }
    return cancellationDto({
      id: result.cancellation.id,
      deliveryId: result.cancellation.deliveryId,
      stateAtRequest: result.cancellation.stateAtRequest,
      outcome: result.cancellation.outcome,
      externallyCompletedAtRequest:
        result.cancellation.externallyCompletedAtRequest,
      requestedAt: result.cancellation.requestedAt,
    });
  }

  async retry(input: {
    workspaceId: string;
    actor: PublishingDeliveryRecoveryActor;
    deliveryId: string;
    approvalRequestId: string;
    expectedFailureEvidenceDigest: string;
    idempotencyKey: string;
    channelIds: string[];
    artifactIds: string[];
    authorizationEvidenceRef: string;
    authorizationContractDigest: string;
  }): Promise<PublishingDeliveryRetryDto> {
    const now = this.clock.now();
    const deliveryId = publishingDeliveryIdentifier(input.deliveryId, "Delivery ID");
    const approvalRequestId = publishingDeliveryIdentifier(
      input.approvalRequestId,
      "Approval Request ID",
    );
    const idempotencyKey = publishingDeliveryIdempotencyKey(input.idempotencyKey);
    if (!DIGEST.test(input.expectedFailureEvidenceDigest)) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_INVALID_INPUT",
        "Expected failure evidence digest is invalid.",
      );
    }
    const actor: PublishingDeliveryRecoveryActor = input.actor.kind === "agent"
      ? {
          kind: "agent",
          principalId: publishingDeliveryIdentifier(input.actor.principalId, "Principal ID"),
          keyId: publishingDeliveryIdentifier(input.actor.keyId, "Key ID"),
        }
      : {
          kind: "human",
          userId: publishingDeliveryIdentifier(input.actor.userId, "User ID"),
        };
    const manifests = authorizedManifests(input.channelIds, input.artifactIds);
    const actorKind = actor.kind;
    const actorId = actor.kind === "agent" ? actor.principalId : actor.userId;
    const requestFingerprint = canonicalDigest({
      schema: "publishing-delivery-retry-command/v1",
      deliveryId,
      approvalRequestId,
      expectedFailureEvidenceDigest: input.expectedFailureEvidenceDigest,
      actor,
      channelIds: manifests.channelIds,
      artifactIds: manifests.artifactIds,
    });
    const contractDigest = publishingDeliveryRetryAuthorizationContractDigest();
    if (
      input.authorizationContractDigest !== contractDigest ||
      !/^[^\u0000-\u001f\u007f]{1,200}$/.test(input.authorizationEvidenceRef)
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
        "Exact current Publishing Delivery retry authority is required.",
      );
    }
    const mutationReceipt = await this.repository.getRetryMutationReceipt({
      workspaceId: input.workspaceId,
      actorKind,
      actorId,
      capability: "publishing_deliveries.retry@1",
      idempotencyKey,
    });
    if (mutationReceipt && mutationReceipt.requestFingerprint !== requestFingerprint) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_IDEMPOTENCY_CONFLICT",
        "The idempotency key is bound to another Publishing Delivery retry command.",
      );
    }
    const replay = mutationReceipt
      ? await this.repository.getRetry({
          workspaceId: input.workspaceId,
          sourceDeliveryId: deliveryId,
          sourceEvidenceDigest: input.expectedFailureEvidenceDigest,
          actor,
        })
      : null;
    if (mutationReceipt && !replay) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
        "Durable Publishing Delivery retry evidence is unavailable.",
      );
    }
    if (replay) {
      if (
        mutationReceipt?.retryId !== replay.id ||
        mutationReceipt.deliveryId !== replay.deliveryId ||
        mutationReceipt.sourceDeliveryId !== replay.sourceDeliveryId ||
        replay.approvalRequestId !== approvalRequestId ||
        replay.authorization.capability !== "publishing_deliveries.retry@1" ||
        !sameActor(replay.actor, actor) ||
        !sameExactSet(replay.authorization.resources.channelIds, manifests.channelIds) ||
        !sameExactSet(replay.authorization.resources.artifactIds, manifests.artifactIds)
      ) {
        throw new PublishingDeliveryServiceError(
          "PUBLISHING_DELIVERY_RETRY_NOT_SAFE",
          "The retry command does not match the retained intrinsic request.",
        );
      }
      const replayAuthorization = await this.recoveryAuthorization?.checkCurrent({
        workspaceId: input.workspaceId,
        actor,
        capability: "publishing_deliveries.retry@1",
        authorizationContractDigest: contractDigest,
        authorizationEvidenceRef: input.authorizationEvidenceRef,
        channelIds: manifests.channelIds,
        artifactIds: manifests.artifactIds,
        evaluatedAt: now,
      }) ?? null;
      if (!replayAuthorization || !validRecoveryAuthorization({
        session: replayAuthorization,
        workspaceId: input.workspaceId,
        actor,
        capability: "publishing_deliveries.retry@1",
        contractDigest,
        evidenceRef: input.authorizationEvidenceRef,
        channelIds: manifests.channelIds,
        artifactIds: manifests.artifactIds,
        now,
      })) {
        throw new PublishingDeliveryServiceError(
          "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
          "Exact current Publishing Delivery retry authority is required.",
        );
      }
      const acceptedDelivery = await this.repository.getDelivery({
        workspaceId: input.workspaceId,
        deliveryId: replay.deliveryId,
        authorizedChannelIds: manifests.channelIds,
        authorizedArtifactIds: manifests.artifactIds,
      });
      if (!acceptedDelivery || acceptedDelivery.sourceDeliveryId !== deliveryId ||
        acceptedDelivery.retryId !== replay.id) {
        throw new PublishingDeliveryServiceError(
          "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
          "Durable Publishing Delivery retry evidence is unavailable.",
        );
      }
      return retryDto({ retry: replay, delivery: acceptedDelivery });
    }
    const delivery = await this.repository.getDelivery({
      workspaceId: input.workspaceId,
      deliveryId,
      authorizedChannelIds: manifests.channelIds,
      authorizedArtifactIds: manifests.artifactIds,
    });
    if (!delivery) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_NOT_FOUND",
        "The Publishing Delivery is unavailable.",
      );
    }
    if (
      !sameExactSet(manifests.channelIds, [delivery.channelId]) ||
      !sameExactSet(manifests.artifactIds, delivery.artifactIds)
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
        "Exact current Publishing Delivery retry authority is required.",
      );
    }
    if (
      delivery.desiredState !== "publish" ||
      !(
        (delivery.state === "failed_transient" &&
          delivery.failureClass === "transient" &&
          delivery.failureRetryable === true) ||
        (delivery.state === "failed_terminal" &&
          delivery.failureClass === "terminal" &&
          delivery.failureRetryable === false)
      ) ||
      (delivery.failureEffectDisposition !== "not_created" &&
        delivery.failureEffectDisposition !== "provider_failed_known") ||
      delivery.latestEffectEvidenceDigest !== input.expectedFailureEvidenceDigest
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RETRY_NOT_SAFE",
        "Retained effect evidence does not prove that this retry is safe.",
      );
    }
    const approval = await this.repository.getApprovalForRelease({
      workspaceId: input.workspaceId,
      approvalRequestId,
      requestingPrincipalId: delivery.requestingPrincipalId,
    });
    if (
      !exactApprovedRequest({
        approval,
        workspaceId: input.workspaceId,
        principalId: delivery.requestingPrincipalId,
        approvalRequestId,
        now,
      }) ||
      !approval?.decision ||
      approval.consumption ||
      !sameExactSet(approval.targetIds, [delivery.targetId]) ||
      !sameExactSet(approval.channelIds, [delivery.channelId]) ||
      !sameExactSet(approval.artifactIds, delivery.artifactIds) ||
      approval.planId !== delivery.planId ||
      approval.planRevisionId !== delivery.planRevisionId ||
      approval.planRevision !== delivery.planRevision ||
      approval.planRevisionDigest !== delivery.planRevisionDigest ||
      approval.retrySource?.deliveryId !== delivery.id ||
      approval.retrySource.evidenceDigest !== input.expectedFailureEvidenceDigest
    ) {
      throw new PublishingDeliveryServiceError(
        approval?.consumption
          ? "PUBLISHING_DELIVERY_APPROVAL_CONSUMED"
          : "PUBLISHING_DELIVERY_APPROVAL_INVALID",
        "A fresh exact Approval is required for Publishing Delivery retry.",
      );
    }
    const revision = await this.revisions.getCurrentRevision({
      workspaceId: input.workspaceId,
      revisionId: delivery.planRevisionId,
    });
    if (
      !revision ||
      revision.planId !== delivery.planId ||
      revision.revision !== delivery.planRevision ||
      revision.definitionDigest !== delivery.planRevisionDigest ||
      canonicalDigest(publishingDeliveryTargetSnapshot({
        revision,
        targetId: delivery.targetId,
      })) !== delivery.targetSnapshotDigest
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_STALE_REVISION",
        "The immutable Delivery target no longer matches the approved Revision.",
      );
    }
    const session = await this.recoveryAuthorization?.checkCurrent({
      workspaceId: input.workspaceId,
      actor,
      capability: "publishing_deliveries.retry@1",
      authorizationContractDigest: contractDigest,
      authorizationEvidenceRef: input.authorizationEvidenceRef,
      channelIds: manifests.channelIds,
      artifactIds: manifests.artifactIds,
      evaluatedAt: now,
    }) ?? null;
    if (!session || !validRecoveryAuthorization({
      session,
      workspaceId: input.workspaceId,
      actor,
      capability: "publishing_deliveries.retry@1",
      contractDigest,
      evidenceRef: input.authorizationEvidenceRef,
      channelIds: manifests.channelIds,
      artifactIds: manifests.artifactIds,
      now,
    })) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
        "Exact current Publishing Delivery retry authority is required.",
      );
    }
    const currentRecoveryAuthorization = session;
    const validationSession = await this.validation.verifyCurrent({
      workspaceId: input.workspaceId,
      revision,
      targetIds: [delivery.targetId],
      evaluatedAt: now,
      mode: "retry_due",
    });
    if (!validPublishingDeliveryValidationSession({
      session: validationSession,
      approval,
      revision,
      now,
    }) || !validationSession) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_VALIDATION_STALE",
        "Publish Validation changed or expired before retry commit.",
      );
    }
    const retryId = id("pdrt");
    const acceptedDeliveryId = id("pdl");
    const effectKey = publishingDeliveryEffectKey(
      input.workspaceId,
      acceptedDeliveryId,
    );
    const retry = {
      schema: "publishing-delivery-retry-record/v1" as const,
      id: retryId,
      workspaceId: input.workspaceId,
      sourceDeliveryId: deliveryId,
      deliveryId: acceptedDeliveryId,
      actor: structuredClone(actor),
      sourceEffectKey: delivery.effectKey,
      sourceEffectGeneration: delivery.effectGeneration,
      sourceIntentDigest: delivery.intentDigest,
      sourceProviderAdapterContractDigest: delivery.providerAdapterContractDigest,
      sourceEvidenceDigest: input.expectedFailureEvidenceDigest,
      sourceFailureClass: delivery.failureClass,
      sourceEffectDisposition: delivery.failureEffectDisposition,
      approvalRequestId: approval.id,
      approvalDecisionId: approval.decision.id,
      authorization: structuredClone(currentRecoveryAuthorization),
      requestedAt: now,
    };
    const acceptedDelivery: PublishingDeliveryRecord = {
      ...structuredClone(delivery),
      id: acceptedDeliveryId,
      sourceDeliveryId: delivery.id,
      retryId,
      releaseId: null,
      approvalRequestId: approval.id,
      approvalDecisionId: approval.decision.id,
      requestingPrincipalId: approval.requestingPrincipalId,
      requestingKeyId: approval.requestingKeyId,
      desiredState: "publish",
      state: "scheduled",
      effectKey,
      effectGeneration: 1,
      intentDigest: delivery.intentDigest,
      providerAdapterContractDigest: delivery.providerAdapterContractDigest,
      nextEffectAttempt: 1,
      providerOperationRef: null,
      latestEffectEvidenceDigest: null,
      failureCode: null,
      failureClass: null,
      failureRetryable: null,
      failureEffectDisposition: null,
      readinessBlockCode: null,
      readinessEvidenceDigest: null,
      readinessBlockedAt: null,
      readinessRetryAt: null,
      readinessBlockCount: 0,
      nextEventSequence: 4,
      nextOutboxGeneration: 2,
      acceptedAt: now,
      scheduledAt: now,
      dispatchStartedAt: null,
      effectContactStartedAt: null,
      completedAt: null,
      updatedAt: now,
    };
    const events: PublishingDeliveryEvent[] = [{
      schema: "publishing-delivery-event/v1",
      id: eventId(acceptedDeliveryId, 1),
      workspaceId: delivery.workspaceId,
      deliveryId: acceptedDeliveryId,
      sequence: 1,
      type: "delivery.accepted",
      evidence: {
        origin: "retry",
        releaseId: null,
        sourceDeliveryId: delivery.id,
        retryId,
        approvalRequestId: approval.id,
        approvalDecisionId: approval.decision.id,
        targetSnapshotDigest: delivery.targetSnapshotDigest,
      },
      occurredAt: now,
    }, {
      schema: "publishing-delivery-event/v1",
      id: eventId(acceptedDeliveryId, 2),
      workspaceId: delivery.workspaceId,
      deliveryId: acceptedDeliveryId,
      sequence: 2,
      type: "delivery.retry_requested",
      evidence: {
        retryId,
        sourceDeliveryId: delivery.id,
        approvalRequestId: approval.id,
        approvalDecisionId: approval.decision.id,
        sourceEffectKey: delivery.effectKey,
        sourceEffectGeneration: delivery.effectGeneration,
        sourceEvidenceDigest: input.expectedFailureEvidenceDigest,
        deliveryId: acceptedDeliveryId,
        effectKey,
      },
      occurredAt: now,
    }, {
      schema: "publishing-delivery-event/v1",
      id: eventId(acceptedDeliveryId, 3),
      workspaceId: delivery.workspaceId,
      deliveryId: acceptedDeliveryId,
      sequence: 3,
      type: "delivery.scheduled",
      evidence: { publishAt: acceptedDelivery.publishAt.toISOString() },
      occurredAt: now,
    }];
    const outboxIntent: PublishingDeliveryOutboxIntentRecord = {
      id: id("pdo"),
      workspaceId: input.workspaceId,
      deliveryId: acceptedDeliveryId,
      purpose: "publish",
      dedupeKey: publishingDeliveryOutboxDedupeKey(
        input.workspaceId,
        acceptedDeliveryId,
        1,
      ),
      generation: 1,
      state: "pending",
      availableAt: now,
      deliveryToken: null,
      deliveryAttempts: 0,
      claimedAt: null,
      deliveredAt: null,
    };
    const result = await this.repository.retryKnownFailure({
      retry,
      sourceDelivery: delivery,
      delivery: acceptedDelivery,
      approval,
      approvalConsumption: {
        schema: "publishing-delivery-retry-approval-consumption/v1",
        id: id("pdrc"),
        workspaceId: input.workspaceId,
        approvalRequestId: approval.id,
        approvalDecisionId: approval.decision.id,
        sourceDeliveryId: deliveryId,
        deliveryId: acceptedDeliveryId,
        sourceEvidenceDigest: input.expectedFailureEvidenceDigest,
        requestingPrincipalId: approval.requestingPrincipalId,
        requestingKeyId: approval.requestingKeyId,
        actor: structuredClone(actor),
        capability: "publishing_deliveries.retry@1",
        authorizationContractDigest: contractDigest,
        authorizationEvidenceRef: currentRecoveryAuthorization.evidenceRef,
        authorizedResources: structuredClone(currentRecoveryAuthorization.resources),
        consumedAt: now,
      },
      mutationReceipt: {
        schema: "publishing-delivery-retry-mutation-receipt/v1",
        workspaceId: input.workspaceId,
        actorKind,
        actorId,
        capability: "publishing_deliveries.retry@1",
        idempotencyKey,
        requestFingerprint,
        retryId,
        sourceDeliveryId: deliveryId,
        deliveryId: acceptedDeliveryId,
        createdAt: now,
      },
      revision,
      validationSession,
      authorizationSession: currentRecoveryAuthorization,
      effectIdentity: {
        schema: "publishing-delivery-effect-identity/v1",
        workspaceId: input.workspaceId,
        deliveryId: acceptedDeliveryId,
        generation: 1,
        effectKey,
        intentDigest: delivery.intentDigest,
        providerAdapterContractDigest: delivery.providerAdapterContractDigest,
        parentEffectKey: null,
        parentGeneration: null,
        derivation: "manual_retry",
        sourceEvidenceDigest: input.expectedFailureEvidenceDigest,
        createdAt: now,
      },
      events,
      outboxIntent,
    });
    if (result.kind === "created" || result.kind === "replayed") {
      return retryDto({ retry: result.retry, delivery: result.delivery });
    }
    if (result.kind === "not_found") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_NOT_FOUND",
        "The Publishing Delivery is unavailable.",
      );
    }
    if (result.kind === "not_retryable" || result.kind === "retry_conflict") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RETRY_NOT_SAFE",
        "Retained effect evidence does not prove that this retry is safe.",
      );
    }
    if (result.kind === "authorization_stale") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
        "Exact current Publishing Delivery retry authority is required.",
      );
    }
    if (result.kind === "approval_invalid" || result.kind === "approval_consumed") {
      throw new PublishingDeliveryServiceError(
        result.kind === "approval_consumed"
          ? "PUBLISHING_DELIVERY_APPROVAL_CONSUMED"
          : "PUBLISHING_DELIVERY_APPROVAL_INVALID",
        "A fresh exact Approval is required for Publishing Delivery retry.",
      );
    }
    if (result.kind === "stale_revision") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_STALE_REVISION",
        "The immutable Delivery target no longer matches the approved Revision.",
      );
    }
    if (result.kind === "validation_stale") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_VALIDATION_STALE",
        "Publish Validation changed or expired before retry commit.",
      );
    }
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
      "Durable Publishing Delivery retry could not be committed.",
    );
  }

  async reconcile(input: {
    workspaceId: string;
    actor: PublishingDeliveryRecoveryActor;
    deliveryId: string;
    expectedUnknownEvidenceDigest: string;
    channelIds: string[];
    artifactIds: string[];
    authorizationEvidenceRef: string;
    authorizationContractDigest: string;
  }): Promise<PublishingDeliveryReconciliationDto> {
    const now = this.clock.now();
    const deliveryId = publishingDeliveryIdentifier(input.deliveryId, "Delivery ID");
    if (!DIGEST.test(input.expectedUnknownEvidenceDigest)) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_INVALID_INPUT",
        "Expected unknown evidence digest is invalid.",
      );
    }
    const actor: PublishingDeliveryRecoveryActor = input.actor.kind === "agent"
      ? {
          kind: "agent",
          principalId: publishingDeliveryIdentifier(input.actor.principalId, "Principal ID"),
          keyId: publishingDeliveryIdentifier(input.actor.keyId, "Key ID"),
        }
      : {
          kind: "human",
          userId: publishingDeliveryIdentifier(input.actor.userId, "User ID"),
        };
    const manifests = authorizedManifests(input.channelIds, input.artifactIds);
    const contractDigest = publishingDeliveryReconcileAuthorizationContractDigest();
    if (
      input.authorizationContractDigest !== contractDigest ||
      !/^[^\u0000-\u001f\u007f]{1,200}$/.test(input.authorizationEvidenceRef)
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
        "Exact current Publishing Delivery reconciliation authority is required.",
      );
    }
    const replay = await this.repository.getReconciliation({
      workspaceId: input.workspaceId,
      deliveryId,
      sourceEvidenceDigest: input.expectedUnknownEvidenceDigest,
      actor,
    });
    if (replay) {
      if (
        replay.request.authorization.capability !==
          "publishing_deliveries.reconcile@1" ||
        !sameActor(replay.request.actor, actor) ||
        !sameExactSet(
          replay.request.authorization.resources.channelIds,
          manifests.channelIds,
        ) ||
        !sameExactSet(
          replay.request.authorization.resources.artifactIds,
          manifests.artifactIds,
        )
      ) {
        throw new PublishingDeliveryServiceError(
          "PUBLISHING_DELIVERY_RECONCILIATION_NOT_AVAILABLE",
          "The reconciliation command does not match the retained intrinsic request.",
        );
      }
      return reconciliationDto(replay);
    }
    const delivery = await this.repository.getDelivery({
      workspaceId: input.workspaceId,
      deliveryId,
      authorizedChannelIds: manifests.channelIds,
      authorizedArtifactIds: manifests.artifactIds,
    });
    if (!delivery) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_NOT_FOUND",
        "The Publishing Delivery is unavailable.",
      );
    }
    if (
      !sameExactSet(manifests.channelIds, [delivery.channelId]) ||
      !sameExactSet(manifests.artifactIds, delivery.artifactIds)
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
        "Exact current Publishing Delivery reconciliation authority is required.",
      );
    }
    if (
      delivery.state !== "outcome_unknown" ||
      publishingDeliveryReconciliationExhausted(delivery) ||
      delivery.failureEffectDisposition !== "ambiguous" ||
      delivery.latestEffectEvidenceDigest !== input.expectedUnknownEvidenceDigest ||
      !delivery.intentDigest ||
      !delivery.providerAdapterContractDigest
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECONCILIATION_NOT_AVAILABLE",
        "The exact ambiguous effect is not available for reconciliation.",
      );
    }
    const session = await this.recoveryAuthorization?.checkCurrent({
      workspaceId: input.workspaceId,
      actor,
      capability: "publishing_deliveries.reconcile@1",
      authorizationContractDigest: contractDigest,
      authorizationEvidenceRef: input.authorizationEvidenceRef,
      channelIds: manifests.channelIds,
      artifactIds: manifests.artifactIds,
      evaluatedAt: now,
    }) ?? null;
    if (!session || !validRecoveryAuthorization({
      session,
      workspaceId: input.workspaceId,
      actor,
      capability: "publishing_deliveries.reconcile@1",
      contractDigest,
      evidenceRef: input.authorizationEvidenceRef,
      channelIds: manifests.channelIds,
      artifactIds: manifests.artifactIds,
      now,
    })) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
        "Exact current Publishing Delivery reconciliation authority is required.",
      );
    }
    const currentRecoveryAuthorization = session;
    const reconciliationId = id("pdre");
    const reconciliation = {
      schema: "publishing-delivery-reconciliation-request/v1" as const,
      id: reconciliationId,
      workspaceId: input.workspaceId,
      deliveryId,
      actor: structuredClone(actor),
      sourceEffectKey: delivery.effectKey,
      sourceEffectGeneration: delivery.effectGeneration,
      sourceIntentDigest: delivery.intentDigest,
      sourceProviderAdapterContractDigest: delivery.providerAdapterContractDigest,
      sourceProviderOperationRef: delivery.providerOperationRef,
      sourceEvidenceDigest: input.expectedUnknownEvidenceDigest,
      authorization: structuredClone(currentRecoveryAuthorization),
      requestedAt: now,
    };
    const event: PublishingDeliveryEvent = {
      schema: "publishing-delivery-event/v1",
      id: eventId(delivery.id, delivery.nextEventSequence),
      workspaceId: delivery.workspaceId,
      deliveryId: delivery.id,
      sequence: delivery.nextEventSequence,
      type: "delivery.reconciliation_requested",
      evidence: {
        reconciliationId,
        effectKey: delivery.effectKey,
        effectGeneration: delivery.effectGeneration,
        sourceEvidenceDigest: input.expectedUnknownEvidenceDigest,
      },
      occurredAt: now,
    };
    const outboxIntent: PublishingDeliveryOutboxIntentRecord = {
      id: id("pdo"),
      workspaceId: input.workspaceId,
      deliveryId,
      purpose: "reconcile",
      dedupeKey: publishingDeliveryOutboxDedupeKey(
        input.workspaceId,
        deliveryId,
        delivery.nextOutboxGeneration,
      ),
      generation: delivery.nextOutboxGeneration,
      state: "pending",
      availableAt: now,
      deliveryToken: null,
      deliveryAttempts: 0,
      claimedAt: null,
      deliveredAt: null,
    };
    const result = await this.repository.requestReconciliation({
      reconciliation,
      authorizationSession: currentRecoveryAuthorization,
      event,
      outboxIntent,
    });
    if (result.kind === "created" || result.kind === "replayed") {
      return reconciliationDto({ request: result.reconciliation, result: null });
    }
    if (result.kind === "not_found") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_NOT_FOUND",
        "The Publishing Delivery is unavailable.",
      );
    }
    if (result.kind === "not_reconcilable" ||
      result.kind === "reconciliation_conflict") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECONCILIATION_NOT_AVAILABLE",
        "The exact ambiguous effect is not available for reconciliation.",
      );
    }
    if (result.kind === "authorization_stale") {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
        "Exact current Publishing Delivery reconciliation authority is required.",
      );
    }
    throw new PublishingDeliveryServiceError(
      "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
      "Durable Publishing Delivery reconciliation could not be committed.",
    );
  }

  async get(input: PublishingDeliveryInspectionInput & {
    workspaceId: string;
    deliveryId: string;
  }) {
    const scope = inspectionScope(input);
    const delivery = await this.repository.getDelivery({
      workspaceId: input.workspaceId,
      deliveryId: publishingDeliveryIdentifier(input.deliveryId, "Delivery ID"),
      ...scope,
    });
    if (!delivery) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_NOT_FOUND",
        "The Publishing Delivery is unavailable.",
      );
    }
    return publishingDeliveryDto(delivery);
  }

  async inspect(input: PublishingDeliveryInspectionInput & {
    workspaceId: string;
    deliveryId: string;
  }) {
    let delivery = await this.get(input);
    let cancellation: PublishingDeliveryCancellationRecord | null;
    try {
      cancellation = await this.repository.getCancellation({
        workspaceId: input.workspaceId,
        deliveryId: delivery.id,
      });
    } catch {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
        "Publishing Delivery Cancellation evidence is unavailable.",
      );
    }
    if (cancellation) {
      // Cancellation is immutable and commits with the Delivery transition.
      // Re-read after observing it so a racing cancellation cannot pair its
      // truth with the pre-cancellation Delivery projection.
      delivery = await this.get(input);
    }
    return {
      schema: "publishing-delivery-inspection/v2" as const,
      delivery,
      cancellation: cancellation
        ? cancellationDto(cancellation)
        : null,
    };
  }

  async list(input: PublishingDeliveryInspectionInput & {
    workspaceId: string;
    filters: PublishingDeliveryListFilters;
    before?: PublishingDeliveryListPosition;
    limit: number;
  }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 101) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_INVALID_INPUT",
        "Publishing Delivery list limit is invalid.",
      );
    }
    const scope = inspectionScope(input);
    return (
      await this.repository.listDeliveries({
        workspaceId: input.workspaceId,
        filters: {
          ...input.filters,
          ...scope,
        },
        before: input.before,
        limit: input.limit,
      })
    ).map(publishingDeliveryDto);
  }

  async listEvents(input: PublishingDeliveryInspectionInput & {
    workspaceId: string;
    deliveryId: string;
    afterSequence: number;
    limit: number;
  }): Promise<PublishingDeliveryEventDto[]> {
    if (
      !Number.isInteger(input.afterSequence) ||
      input.afterSequence < 0 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 101
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_INVALID_INPUT",
        "Publishing Delivery event position is invalid.",
      );
    }
    const scope = inspectionScope(input);
    const events = await this.repository.listEvents({
      workspaceId: input.workspaceId,
      deliveryId: publishingDeliveryIdentifier(input.deliveryId, "Delivery ID"),
      ...scope,
      afterSequence: input.afterSequence,
      limit: input.limit,
    });
    if (!events) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_NOT_FOUND",
        "The Publishing Delivery is unavailable.",
      );
    }
    return events.map((event) => ({
      ...structuredClone(event),
      occurredAt: event.occurredAt.toISOString(),
    }));
  }
}
