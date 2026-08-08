import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  publishingDeliveryReleaseAuthorizationContractDigest,
} from "./authorization-contract";
import { PublishingDeliveryServiceError } from "./errors";
import {
  publishingDeliveryEffectKey,
  publishingDeliveryOutboxDedupeKey,
} from "./keys";
import type {
  PublishingDeliveryAuthorizationPort,
  PublishingDeliveryClock,
  PublishingDeliveryDurableAcceptance,
  PublishingDeliveryEvent,
  PublishingDeliveryEventDto,
  PublishingDeliveryListFilters,
  PublishingDeliveryListPosition,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryRepository,
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
  publishingDeliveryTargetSnapshot,
  validPublishingDeliveryAuthorizationSession,
  validPublishingDeliveryValidationSession,
} from "./validation";

const systemClock: PublishingDeliveryClock = { now: () => new Date() };

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

function eventId(deliveryId: string, sequence: number): string {
  return `pde_${deliveryId}_${sequence}`;
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
    if (!approval?.decision) fail("approval_invalid");
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
        releaseId,
        planId: revision.planId,
        planRevisionId: revision.id,
        planRevision: revision.revision,
        planRevisionDigest: revision.definitionDigest,
        approvalRequestId: approved.id,
        approvalDecisionId: approvedDecision.id,
        targetId,
        channelId: targetSnapshot.target.channelId,
        artifactIds: artifacts,
        targetSnapshot,
        targetSnapshotDigest: canonicalDigest(targetSnapshot),
        publishAt,
        desiredState: "publish",
        state: "scheduled",
        effectKey: publishingDeliveryEffectKey(input.workspaceId, deliveryId),
        intentDigest: null,
        providerOperationRef: null,
        latestEffectEvidenceDigest: null,
        failureCode: null,
        nextEventSequence: 3,
        nextOutboxGeneration: 2,
        acceptedAt: now,
        scheduledAt: now,
        dispatchStartedAt: null,
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
          releaseId,
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

  async get(input: {
    workspaceId: string;
    principalId: string;
    deliveryId: string;
    authorizedChannelIds: string[];
    authorizedArtifactIds: string[];
  }) {
    const manifests = authorizedManifests(
      input.authorizedChannelIds,
      input.authorizedArtifactIds,
    );
    const delivery = await this.repository.getDelivery({
      workspaceId: input.workspaceId,
      deliveryId: publishingDeliveryIdentifier(input.deliveryId, "Delivery ID"),
      consumingPrincipalId: publishingDeliveryIdentifier(input.principalId, "Principal ID"),
      authorizedChannelIds: manifests.channelIds,
      authorizedArtifactIds: manifests.artifactIds,
    });
    if (!delivery) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_NOT_FOUND",
        "The Publishing Delivery is unavailable.",
      );
    }
    return publishingDeliveryDto(delivery);
  }

  async list(input: {
    workspaceId: string;
    principalId: string;
    filters: PublishingDeliveryListFilters;
    authorizedChannelIds: string[];
    authorizedArtifactIds: string[];
    before?: PublishingDeliveryListPosition;
    limit: number;
  }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 101) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_INVALID_INPUT",
        "Publishing Delivery list limit is invalid.",
      );
    }
    const manifests = authorizedManifests(
      input.authorizedChannelIds,
      input.authorizedArtifactIds,
    );
    return (
      await this.repository.listDeliveries({
        workspaceId: input.workspaceId,
        filters: {
          ...input.filters,
          consumingPrincipalId: publishingDeliveryIdentifier(input.principalId, "Principal ID"),
          authorizedChannelIds: manifests.channelIds,
          authorizedArtifactIds: manifests.artifactIds,
        },
        before: input.before,
        limit: input.limit,
      })
    ).map(publishingDeliveryDto);
  }

  async listEvents(input: {
    workspaceId: string;
    principalId: string;
    deliveryId: string;
    authorizedChannelIds: string[];
    authorizedArtifactIds: string[];
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
    const manifests = authorizedManifests(
      input.authorizedChannelIds,
      input.authorizedArtifactIds,
    );
    const events = await this.repository.listEvents({
      workspaceId: input.workspaceId,
      deliveryId: publishingDeliveryIdentifier(input.deliveryId, "Delivery ID"),
      consumingPrincipalId: publishingDeliveryIdentifier(input.principalId, "Principal ID"),
      authorizedChannelIds: manifests.channelIds,
      authorizedArtifactIds: manifests.artifactIds,
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
