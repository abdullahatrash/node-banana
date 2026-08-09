import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  PublishingApprovalRequestRecord,
  PublishingApprovalValidationSession,
} from "../publishing-approvals/types";
import type {
  PublishingDeliveryAuthorizationSession,
  PublishingDeliveryCancellationAuthorizationSession,
  PublishingDeliveryCancellationRecord,
  PublishingDeliveryEvent,
  PublishingDeliveryExecutionLeaseRecord,
  PublishingDeliveryEffectIdentityRecord,
  PublishingDeliveryMutationReceiptRecord,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryReconciliationProjection,
  PublishingDeliveryReconciliationRequestRecord,
  PublishingDeliveryReconciliationResultRecord,
  PublishingDeliveryRecoveryAuthorizationSession,
  PublishingDeliveryReleaseRecord,
  PublishingDeliveryReleaseResult,
  PublishingDeliveryRepository,
  PublishingDeliveryRetryApprovalConsumptionRecord,
  PublishingDeliveryRetryMutationReceiptRecord,
  PublishingDeliveryRetryRecord,
} from "./types";
import { publishingDeliveryOutboxDedupeKey } from "./keys";
import {
  publishingDeliveryAcceptedRef,
  publishingDeliveryReconciliationExhausted,
  validPublishingDeliveryAuthorizationSession,
  validPublishingDeliveryValidationSession,
} from "./validation";
import {
  normalizePublishingDeliverySettlement,
  planPublishingDeliveryCancellation,
} from "./cancellation-transition";

function key(...values: string[]): string {
  return values.join("\u0000");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function terminal(state: PublishingDeliveryRecord["state"]): boolean {
  return state === "succeeded" || state === "failed_transient" ||
    state === "failed_terminal" || state === "outcome_unknown" ||
    state === "cancelled";
}

export class InMemoryPublishingDeliveryRepository
  implements PublishingDeliveryRepository
{
  readonly approvals = new Map<string, PublishingApprovalRequestRecord>();
  readonly releases = new Map<string, PublishingDeliveryReleaseRecord>();
  readonly deliveries = new Map<string, PublishingDeliveryRecord>();
  readonly events = new Map<string, PublishingDeliveryEvent[]>();
  readonly outbox = new Map<string, PublishingDeliveryOutboxIntentRecord>();
  readonly receipts = new Map<string, PublishingDeliveryMutationReceiptRecord>();
  readonly cancellations = new Map<string, PublishingDeliveryCancellationRecord>();
  readonly effectIdentities = new Map<string, PublishingDeliveryEffectIdentityRecord>();
  readonly retries = new Map<string, PublishingDeliveryRetryRecord>();
  readonly retryMutationReceipts = new Map<string, PublishingDeliveryRetryMutationReceiptRecord>();
  readonly retryApprovalConsumptions = new Map<string, PublishingDeliveryRetryApprovalConsumptionRecord>();
  readonly reconciliations = new Map<string, PublishingDeliveryReconciliationProjection>();
  readonly leases = new Map<string, PublishingDeliveryExecutionLeaseRecord>();
  private readonly fences = new Map<string, bigint>();
  private authorizationVerifier: (
    session: PublishingDeliveryAuthorizationSession,
  ) => Promise<boolean> = async () => false;
  private validationVerifier: (
    session: PublishingApprovalValidationSession,
  ) => Promise<boolean> = async () => false;
  private cancellationAuthorizationVerifier: (
    session: PublishingDeliveryCancellationAuthorizationSession,
  ) => Promise<boolean> = async () => false;
  private recoveryAuthorizationVerifier: (
    session: PublishingDeliveryRecoveryAuthorizationSession,
  ) => Promise<boolean> = async () => false;
  private tail: Promise<void> = Promise.resolve();
  failNextMutation = false;

  seedApproval(approval: PublishingApprovalRequestRecord): void {
    this.approvals.set(key(approval.workspaceId, approval.id), clone(approval));
  }

  setAuthorizationSessionVerifier(
    verifier: (session: PublishingDeliveryAuthorizationSession) => Promise<boolean>,
  ): void {
    this.authorizationVerifier = verifier;
  }

  setValidationSessionVerifier(
    verifier: (session: PublishingApprovalValidationSession) => Promise<boolean>,
  ): void {
    this.validationVerifier = verifier;
  }

  setCancellationAuthorizationSessionVerifier(
    verifier: (
      session: PublishingDeliveryCancellationAuthorizationSession,
    ) => Promise<boolean>,
  ): void {
    this.cancellationAuthorizationVerifier = verifier;
  }

  setRecoveryAuthorizationSessionVerifier(
    verifier: (
      session: PublishingDeliveryRecoveryAuthorizationSession,
    ) => Promise<boolean>,
  ): void {
    this.recoveryAuthorizationVerifier = verifier;
  }

  private async lock<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tail = prior.then(() => current);
    await prior;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private originRelease(delivery: PublishingDeliveryRecord): PublishingDeliveryReleaseRecord | null {
    const visited = new Set<string>();
    let current: PublishingDeliveryRecord | undefined = delivery;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.releaseId) {
        return this.releases.get(key(current.workspaceId, current.releaseId)) ?? null;
      }
      current = current.sourceDeliveryId
        ? this.deliveries.get(key(current.workspaceId, current.sourceDeliveryId))
        : undefined;
    }
    return null;
  }

  async readReleaseReceipt(
    input: Parameters<PublishingDeliveryRepository["readReleaseReceipt"]>[0],
  ) {
    const receipt = this.receipts.get(
      key(input.workspaceId, input.principalId, input.capability, input.idempotencyKey),
    );
    if (!receipt) return { kind: "absent" as const };
    return receipt.requestFingerprint === input.requestFingerprint
      ? { kind: "replayed" as const, releaseId: receipt.releaseId }
      : { kind: "conflict" as const };
  }

  async getApprovalForRelease(
    input: Parameters<PublishingDeliveryRepository["getApprovalForRelease"]>[0],
  ) {
    const approval = this.approvals.get(key(input.workspaceId, input.approvalRequestId));
    return approval?.requestingPrincipalId === input.requestingPrincipalId
      ? clone(approval)
      : null;
  }

  async release(
    input: Parameters<PublishingDeliveryRepository["release"]>[0],
  ): Promise<PublishingDeliveryReleaseResult> {
    return this.lock(async () => {
      const receiptKey = key(
        input.receipt.workspaceId,
        input.receipt.principalId,
        input.receipt.capability,
        input.receipt.idempotencyKey,
      );
      const prior = this.receipts.get(receiptKey);
      if (prior) {
        if (prior.requestFingerprint !== input.receipt.requestFingerprint) {
          return { kind: "conflict" };
        }
        const replayRelease = this.releases.get(key(prior.workspaceId, prior.releaseId));
        if (!replayRelease) return { kind: "unavailable" };
        return {
          kind: "replayed",
          release: clone(replayRelease),
          deliveries: await this.getDeliveriesByRelease({
            workspaceId: replayRelease.workspaceId,
            releaseId: replayRelease.id,
          }),
        };
      }
      if (this.failNextMutation) {
        this.failNextMutation = false;
        return { kind: "unavailable" };
      }
      const storedApproval = this.approvals.get(
        key(input.approval.workspaceId, input.approval.id),
      );
      if (
        !storedApproval ||
        !storedApproval.decision ||
        storedApproval.decision.decision !== "approved" ||
        storedApproval.retrySource !== null ||
        storedApproval.decision.id !== input.release.approvalDecisionId ||
        storedApproval.requestingPrincipalId !== input.release.consumingPrincipalId ||
        storedApproval.planRevisionId !== input.release.planRevisionId ||
        storedApproval.planRevisionDigest !== input.release.planRevisionDigest
      ) return { kind: "approval_invalid" };
      if (storedApproval.consumption || this.retryApprovalConsumptions.has(
        key(storedApproval.workspaceId, storedApproval.id),
      )) return { kind: "approval_consumed" };
      if (
        input.revision.id !== storedApproval.planRevisionId ||
        input.revision.revision !== storedApproval.planRevision ||
        input.revision.definitionDigest !== storedApproval.planRevisionDigest
      ) return { kind: "stale_revision" };
      if (
        !validPublishingDeliveryAuthorizationSession({
          session: input.authorizationSession,
          workspaceId: input.release.workspaceId,
          principalId: input.release.consumingPrincipalId,
          keyId: input.release.consumingKeyId,
          capability: input.release.capability,
          authorizationContractDigest: input.release.authorizationContractDigest,
          authorizationEvidenceRef: input.release.authorizationEvidenceRef,
          channelIds: storedApproval.channelIds,
          artifactIds: storedApproval.artifactIds,
          now: input.release.createdAt,
        }) ||
        !(await this.authorizationVerifier(clone(input.authorizationSession)))
      ) return { kind: "authorization_stale" };
      if (
        !validPublishingDeliveryValidationSession({
          session: input.validationSession,
          approval: storedApproval,
          revision: input.revision,
          now: input.release.createdAt,
        }) ||
        !(await this.validationVerifier(clone(input.validationSession)))
      ) return { kind: "validation_stale" };
      if (
        input.deliveries.length !== storedApproval.targetIds.length ||
        input.firstEvents.length !== input.deliveries.length * 2 ||
        input.outboxIntents.length !== input.deliveries.length ||
        input.release.acceptedDeliveries.length !== input.deliveries.length ||
        canonicalDigest(input.release.acceptedDeliveries) !== canonicalDigest(input.deliveries.map(publishingDeliveryAcceptedRef)) ||
        input.approvalConsumption.workspaceId !== input.release.workspaceId ||
        input.approvalConsumption.approvalRequestId !== input.release.approvalRequestId ||
        input.approvalConsumption.decisionId !== input.release.approvalDecisionId ||
        input.approvalConsumption.consumingPrincipalId !== input.release.consumingPrincipalId ||
        input.approvalConsumption.consumingKeyId !== input.release.consumingKeyId ||
        input.approvalConsumption.authorizationContractDigest !== input.release.authorizationContractDigest ||
        input.approvalConsumption.authorizationEvidenceRef !== input.release.authorizationEvidenceRef ||
        canonicalDigest(input.approvalConsumption.authorizedResources) !== canonicalDigest(input.release.authorizedResources) ||
        input.approvalConsumption.consumedAt.getTime() !== input.release.createdAt.getTime() ||
        new Set(input.deliveries.map((item) => item.targetId)).size !== input.deliveries.length ||
        new Set(input.deliveries.map((item) => item.id)).size !== input.deliveries.length ||
        new Set(input.outboxIntents.map((item) => item.id)).size !== input.outboxIntents.length ||
        canonicalDigest(input.deliveries.map((item) => item.targetId)) !== canonicalDigest(storedApproval.targetIds)
      ) return { kind: "unavailable" };

      const validated = new Map<string, {
        delivery: PublishingDeliveryRecord;
        events: PublishingDeliveryEvent[];
        outbox: PublishingDeliveryOutboxIntentRecord;
      }>();
      for (const delivery of input.deliveries) {
        if (
          delivery.releaseId !== input.release.id ||
          delivery.sourceDeliveryId !== null ||
          delivery.retryId !== null ||
          delivery.state !== "scheduled" ||
          delivery.nextEventSequence !== 3 ||
          delivery.nextOutboxGeneration !== 2 ||
          delivery.effectGeneration !== 1 ||
          delivery.intentDigest !== null ||
          delivery.providerAdapterContractDigest !== null ||
          delivery.nextEffectAttempt !== 1 ||
          delivery.providerOperationRef !== null ||
          delivery.latestEffectEvidenceDigest !== null ||
          delivery.failureClass !== null ||
          delivery.failureRetryable !== null ||
          delivery.failureEffectDisposition !== null
          || delivery.effectContactStartedAt !== null
        ) return { kind: "unavailable" };
        const deliveryEvents = input.firstEvents
          .filter((event) => event.deliveryId === delivery.id)
          .sort((left, right) => left.sequence - right.sequence);
        const outbox = input.outboxIntents.find((item) => item.deliveryId === delivery.id);
        if (
          deliveryEvents.length !== 2 ||
          deliveryEvents[0]?.type !== "delivery.accepted" ||
          deliveryEvents[0].evidence.origin !== "release" ||
          deliveryEvents[0].evidence.releaseId !== input.release.id ||
          deliveryEvents[1]?.type !== "delivery.scheduled" ||
          !outbox ||
          outbox.state !== "pending" ||
          outbox.generation !== 1 ||
          outbox.dedupeKey !== publishingDeliveryOutboxDedupeKey(delivery.workspaceId, delivery.id, 1) ||
          outbox.availableAt.getTime() !== delivery.publishAt.getTime()
        ) return { kind: "unavailable" };
        validated.set(delivery.id, {
          delivery: clone(delivery),
          events: clone(deliveryEvents),
          outbox: clone(outbox),
        });
      }
      const consumption = clone(input.approvalConsumption);
      this.approvals.set(key(storedApproval.workspaceId, storedApproval.id), {
        ...clone(storedApproval),
        consumption,
      });
      this.releases.set(key(input.release.workspaceId, input.release.id), clone(input.release));
      for (const item of validated.values()) {
        this.deliveries.set(key(item.delivery.workspaceId, item.delivery.id), item.delivery);
        this.effectIdentities.set(
          key(item.delivery.workspaceId, item.delivery.id, "1"),
          {
            schema: "publishing-delivery-effect-identity/v1",
            workspaceId: item.delivery.workspaceId,
            deliveryId: item.delivery.id,
            generation: 1,
            effectKey: item.delivery.effectKey,
            intentDigest: null,
            providerAdapterContractDigest: null,
            parentEffectKey: null,
            parentGeneration: null,
            derivation: "release",
            sourceEvidenceDigest: null,
            createdAt: item.delivery.acceptedAt,
          },
        );
        this.events.set(key(item.delivery.workspaceId, item.delivery.id), item.events);
        this.outbox.set(item.outbox.id, item.outbox);
      }
      this.receipts.set(receiptKey, clone(input.receipt));
      return {
        kind: "created",
        release: clone(input.release),
        deliveries: clone(input.deliveries),
      };
    });
  }

  async getRelease(input: Parameters<PublishingDeliveryRepository["getRelease"]>[0]) {
    const release = this.releases.get(key(input.workspaceId, input.releaseId));
    return release && (!input.consumingPrincipalId || release.consumingPrincipalId === input.consumingPrincipalId)
      ? clone(release)
      : null;
  }

  async getDeliveriesByRelease(
    input: Parameters<PublishingDeliveryRepository["getDeliveriesByRelease"]>[0],
  ) {
    const release = await this.getRelease(input);
    if (!release) return [];
    return [...this.deliveries.values()]
      .filter((item) => item.workspaceId === input.workspaceId && item.releaseId === input.releaseId)
      .sort((left, right) => left.targetId.localeCompare(right.targetId))
      .map(clone);
  }

  async getDelivery(input: Parameters<PublishingDeliveryRepository["getDelivery"]>[0]) {
    const delivery = this.deliveries.get(key(input.workspaceId, input.deliveryId));
    if (!delivery) return null;
    const release = this.originRelease(delivery);
    if (
      !release ||
      (input.consumingPrincipalId && release.consumingPrincipalId !== input.consumingPrincipalId) ||
      (input.authorizedChannelIds && !input.authorizedChannelIds.includes(delivery.channelId)) ||
      (input.authorizedArtifactIds && delivery.artifactIds.some((value) => !input.authorizedArtifactIds!.includes(value)))
    ) return null;
    return clone(delivery);
  }

  async listDeliveries(input: Parameters<PublishingDeliveryRepository["listDeliveries"]>[0]) {
    return [...this.deliveries.values()]
      .filter((item) => item.workspaceId === input.workspaceId)
      .filter((item) => {
        const release = this.originRelease(item);
        return !input.filters.consumingPrincipalId || release?.consumingPrincipalId === input.filters.consumingPrincipalId;
      })
      .filter((item) => !input.filters.planRevisionId || item.planRevisionId === input.filters.planRevisionId)
      .filter((item) => !input.filters.state || item.state === input.filters.state)
      .filter((item) => !input.filters.targetId || item.targetId === input.filters.targetId)
      .filter((item) => !input.filters.authorizedChannelIds || input.filters.authorizedChannelIds.includes(item.channelId))
      .filter((item) => !input.filters.authorizedArtifactIds || item.artifactIds.every((value) => input.filters.authorizedArtifactIds!.includes(value)))
      .filter((item) => !input.before || item.acceptedAt.getTime() < input.before.acceptedAt.getTime() || (item.acceptedAt.getTime() === input.before.acceptedAt.getTime() && item.id < input.before.id))
      .sort((left, right) => right.acceptedAt.getTime() - left.acceptedAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, input.limit)
      .map(clone);
  }

  async listEvents(input: Parameters<PublishingDeliveryRepository["listEvents"]>[0]) {
    const delivery = await this.getDelivery({
      workspaceId: input.workspaceId,
      deliveryId: input.deliveryId,
      consumingPrincipalId: input.consumingPrincipalId,
      authorizedChannelIds: input.authorizedChannelIds,
      authorizedArtifactIds: input.authorizedArtifactIds,
    });
    if (!delivery) return null;
    return (this.events.get(key(input.workspaceId, input.deliveryId)) ?? [])
      .filter((event) => event.sequence > input.afterSequence)
      .slice(0, input.limit)
      .map(clone);
  }

  async getCancellation(
    input: Parameters<PublishingDeliveryRepository["getCancellation"]>[0],
  ) {
    const value = this.cancellations.get(key(input.workspaceId, input.deliveryId));
    return value && canonicalDigest(value.actor) === canonicalDigest(input.actor)
      ? clone(value)
      : null;
  }

  async cancel(input: Parameters<PublishingDeliveryRepository["cancel"]>[0]) {
    return this.lock(async () => {
      const deliveryKey = key(input.workspaceId, input.deliveryId);
      const delivery = this.deliveries.get(deliveryKey);
      if (!delivery) return { kind: "not_found" as const };
      const prior = this.cancellations.get(deliveryKey);
      if (prior) {
        return {
          kind: "replayed" as const,
          cancellation: clone(prior),
          delivery: clone(delivery),
          events: [] as PublishingDeliveryEvent[],
        };
      }
      const session = input.authorizationSession;
      const actorMatches = canonicalDigest(session.actor) === canonicalDigest(input.actor);
      const resourcesMatch =
        canonicalDigest([...session.resources.channelIds].sort()) ===
          canonicalDigest([delivery.channelId]) &&
        canonicalDigest([...session.resources.artifactIds].sort()) ===
          canonicalDigest([...delivery.artifactIds].sort());
      const humanAuthorityValid = session.actor.kind === "agent"
        ? session.humanGrants.length === 0
        : session.humanGrants.length === session.resources.channelIds.length &&
          session.resources.channelIds.every((channelId) =>
            session.humanGrants.some((grant) => grant.channelId === channelId),
          );
      if (
        session.schema !== "publishing-delivery-cancellation-authorization-session/v1" ||
        session.workspaceId !== input.workspaceId ||
        session.capability !== "publishing_deliveries.cancel@1" ||
        !actorMatches || !resourcesMatch || !humanAuthorityValid ||
        session.issuedAt > input.requestedAt || session.expiresAt <= input.requestedAt ||
        !(await this.cancellationAuthorizationVerifier(clone(session)))
      ) return { kind: "authorization_stale" as const };
      if (this.failNextMutation) {
        this.failNextMutation = false;
        return { kind: "unavailable" as const };
      }

      const leaseKey = key(input.workspaceId, input.deliveryId);
      const lease = this.leases.get(leaseKey);
      const activeLease = lease && !lease.releasedAt &&
        lease.expiresAt.getTime() > input.requestedAt.getTime();
      const transition = planPublishingDeliveryCancellation({
        delivery,
        cancellationId: input.cancellationId,
        requestedAt: input.requestedAt,
        activeLease: Boolean(activeLease),
      });
      const cancellation: PublishingDeliveryCancellationRecord = {
        schema: "publishing-delivery-cancellation-record/v1",
        id: input.cancellationId,
        workspaceId: input.workspaceId,
        deliveryId: input.deliveryId,
        actor: clone(input.actor),
        capability: "publishing_deliveries.cancel@1",
        authorizationContractDigest: session.contractDigest,
        authorizationAdmissionEvidenceRef: session.admissionEvidenceRef,
        authorizationEvidenceRef: session.evidenceRef,
        authorizationEvidenceDigest: session.evidenceDigest,
        authorizedResources: clone(session.resources),
        authorityGrants: clone(session.humanGrants),
        stateAtRequest: delivery.state,
        outcome: transition.outcome,
        externallyCompletedAtRequest: transition.externallyCompletedAtRequest,
        requestedAt: input.requestedAt,
      };
      const requestEvent: PublishingDeliveryEvent = {
        schema: "publishing-delivery-event/v1",
        id: `pde_${delivery.id}_${delivery.nextEventSequence}`,
        workspaceId: delivery.workspaceId,
        deliveryId: delivery.id,
        sequence: delivery.nextEventSequence,
        type: "delivery.cancellation_requested",
        evidence: {
          cancellationId: cancellation.id,
          actorKind: input.actor.kind,
          effectDisposition: transition.effectDisposition,
        },
        occurredAt: input.requestedAt,
      };
      const newEvents: PublishingDeliveryEvent[] = [requestEvent];
      if (transition.terminalEvent) {
        newEvents.push({
          schema: "publishing-delivery-event/v1",
          id: `pde_${delivery.id}_${delivery.nextEventSequence + 1}`,
          workspaceId: delivery.workspaceId,
          deliveryId: delivery.id,
          sequence: delivery.nextEventSequence + 1,
          ...transition.terminalEvent,
          occurredAt: input.requestedAt,
        });
      }
      const updated: PublishingDeliveryRecord = {
        ...delivery,
        desiredState: "cancel",
        state: transition.nextState,
        failureCode: transition.failureCode,
        failureClass: transition.nextState === "outcome_unknown"
          ? null
          : delivery.failureClass,
        failureRetryable: transition.nextState === "outcome_unknown"
          ? null
          : delivery.failureRetryable,
        failureEffectDisposition: transition.nextState === "outcome_unknown"
          ? "ambiguous"
          : delivery.failureEffectDisposition,
        latestEffectEvidenceDigest: transition.latestEffectEvidenceDigest,
        readinessBlockCode: transition.clearReadinessBlock
          ? null
          : delivery.readinessBlockCode,
        readinessEvidenceDigest: transition.clearReadinessBlock
          ? null
          : delivery.readinessEvidenceDigest,
        readinessBlockedAt: transition.clearReadinessBlock
          ? null
          : delivery.readinessBlockedAt,
        readinessRetryAt: transition.clearReadinessBlock
          ? null
          : delivery.readinessRetryAt,
        readinessBlockCount: transition.clearReadinessBlock
          ? 0
          : delivery.readinessBlockCount,
        nextEventSequence: delivery.nextEventSequence + newEvents.length,
        completedAt: transition.completedAt,
        updatedAt: input.requestedAt,
      };
      this.deliveries.set(deliveryKey, clone(updated));
      this.events.set(deliveryKey, [
        ...(this.events.get(deliveryKey) ?? []),
        ...clone(newEvents),
      ]);
      this.cancellations.set(deliveryKey, clone(cancellation));
      if (transition.releaseLease && lease && !lease.releasedAt) {
        this.leases.set(leaseKey, { ...lease, releasedAt: input.requestedAt });
      }
      return {
        kind: "created" as const,
        cancellation: clone(cancellation),
        delivery: clone(updated),
        events: clone(newEvents),
      };
    });
  }

  async getRetry(input: Parameters<PublishingDeliveryRepository["getRetry"]>[0]) {
    const value = this.retries.get(
      key(input.workspaceId, input.sourceDeliveryId, input.sourceEvidenceDigest),
    );
    return value && canonicalDigest(value.actor) === canonicalDigest(input.actor)
      ? clone(value)
      : null;
  }

  async getRetryMutationReceipt(
    input: Parameters<PublishingDeliveryRepository["getRetryMutationReceipt"]>[0],
  ) {
    const value = this.retryMutationReceipts.get(key(
      input.workspaceId,
      input.actorKind,
      input.actorId,
      input.capability,
      input.idempotencyKey,
    ));
    return value ? clone(value) : null;
  }

  async retryKnownFailure(
    input: Parameters<PublishingDeliveryRepository["retryKnownFailure"]>[0],
  ) {
    return this.lock(async () => {
      const receiptKey = key(
        input.mutationReceipt.workspaceId,
        input.mutationReceipt.actorKind,
        input.mutationReceipt.actorId,
        input.mutationReceipt.capability,
        input.mutationReceipt.idempotencyKey,
      );
      const priorReceipt = this.retryMutationReceipts.get(receiptKey);
      if (priorReceipt) {
        if (priorReceipt.requestFingerprint !== input.mutationReceipt.requestFingerprint) {
          return { kind: "retry_conflict" as const };
        }
        const priorRetry = this.retries.get(key(
          priorReceipt.workspaceId,
          priorReceipt.sourceDeliveryId,
          input.retry.sourceEvidenceDigest,
        ));
        const accepted = this.deliveries.get(key(
          priorReceipt.workspaceId,
          priorReceipt.deliveryId,
        ));
        const events = accepted
          ? this.events.get(key(accepted.workspaceId, accepted.id)) ?? []
          : [];
        return priorRetry && priorRetry.id === priorReceipt.retryId && accepted
          ? { kind: "replayed" as const, retry: clone(priorRetry), delivery: clone(accepted), events: clone(events) }
          : { kind: "unavailable" as const };
      }
      const retryKey = key(
        input.retry.workspaceId,
        input.retry.sourceDeliveryId,
        input.retry.sourceEvidenceDigest,
      );
      const prior = this.retries.get(retryKey);
      const sourceKey = key(input.retry.workspaceId, input.retry.sourceDeliveryId);
      const source = this.deliveries.get(sourceKey);
      if (prior) {
        return { kind: "retry_conflict" as const };
      }
      if (!source) return { kind: "not_found" as const };
      if (
        source.desiredState !== "publish" ||
        !((source.state === "failed_transient" && source.failureClass === "transient" &&
          source.failureRetryable === true) ||
          (source.state === "failed_terminal" && source.failureClass === "terminal" &&
            source.failureRetryable === false)) ||
        source.latestEffectEvidenceDigest !== input.retry.sourceEvidenceDigest ||
        source.effectKey !== input.retry.sourceEffectKey ||
        source.effectGeneration !== input.retry.sourceEffectGeneration ||
        source.intentDigest !== input.retry.sourceIntentDigest ||
        source.providerAdapterContractDigest !==
          input.retry.sourceProviderAdapterContractDigest ||
        source.failureEffectDisposition !== input.retry.sourceEffectDisposition ||
        source.failureClass !== input.retry.sourceFailureClass
      ) return { kind: "not_retryable" as const };
      const storedApproval = this.approvals.get(
        key(input.approval.workspaceId, input.approval.id),
      );
      if (
        !storedApproval || !storedApproval.decision ||
        storedApproval.decision.decision !== "approved" ||
        storedApproval.decision.id !== input.retry.approvalDecisionId ||
        storedApproval.id !== input.retry.approvalRequestId ||
        storedApproval.planRevisionId !== source.planRevisionId ||
        storedApproval.planRevisionDigest !== source.planRevisionDigest ||
        storedApproval.retrySource?.deliveryId !== source.id ||
        storedApproval.retrySource.evidenceDigest !== input.retry.sourceEvidenceDigest ||
        canonicalDigest([...storedApproval.targetIds].sort()) !==
          canonicalDigest([source.targetId]) ||
        canonicalDigest([...storedApproval.channelIds].sort()) !==
          canonicalDigest([source.channelId]) ||
        canonicalDigest([...storedApproval.artifactIds].sort()) !==
          canonicalDigest([...source.artifactIds].sort())
      ) return { kind: "approval_invalid" as const };
      if (
        storedApproval.consumption ||
        this.retryApprovalConsumptions.has(
          key(storedApproval.workspaceId, storedApproval.id),
        )
      ) return { kind: "approval_consumed" as const };
      if (
        input.revision.id !== source.planRevisionId ||
        input.revision.revision !== source.planRevision ||
        input.revision.definitionDigest !== source.planRevisionDigest
      ) return { kind: "stale_revision" as const };
      const session = input.authorizationSession;
      const humanAuthorityValid = session.actor.kind === "agent"
        ? session.humanGrants.length === 0
        : session.humanGrants.length === 1 &&
          session.humanGrants[0]?.channelId === source.channelId;
      if (
        session.schema !== "publishing-delivery-recovery-authorization-session/v1" ||
        session.capability !== "publishing_deliveries.retry@1" ||
        session.workspaceId !== source.workspaceId ||
        canonicalDigest(session.actor) !== canonicalDigest(input.retry.actor) ||
        canonicalDigest([...session.resources.channelIds].sort()) !==
          canonicalDigest([source.channelId]) ||
        canonicalDigest([...session.resources.artifactIds].sort()) !==
          canonicalDigest([...source.artifactIds].sort()) ||
        !humanAuthorityValid ||
        session.expiresAt <= input.retry.requestedAt ||
        !(await this.recoveryAuthorizationVerifier(clone(session)))
      ) return { kind: "authorization_stale" as const };
      if (
        !(await this.validationVerifier(clone(input.validationSession))) ||
        input.validationSession.expiresAt <= input.retry.requestedAt
      ) return { kind: "validation_stale" as const };
      if (this.failNextMutation) {
        this.failNextMutation = false;
        return { kind: "unavailable" as const };
      }
      if (
        canonicalDigest(input.sourceDelivery) !== canonicalDigest(source) ||
        input.delivery.id !== input.retry.deliveryId ||
        input.delivery.sourceDeliveryId !== source.id ||
        input.delivery.retryId !== input.retry.id ||
        input.delivery.releaseId !== null ||
        input.delivery.state !== "scheduled" ||
        input.delivery.effectGeneration !== 1 ||
        input.delivery.intentDigest !== source.intentDigest ||
        input.delivery.providerAdapterContractDigest !==
          source.providerAdapterContractDigest ||
        input.approvalConsumption.sourceDeliveryId !== source.id ||
        input.approvalConsumption.deliveryId !== input.delivery.id ||
        input.approvalConsumption.approvalRequestId !== input.retry.approvalRequestId ||
        input.approvalConsumption.approvalDecisionId !== input.retry.approvalDecisionId ||
        input.delivery.nextEventSequence !== 4 ||
        input.effectIdentity.deliveryId !== input.delivery.id ||
        input.effectIdentity.generation !== 1 ||
        input.effectIdentity.effectKey !== input.delivery.effectKey ||
        input.effectIdentity.intentDigest !== source.intentDigest ||
        input.effectIdentity.providerAdapterContractDigest !==
          source.providerAdapterContractDigest ||
        input.effectIdentity.derivation !== "manual_retry" ||
        input.effectIdentity.sourceEvidenceDigest !== input.retry.sourceEvidenceDigest ||
        input.events.length !== 3 ||
        input.events.some((event, index) => event.deliveryId !== input.delivery.id ||
          event.sequence !== index + 1) ||
        input.events[1]?.type !== "delivery.retry_requested" ||
        input.events[0]?.type !== "delivery.accepted" ||
        input.events[0].evidence.origin !== "retry" ||
        input.events[0].evidence.sourceDeliveryId !== source.id ||
        input.events[0].evidence.retryId !== input.retry.id ||
        input.events[1].evidence.retryId !== input.retry.id ||
        input.events[1].evidence.sourceDeliveryId !== source.id ||
        input.outboxIntent.purpose !== "publish" ||
        input.outboxIntent.deliveryId !== input.delivery.id ||
        input.outboxIntent.generation !== 1 ||
        input.outboxIntent.state !== "pending" ||
        input.mutationReceipt.workspaceId !== source.workspaceId ||
        input.mutationReceipt.capability !== "publishing_deliveries.retry@1" ||
        input.mutationReceipt.retryId !== input.retry.id ||
        input.mutationReceipt.sourceDeliveryId !== source.id ||
        input.mutationReceipt.deliveryId !== input.delivery.id
      ) return { kind: "unavailable" as const };
      const acceptedKey = key(input.delivery.workspaceId, input.delivery.id);
      if (this.deliveries.has(acceptedKey)) return { kind: "unavailable" as const };
      this.deliveries.set(acceptedKey, clone(input.delivery));
      this.events.set(acceptedKey, clone(input.events));
      this.outbox.set(input.outboxIntent.id, clone(input.outboxIntent));
      this.retries.set(retryKey, clone(input.retry));
      this.retryMutationReceipts.set(receiptKey, clone(input.mutationReceipt));
      this.retryApprovalConsumptions.set(
        key(input.approvalConsumption.workspaceId, input.approvalConsumption.approvalRequestId),
        clone(input.approvalConsumption),
      );
      this.effectIdentities.set(
        key(input.effectIdentity.workspaceId, input.effectIdentity.deliveryId,
          String(input.effectIdentity.generation)),
        clone(input.effectIdentity),
      );
      return {
        kind: "created" as const,
        retry: clone(input.retry),
        delivery: clone(input.delivery),
        events: clone(input.events),
      };
    });
  }

  async getReconciliation(
    input: Parameters<PublishingDeliveryRepository["getReconciliation"]>[0],
  ) {
    const value = this.reconciliations.get(
      key(input.workspaceId, input.deliveryId, input.sourceEvidenceDigest),
    );
    return value && canonicalDigest(value.request.actor) === canonicalDigest(input.actor)
      ? clone(value)
      : null;
  }

  async requestReconciliation(
    input: Parameters<PublishingDeliveryRepository["requestReconciliation"]>[0],
  ) {
    return this.lock(async () => {
      const requestKey = key(
        input.reconciliation.workspaceId,
        input.reconciliation.deliveryId,
        input.reconciliation.sourceEvidenceDigest,
      );
      const prior = this.reconciliations.get(requestKey);
      const deliveryKey = key(
        input.reconciliation.workspaceId,
        input.reconciliation.deliveryId,
      );
      const delivery = this.deliveries.get(deliveryKey);
      if (prior) {
        if (!delivery) return { kind: "unavailable" as const };
        if (canonicalDigest(prior.request.actor) !==
          canonicalDigest(input.reconciliation.actor)) {
          return { kind: "reconciliation_conflict" as const };
        }
        const event = (this.events.get(deliveryKey) ?? []).find(
          (item) => item.type === "delivery.reconciliation_requested" &&
            item.evidence.reconciliationId === prior.request.id,
        );
        return event
          ? {
              kind: "replayed" as const,
              reconciliation: clone(prior.request),
              delivery: clone(delivery),
              event: clone(event),
            }
          : { kind: "unavailable" as const };
      }
      if (!delivery) return { kind: "not_found" as const };
      if (
        delivery.state !== "outcome_unknown" ||
        publishingDeliveryReconciliationExhausted(delivery) ||
        delivery.failureEffectDisposition !== "ambiguous" ||
        delivery.latestEffectEvidenceDigest !== input.reconciliation.sourceEvidenceDigest ||
        delivery.effectKey !== input.reconciliation.sourceEffectKey ||
        delivery.effectGeneration !== input.reconciliation.sourceEffectGeneration ||
        delivery.intentDigest !== input.reconciliation.sourceIntentDigest ||
        delivery.providerAdapterContractDigest !==
          input.reconciliation.sourceProviderAdapterContractDigest ||
        delivery.providerOperationRef !== input.reconciliation.sourceProviderOperationRef
      ) return { kind: "not_reconcilable" as const };
      const session = input.authorizationSession;
      const humanAuthorityValid = session.actor.kind === "agent"
        ? session.humanGrants.length === 0
        : session.humanGrants.length === 1 &&
          session.humanGrants[0]?.channelId === delivery.channelId;
      if (
        session.schema !== "publishing-delivery-recovery-authorization-session/v1" ||
        session.capability !== "publishing_deliveries.reconcile@1" ||
        session.workspaceId !== delivery.workspaceId ||
        canonicalDigest(session.actor) !== canonicalDigest(input.reconciliation.actor) ||
        canonicalDigest([...session.resources.channelIds].sort()) !==
          canonicalDigest([delivery.channelId]) ||
        canonicalDigest([...session.resources.artifactIds].sort()) !==
          canonicalDigest([...delivery.artifactIds].sort()) ||
        !humanAuthorityValid ||
        session.expiresAt <= input.reconciliation.requestedAt ||
        !(await this.recoveryAuthorizationVerifier(clone(session)))
      ) return { kind: "authorization_stale" as const };
      if (
        input.event.type !== "delivery.reconciliation_requested" ||
        input.event.sequence !== delivery.nextEventSequence ||
        input.event.evidence.reconciliationId !== input.reconciliation.id ||
        input.outboxIntent.purpose !== "reconcile" ||
        input.outboxIntent.deliveryId !== delivery.id ||
        input.outboxIntent.generation !== delivery.nextOutboxGeneration ||
        input.outboxIntent.state !== "pending"
      ) return { kind: "unavailable" as const };
      if (this.failNextMutation) {
        this.failNextMutation = false;
        return { kind: "unavailable" as const };
      }
      const updated: PublishingDeliveryRecord = {
        ...delivery,
        nextEventSequence: delivery.nextEventSequence + 1,
        nextOutboxGeneration: delivery.nextOutboxGeneration + 1,
        updatedAt: input.reconciliation.requestedAt,
      };
      this.deliveries.set(deliveryKey, clone(updated));
      this.events.set(deliveryKey, [
        ...(this.events.get(deliveryKey) ?? []),
        clone(input.event),
      ]);
      this.outbox.set(input.outboxIntent.id, clone(input.outboxIntent));
      this.reconciliations.set(requestKey, {
        request: clone(input.reconciliation),
        result: null,
      });
      return {
        kind: "created" as const,
        reconciliation: clone(input.reconciliation),
        delivery: clone(updated),
        event: clone(input.event),
      };
    });
  }

  async claimOutbox(input: Parameters<PublishingDeliveryRepository["claimOutbox"]>[0]) {
    return this.lock(async () => {
      if (this.failNextMutation) { this.failNextMutation = false; return { kind: "unavailable" as const }; }
      const candidate = [...this.outbox.values()]
        .filter((item) => item.availableAt.getTime() <= input.now.getTime())
        .filter((item) => item.state === "pending" || (item.state === "claimed" && item.claimedAt && item.claimedAt.getTime() <= input.claimExpiresBefore.getTime()))
        .sort((left, right) => left.availableAt.getTime() - right.availableAt.getTime() || left.id.localeCompare(right.id))[0];
      if (!candidate) return { kind: "empty" as const };
      const claimed = { ...candidate, state: "claimed" as const, deliveryToken: input.deliveryToken, deliveryAttempts: candidate.deliveryAttempts + 1, claimedAt: input.now };
      this.outbox.set(candidate.id, clone(claimed));
      return { kind: "claimed" as const, intent: clone(claimed) };
    });
  }

  async markOutboxDelivered(input: Parameters<PublishingDeliveryRepository["markOutboxDelivered"]>[0]) {
    return this.lock(async () => {
      const intent = this.outbox.get(input.intentId);
      if (!intent || intent.state !== "claimed" || intent.deliveryToken !== input.deliveryToken) return "stale" as const;
      this.outbox.set(intent.id, { ...intent, state: "delivered", deliveryToken: null, deliveredAt: input.deliveredAt });
      return "delivered" as const;
    });
  }

  async releaseOutbox(input: Parameters<PublishingDeliveryRepository["releaseOutbox"]>[0]) {
    return this.lock(async () => {
      const intent = this.outbox.get(input.intentId);
      if (!intent || intent.state !== "claimed" || intent.deliveryToken !== input.deliveryToken) return "stale" as const;
      this.outbox.set(intent.id, { ...intent, state: "pending", availableAt: input.availableAt, deliveryToken: null, claimedAt: null });
      return "released" as const;
    });
  }

  async acquireLease(input: Parameters<PublishingDeliveryRepository["acquireLease"]>[0]) {
    return this.lock(async () => {
      const delivery = this.deliveries.get(key(input.workspaceId, input.deliveryId));
      if (!delivery) return { kind: "unavailable" as const };
      if (terminal(delivery.state)) return { kind: "terminal" as const };
      const leaseKey = key(input.workspaceId, input.deliveryId);
      const existing = this.leases.get(leaseKey);
      if (existing && !existing.releasedAt && existing.expiresAt.getTime() > input.now.getTime()) return { kind: "busy" as const };
      if (
        delivery.desiredState === "cancel" &&
        delivery.state !== "confirmation_pending"
      ) {
        if (delivery.effectContactStartedAt) {
          const cancellation = this.cancellations.get(
            key(input.workspaceId, input.deliveryId),
          );
          const evidenceDigest = canonicalDigest({
            schema: "publishing-delivery-cancellation-unknown/v1",
            cancellationId: cancellation?.id ?? null,
            effectKey: delivery.effectKey,
          });
          const event: PublishingDeliveryEvent = {
            schema: "publishing-delivery-event/v1",
            id: `pde_${delivery.id}_${delivery.nextEventSequence}`,
            workspaceId: delivery.workspaceId,
            deliveryId: delivery.id,
            sequence: delivery.nextEventSequence,
            type: "publication.outcome_unknown",
            evidence: {
              effectKey: delivery.effectKey,
              providerOperationRef: null,
              evidenceDigest,
              failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
            },
            occurredAt: input.now,
          };
          const updated: PublishingDeliveryRecord = {
            ...delivery,
            state: "outcome_unknown",
            latestEffectEvidenceDigest: evidenceDigest,
            failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
            failureClass: null,
            failureRetryable: null,
            failureEffectDisposition: "ambiguous",
            nextEventSequence: delivery.nextEventSequence + 1,
            completedAt: input.now,
            updatedAt: input.now,
          };
          this.deliveries.set(key(input.workspaceId, input.deliveryId), clone(updated));
          this.events.set(key(input.workspaceId, input.deliveryId), [
            ...(this.events.get(key(input.workspaceId, input.deliveryId)) ?? []),
            clone(event),
          ]);
          if (existing && !existing.releasedAt) {
            this.leases.set(leaseKey, { ...existing, releasedAt: input.now });
          }
        }
        return { kind: "terminal" as const };
      }
      const latestOutbox = [...this.outbox.values()]
        .filter((item) => item.workspaceId === input.workspaceId && item.deliveryId === input.deliveryId)
        .sort((left, right) => right.generation - left.generation)[0];
      if (
        !latestOutbox ||
        latestOutbox.generation !== delivery.nextOutboxGeneration - 1 ||
        (latestOutbox.state !== "claimed" && latestOutbox.state !== "delivered") ||
        latestOutbox.availableAt.getTime() > input.now.getTime()
      ) return { kind: "not_due" as const };
      const fence = (this.fences.get(leaseKey) ?? BigInt(0)) + BigInt(1);
      const lease: PublishingDeliveryExecutionLeaseRecord = {
        workspaceId: input.workspaceId,
        deliveryId: input.deliveryId,
        workerId: input.workerId,
        leaseToken: randomUUID(),
        fence,
        acquiredAt: input.now,
        expiresAt: input.expiresAt,
        renewedAt: input.now,
        releasedAt: null,
      };
      this.fences.set(leaseKey, fence);
      this.leases.set(leaseKey, clone(lease));
      return { kind: "acquired" as const, delivery: clone(delivery), lease: clone(lease) };
    });
  }

  async acquireReconciliationLease(
    input: Parameters<PublishingDeliveryRepository["acquireReconciliationLease"]>[0],
  ) {
    return this.lock(async () => {
      const deliveryKey = key(input.workspaceId, input.deliveryId);
      const delivery = this.deliveries.get(deliveryKey);
      if (!delivery) return { kind: "unavailable" as const };
      if (publishingDeliveryReconciliationExhausted(delivery)) {
        return { kind: "terminal" as const };
      }
      const projection = [...this.reconciliations.values()]
        .filter((value) =>
          value.request.workspaceId === input.workspaceId &&
          value.request.deliveryId === input.deliveryId &&
          value.result === null,
        )
        .sort((left, right) =>
          right.request.requestedAt.getTime() - left.request.requestedAt.getTime(),
        )[0];
      if (!projection) return { kind: "terminal" as const };
      if (
        delivery.state !== "outcome_unknown" ||
        delivery.latestEffectEvidenceDigest !== projection.request.sourceEvidenceDigest ||
        delivery.effectKey !== projection.request.sourceEffectKey ||
        delivery.effectGeneration !== projection.request.sourceEffectGeneration ||
        delivery.intentDigest !== projection.request.sourceIntentDigest ||
        delivery.providerAdapterContractDigest !==
          projection.request.sourceProviderAdapterContractDigest
      ) return { kind: "terminal" as const };
      const outbox = [...this.outbox.values()]
        .filter((item) =>
          item.workspaceId === input.workspaceId &&
          item.deliveryId === input.deliveryId &&
          item.purpose === "reconcile" &&
          (item.state === "claimed" || item.state === "delivered"),
        )
        .sort((left, right) => right.generation - left.generation)[0];
      if (!outbox || outbox.availableAt > input.now) {
        return { kind: "not_due" as const };
      }
      const leaseKey = key(input.workspaceId, input.deliveryId);
      const existing = this.leases.get(leaseKey);
      if (existing && !existing.releasedAt &&
        existing.expiresAt > input.now) return { kind: "busy" as const };
      const fence = (this.fences.get(leaseKey) ?? BigInt(0)) + BigInt(1);
      const lease: PublishingDeliveryExecutionLeaseRecord = {
        workspaceId: input.workspaceId,
        deliveryId: input.deliveryId,
        workerId: input.workerId,
        leaseToken: randomUUID(),
        fence,
        acquiredAt: input.now,
        expiresAt: input.expiresAt,
        renewedAt: input.now,
        releasedAt: null,
      };
      this.fences.set(leaseKey, fence);
      this.leases.set(leaseKey, clone(lease));
      return {
        kind: "acquired" as const,
        delivery: clone(delivery),
        reconciliation: clone(projection.request),
        lease: clone(lease),
      };
    });
  }

  async renewLease(input: Parameters<PublishingDeliveryRepository["renewLease"]>[0]) {
    return this.lock(async () => {
      const leaseKey = key(input.workspaceId, input.deliveryId);
      const lease = this.leases.get(leaseKey);
      if (!lease || lease.workerId !== input.workerId || lease.leaseToken !== input.leaseToken || lease.fence !== input.fence || lease.releasedAt || lease.expiresAt.getTime() <= input.now.getTime()) return null;
      const renewed = { ...lease, renewedAt: input.now, expiresAt: input.expiresAt };
      this.leases.set(leaseKey, clone(renewed));
      return clone(renewed);
    });
  }

  private activeLease(input: { workspaceId: string; deliveryId: string; workerId: string; leaseToken: string; fence: bigint; at: Date }) {
    const lease = this.leases.get(key(input.workspaceId, input.deliveryId));
    return lease && lease.workerId === input.workerId && lease.leaseToken === input.leaseToken && lease.fence === input.fence && !lease.releasedAt && lease.expiresAt.getTime() > input.at.getTime()
      ? lease
      : null;
  }

  private exactLease(input: { workspaceId: string; deliveryId: string; workerId: string; leaseToken: string; fence: bigint }) {
    const lease = this.leases.get(key(input.workspaceId, input.deliveryId));
    return lease && lease.workerId === input.workerId && lease.leaseToken === input.leaseToken && lease.fence === input.fence
      ? lease
      : null;
  }

  async prepareEffect(input: Parameters<PublishingDeliveryRepository["prepareEffect"]>[0]) {
    return this.lock(async () => {
      const deliveryKey = key(input.workspaceId, input.deliveryId);
      const delivery = this.deliveries.get(deliveryKey);
      if (!delivery || !this.activeLease({ ...input, at: input.preparedAt }) || terminal(delivery.state) || delivery.effectKey !== input.effectKey) return { kind: "stale" as const };
      if (delivery.intentDigest) {
        if (
          delivery.intentDigest !== input.intentDigest ||
          delivery.providerAdapterContractDigest !== input.providerAdapterContractDigest
        ) return { kind: "stale" as const };
        if (delivery.state === "dispatching" || delivery.state === "blocked") {
          const event = [...(this.events.get(deliveryKey) ?? [])].reverse().find((item) => item.type === "effect.prepared" && item.evidence.intentDigest === input.intentDigest);
          return event ? { kind: "replayed" as const, delivery: clone(delivery), event: clone(event) } : { kind: "unavailable" as const };
        }
        if (delivery.state === "confirmation_pending") {
          const event = [...(this.events.get(deliveryKey) ?? [])].reverse().find((item) => item.type === "effect.prepared" && item.evidence.intentDigest === input.intentDigest);
          return event ? { kind: "replayed" as const, delivery: clone(delivery), event: clone(event) } : { kind: "unavailable" as const };
        }
        if (delivery.state !== "scheduled") return { kind: "stale" as const };
      }
      const event: PublishingDeliveryEvent = { schema: "publishing-delivery-event/v1", id: `pde_${delivery.id}_${delivery.nextEventSequence}`, workspaceId: delivery.workspaceId, deliveryId: delivery.id, sequence: delivery.nextEventSequence, type: "effect.prepared", evidence: { effectKey: delivery.effectKey, effectGeneration: delivery.effectGeneration, intentDigest: input.intentDigest, providerAdapterContractDigest: input.providerAdapterContractDigest }, occurredAt: input.preparedAt };
      const updated = { ...delivery, state: "dispatching" as const, intentDigest: input.intentDigest, providerAdapterContractDigest: input.providerAdapterContractDigest, providerOperationRef: null, latestEffectEvidenceDigest: null, failureCode: null, failureClass: null, failureRetryable: null, failureEffectDisposition: null, dispatchStartedAt: input.preparedAt, effectContactStartedAt: null, completedAt: null, nextEventSequence: delivery.nextEventSequence + 1, updatedAt: input.preparedAt };
      const identityKey = key(delivery.workspaceId, delivery.id, String(delivery.effectGeneration));
      const identity = this.effectIdentities.get(identityKey);
      if (!identity) return { kind: "unavailable" as const };
      this.effectIdentities.set(identityKey, {
        ...identity,
        intentDigest: input.intentDigest,
        providerAdapterContractDigest: input.providerAdapterContractDigest,
      });
      this.deliveries.set(deliveryKey, clone(updated));
      this.events.set(deliveryKey, [...(this.events.get(deliveryKey) ?? []), clone(event)]);
      return { kind: "prepared" as const, delivery: clone(updated), event: clone(event) };
    });
  }

  async beginEffectContact(
    input: Parameters<PublishingDeliveryRepository["beginEffectContact"]>[0],
  ) {
    return this.lock(async () => {
      const deliveryKey = key(input.workspaceId, input.deliveryId);
      const delivery = this.deliveries.get(deliveryKey);
      if (!delivery) return { kind: "stale" as const };
      if (
        !this.activeLease({ ...input, at: input.startedAt }) ||
        terminal(delivery.state) ||
        delivery.effectKey !== input.effectKey ||
        delivery.intentDigest !== input.intentDigest
      ) return { kind: "stale" as const };
      const readiness = input.readinessSession;
      if (
        readiness.schema !== "publishing-delivery-execution-readiness/v1" ||
        readiness.workspaceId !== input.workspaceId ||
        readiness.deliveryId !== input.deliveryId ||
        readiness.effectKey !== input.effectKey ||
        readiness.effectGeneration !== delivery.effectGeneration ||
        readiness.intentDigest !== input.intentDigest ||
        readiness.providerAdapterContractDigest !== input.providerAdapterContractDigest ||
        readiness.mode !== "launch" ||
        readiness.evaluatedAt > input.startedAt ||
        readiness.expiresAt <= input.startedAt
      ) return { kind: "blocked" as const, failureCode: "VALIDATION_STALE" as const, evidenceDigest: readiness.evidenceDigest };
      if (delivery.effectContactStartedAt) {
        if (
          delivery.state !== "dispatching" &&
          !(delivery.state === "confirmation_pending" && delivery.providerOperationRef)
        ) return { kind: "stale" as const };
        const event = [...(this.events.get(deliveryKey) ?? [])].reverse().find(
          (item) => item.type === "effect.contact_started" &&
            item.evidence.intentDigest === input.intentDigest,
        );
        return event
          ? { kind: "replayed" as const, delivery: clone(delivery), event: clone(event) }
          : { kind: "unavailable" as const };
      }
      if (delivery.desiredState === "cancel" || delivery.state === "cancelled") {
        return { kind: "cancelled" as const };
      }
      if (delivery.state !== "dispatching" && delivery.state !== "blocked") {
        return { kind: "stale" as const };
      }
      const resumedEvent: PublishingDeliveryEvent | null =
        delivery.state === "blocked" && delivery.readinessBlockCode &&
          delivery.readinessEvidenceDigest
          ? {
              schema: "publishing-delivery-event/v1",
              id: `pde_${delivery.id}_${delivery.nextEventSequence}`,
              workspaceId: delivery.workspaceId,
              deliveryId: delivery.id,
              sequence: delivery.nextEventSequence,
              type: "delivery.resumed",
              evidence: {
                priorFailureCode: delivery.readinessBlockCode,
                priorEvidenceDigest: delivery.readinessEvidenceDigest,
                readinessEvidenceDigest: readiness.evidenceDigest,
              },
              occurredAt: input.startedAt,
            }
          : null;
      const contactSequence = delivery.nextEventSequence + (resumedEvent ? 1 : 0);
      const event: PublishingDeliveryEvent = {
        schema: "publishing-delivery-event/v1",
        id: `pde_${delivery.id}_${contactSequence}`,
        workspaceId: delivery.workspaceId,
        deliveryId: delivery.id,
        sequence: contactSequence,
        type: "effect.contact_started",
        evidence: { effectKey: delivery.effectKey, effectGeneration: delivery.effectGeneration, intentDigest: input.intentDigest, providerAdapterContractDigest: input.providerAdapterContractDigest, readinessEvidenceDigest: readiness.evidenceDigest },
        occurredAt: input.startedAt,
      };
      const updated: PublishingDeliveryRecord = {
        ...delivery,
        state: "dispatching",
        readinessBlockCode: null,
        readinessEvidenceDigest: null,
        readinessBlockedAt: null,
        readinessRetryAt: null,
        readinessBlockCount: 0,
        effectContactStartedAt: input.startedAt,
        nextEventSequence: contactSequence + 1,
        updatedAt: input.startedAt,
      };
      this.deliveries.set(deliveryKey, clone(updated));
      this.events.set(deliveryKey, [
        ...(this.events.get(deliveryKey) ?? []),
        ...(resumedEvent ? [clone(resumedEvent)] : []),
        clone(event),
      ]);
      return { kind: "started" as const, delivery: clone(updated), event: clone(event) };
    });
  }

  async blockForReadiness(
    input: Parameters<PublishingDeliveryRepository["blockForReadiness"]>[0],
  ) {
    return this.lock(async () => {
      const deliveryKey = key(input.workspaceId, input.deliveryId);
      const delivery = this.deliveries.get(deliveryKey);
      const exactLease = this.exactLease(input);
      if (
        !delivery || !exactLease || delivery.effectKey !== input.effectKey ||
        delivery.effectContactStartedAt !== null ||
        delivery.providerOperationRef !== null
      ) return { kind: "stale" as const };
      if (
        exactLease.releasedAt !== null && delivery.state === "blocked" &&
        delivery.readinessBlockCode === input.failureCode &&
        delivery.readinessEvidenceDigest === input.evidenceDigest &&
        delivery.readinessBlockedAt?.getTime() === input.blockedAt.getTime() &&
        delivery.readinessRetryAt?.getTime() === input.retryAt.getTime()
      ) {
        const replay = [...(this.events.get(deliveryKey) ?? [])].reverse().find(
          (item) => item.type === "delivery.blocked" &&
            item.occurredAt.getTime() === input.blockedAt.getTime(),
        );
        return replay
          ? { kind: "replayed" as const, delivery: clone(delivery), event: clone(replay) }
          : { kind: "unavailable" as const };
      }
      const lease = this.activeLease({ ...input, at: input.blockedAt });
      if (!lease || terminal(delivery.state) ||
        (delivery.state !== "dispatching" && delivery.state !== "blocked")) {
        return { kind: "stale" as const };
      }
      const outbox = input.outboxIntent;
      if (
        outbox.workspaceId !== delivery.workspaceId ||
        outbox.deliveryId !== delivery.id || outbox.purpose !== "publish" ||
        outbox.state !== "pending" ||
        outbox.generation !== delivery.nextOutboxGeneration ||
        outbox.dedupeKey !== publishingDeliveryOutboxDedupeKey(
          delivery.workspaceId,
          delivery.id,
          delivery.nextOutboxGeneration,
        ) || outbox.availableAt.getTime() !== input.retryAt.getTime() ||
        this.outbox.has(outbox.id)
      ) return { kind: "unavailable" as const };
      const blockCount = delivery.readinessBlockCount + 1;
      const event: PublishingDeliveryEvent = {
        schema: "publishing-delivery-event/v1",
        id: `pde_${delivery.id}_${delivery.nextEventSequence}`,
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
        occurredAt: input.blockedAt,
      };
      const updated: PublishingDeliveryRecord = {
        ...delivery,
        state: "blocked",
        readinessBlockCode: input.failureCode,
        readinessEvidenceDigest: input.evidenceDigest,
        readinessBlockedAt: input.blockedAt,
        readinessRetryAt: input.retryAt,
        readinessBlockCount: blockCount,
        nextEventSequence: delivery.nextEventSequence + 1,
        nextOutboxGeneration: delivery.nextOutboxGeneration + 1,
        updatedAt: input.blockedAt,
      };
      this.deliveries.set(deliveryKey, clone(updated));
      this.events.set(deliveryKey, [
        ...(this.events.get(deliveryKey) ?? []),
        clone(event),
      ]);
      this.outbox.set(outbox.id, clone(outbox));
      this.leases.set(key(input.workspaceId, input.deliveryId), {
        ...lease,
        releasedAt: input.blockedAt,
      });
      return { kind: "blocked" as const, delivery: clone(updated), event: clone(event) };
    });
  }

  async failBeforeEffect(input: Parameters<PublishingDeliveryRepository["failBeforeEffect"]>[0]) {
    return this.lock(async () => {
      const deliveryKey = key(input.workspaceId, input.deliveryId);
      const delivery = this.deliveries.get(deliveryKey);
      const exactLease = this.exactLease(input);
      if (
        !delivery || !exactLease || delivery.effectKey !== input.effectKey ||
        delivery.effectContactStartedAt !== null ||
        delivery.providerOperationRef !== null
      ) return { kind: "stale" as const };
      if (exactLease.releasedAt !== null &&
        (delivery.state === "failed_transient" || delivery.state === "failed_terminal") &&
        delivery.latestEffectEvidenceDigest === input.evidenceDigest &&
        delivery.failureCode === input.failureCode &&
        delivery.failureClass === input.failureClass &&
        delivery.failureRetryable === input.retryable &&
        delivery.failureEffectDisposition === input.effectDisposition) {
        const replay = [...(this.events.get(deliveryKey) ?? [])].reverse().find((item) => item.type === "effect.not_created" && item.evidence.evidenceDigest === input.evidenceDigest);
        return replay ? { kind: "replayed" as const, delivery: clone(delivery), event: clone(replay) } : { kind: "unavailable" as const };
      }
      const lease = this.activeLease({ ...input, at: input.occurredAt });
      if (!lease) return { kind: "stale" as const };
      if (terminal(delivery.state)) return { kind: "stale" as const };
      const event: PublishingDeliveryEvent = {
        schema: "publishing-delivery-event/v1",
        id: `pde_${delivery.id}_${delivery.nextEventSequence}`,
        workspaceId: delivery.workspaceId,
        deliveryId: delivery.id,
        sequence: delivery.nextEventSequence,
        type: "effect.not_created",
        evidence: {
          effectKey: delivery.effectKey,
          effectGeneration: delivery.effectGeneration,
          evidenceDigest: input.evidenceDigest,
          failureCode: input.failureCode,
          failureClass: input.failureClass,
          retryable: input.retryable,
          effectDisposition: "not_created",
        },
        occurredAt: input.occurredAt,
      };
      const updated: PublishingDeliveryRecord = {
        ...delivery,
        state: input.failureClass === "transient"
          ? "failed_transient"
          : "failed_terminal",
        intentDigest: delivery.intentDigest,
        providerOperationRef: null,
        latestEffectEvidenceDigest: input.evidenceDigest,
        failureCode: input.failureCode,
        failureClass: input.failureClass,
        failureRetryable: input.retryable,
        failureEffectDisposition: "not_created",
        nextEffectAttempt: Math.min(9, delivery.nextEffectAttempt + 1),
        nextEventSequence: delivery.nextEventSequence + 1,
        completedAt: input.occurredAt,
        updatedAt: input.occurredAt,
      };
      this.deliveries.set(deliveryKey, clone(updated));
      this.events.set(deliveryKey, [...(this.events.get(deliveryKey) ?? []), clone(event)]);
      this.leases.set(key(input.workspaceId, input.deliveryId), { ...lease, releasedAt: input.occurredAt });
      return { kind: "settled" as const, delivery: clone(updated), event: clone(event) };
    });
  }

  async settleEffect(input: Parameters<PublishingDeliveryRepository["settleEffect"]>[0]) {
    return this.lock(async () => {
      const deliveryKey = key(input.workspaceId, input.deliveryId);
      const delivery = this.deliveries.get(deliveryKey);
      const exactLease = this.exactLease(input);
      if (!delivery || !exactLease || delivery.effectKey !== input.effectKey || delivery.intentDigest !== input.intentDigest) return { kind: "stale" as const };
      const normalized = normalizePublishingDeliverySettlement({
        desiredState: delivery.desiredState,
        outcome: input.outcome,
        retryOutboxIntent: input.retryOutboxIntent,
      });
      const { outcome } = normalized;
      const state = outcome.kind === "succeeded"
        ? "succeeded" as const
        : outcome.kind === "failed"
          ? outcome.failureClass === "transient"
            ? "failed_transient" as const
            : "failed_terminal" as const
          : outcome.kind === "outcome_unknown"
            ? "outcome_unknown" as const
            : outcome.kind === "confirmation_pending"
              ? "confirmation_pending" as const
              : "scheduled" as const;
      if (exactLease.releasedAt !== null && delivery.latestEffectEvidenceDigest === outcome.evidenceDigest && delivery.state === state) {
        const replay = (this.events.get(deliveryKey) ?? []).at(-1);
        return replay ? { kind: "replayed" as const, delivery: clone(delivery), event: clone(replay) } : { kind: "unavailable" as const };
      }
      const lease = this.activeLease({ ...input, at: input.occurredAt });
      if (!lease) return { kind: "stale" as const };
      if (terminal(delivery.state)) return { kind: "stale" as const };
      const followUpRequired = outcome.kind === "retry_scheduled" || outcome.kind === "confirmation_pending";
      const followUp = normalized.retryOutboxIntent;
      if (followUpRequired !== Boolean(followUp)) return { kind: "unavailable" as const };
      if (followUp && (followUp.workspaceId !== delivery.workspaceId || followUp.deliveryId !== delivery.id || followUp.state !== "pending" || followUp.generation !== delivery.nextOutboxGeneration || followUp.dedupeKey !== publishingDeliveryOutboxDedupeKey(delivery.workspaceId, delivery.id, delivery.nextOutboxGeneration) || followUp.availableAt.getTime() !== (outcome.kind === "retry_scheduled" ? outcome.retryAt.getTime() : outcome.kind === "confirmation_pending" ? outcome.pollAt.getTime() : -1))) return { kind: "unavailable" as const };
      const common = { schema: "publishing-delivery-event/v1" as const, id: `pde_${delivery.id}_${delivery.nextEventSequence}`, workspaceId: delivery.workspaceId, deliveryId: delivery.id, sequence: delivery.nextEventSequence, occurredAt: input.occurredAt };
      const event: PublishingDeliveryEvent = outcome.kind === "retry_scheduled"
        ? { ...common, type: "publication.retry_scheduled", evidence: { effectKey: delivery.effectKey, evidenceDigest: outcome.evidenceDigest, failureCode: outcome.failureCode, retryAt: outcome.retryAt.toISOString() } }
        : outcome.kind === "confirmation_pending"
          ? { ...common, type: "publication.confirmation_pending", evidence: { effectKey: delivery.effectKey, providerOperationRef: outcome.providerOperationRef, evidenceDigest: outcome.evidenceDigest, pollAt: outcome.pollAt.toISOString() } }
          : outcome.kind === "outcome_unknown"
            ? { ...common, type: "publication.outcome_unknown", evidence: { effectKey: delivery.effectKey, providerOperationRef: outcome.providerOperationRef, evidenceDigest: outcome.evidenceDigest, failureCode: outcome.failureCode } }
            : outcome.kind === "succeeded"
              ? { ...common, type: "publication.succeeded", evidence: { effectKey: delivery.effectKey, providerOperationRef: outcome.providerOperationRef, evidenceDigest: outcome.evidenceDigest, failureCode: null } }
              : outcome.failureClass === "transient"
                ? { ...common, type: "publication.failed_transient", evidence: { effectKey: delivery.effectKey, effectGeneration: delivery.effectGeneration, providerOperationRef: outcome.providerOperationRef, evidenceDigest: outcome.evidenceDigest, failureCode: outcome.failureCode, failureClass: "transient", retryable: true, effectDisposition: outcome.effectDisposition } }
                : { ...common, type: "publication.failed_terminal", evidence: { effectKey: delivery.effectKey, effectGeneration: delivery.effectGeneration, providerOperationRef: outcome.providerOperationRef, evidenceDigest: outcome.evidenceDigest, failureCode: outcome.failureCode, failureClass: "terminal", retryable: false, effectDisposition: outcome.effectDisposition } };
      const updated: PublishingDeliveryRecord = {
        ...delivery,
        state,
        providerOperationRef: outcome.kind === "confirmation_pending" || outcome.kind === "succeeded" || outcome.kind === "failed" || outcome.kind === "outcome_unknown" ? outcome.providerOperationRef : null,
        latestEffectEvidenceDigest: outcome.evidenceDigest,
        failureCode: outcome.kind === "failed" || outcome.kind === "outcome_unknown" || outcome.kind === "retry_scheduled" ? outcome.failureCode : null,
        failureClass: outcome.kind === "failed" ? outcome.failureClass : null,
        failureRetryable: outcome.kind === "failed" ? outcome.retryable : null,
        failureEffectDisposition: outcome.kind === "failed"
          ? outcome.effectDisposition
          : outcome.kind === "outcome_unknown" ? "ambiguous" : null,
        nextEffectAttempt: outcome.kind === "confirmation_pending" ||
          outcome.kind === "outcome_unknown"
          ? Math.min(9, delivery.nextEffectAttempt + 1)
          : delivery.nextEffectAttempt,
        nextEventSequence: delivery.nextEventSequence + 1,
        nextOutboxGeneration: delivery.nextOutboxGeneration + (followUp ? 1 : 0),
        completedAt: terminal(state) ? input.occurredAt : null,
        updatedAt: input.occurredAt,
      };
      this.deliveries.set(deliveryKey, clone(updated));
      this.events.set(deliveryKey, [...(this.events.get(deliveryKey) ?? []), clone(event)]);
      this.leases.set(key(input.workspaceId, input.deliveryId), { ...lease, releasedAt: input.occurredAt });
      if (followUp) this.outbox.set(followUp.id, clone(followUp));
      return { kind: "settled" as const, delivery: clone(updated), event: clone(event) };
    });
  }

  async settleReconciliation(
    input: Parameters<PublishingDeliveryRepository["settleReconciliation"]>[0],
  ) {
    return this.lock(async () => {
      const deliveryKey = key(input.workspaceId, input.deliveryId);
      const delivery = this.deliveries.get(deliveryKey);
      const projectionKey = [...this.reconciliations.entries()].find(([, value]) =>
        value.request.id === input.reconciliationId &&
        value.request.workspaceId === input.workspaceId &&
        value.request.deliveryId === input.deliveryId,
      )?.[0];
      const projection = projectionKey
        ? this.reconciliations.get(projectionKey)
        : null;
      if (!delivery || !projection || !projectionKey) {
        return { kind: "stale" as const };
      }
      if (projection.result) {
        const normalizedExhaustionReplay =
          projection.result.resolution.kind === "operator_required" &&
          projection.result.resolution.failureCode ===
            "RECONCILIATION_ATTEMPTS_EXHAUSTED" &&
          input.resolution.kind === "still_unknown" &&
          projection.result.resolution.providerOperationRef ===
            input.resolution.providerOperationRef;
        if (!normalizedExhaustionReplay &&
          projection.result.resolution.evidenceDigest !==
            input.resolution.evidenceDigest) return { kind: "stale" as const };
        const retainedEvent = (this.events.get(deliveryKey) ?? []).find(
          (item) => item.type === "delivery.reconciled" &&
            item.evidence.reconciliationId === input.reconciliationId &&
            item.evidence.evidenceDigest ===
              projection.result!.resolution.evidenceDigest,
        );
        return retainedEvent
          ? {
              kind: "replayed" as const,
              delivery: clone(delivery),
              reconciliation: clone(projection.request),
              result: clone(projection.result),
              event: clone(retainedEvent),
            }
          : { kind: "unavailable" as const };
      }
      const lease = this.activeLease({ ...input, at: input.occurredAt });
      if (
        !lease ||
        delivery.state !== "outcome_unknown" ||
        delivery.latestEffectEvidenceDigest !== input.sourceEvidenceDigest ||
        delivery.effectKey !== input.effectKey ||
        delivery.effectGeneration !== input.effectGeneration ||
        delivery.intentDigest !== input.intentDigest ||
        delivery.providerAdapterContractDigest !== input.providerAdapterContractDigest ||
        projection.request.sourceEvidenceDigest !== input.sourceEvidenceDigest ||
        projection.request.sourceEffectKey !== input.effectKey ||
        input.event.type !== "delivery.reconciled" ||
        input.event.sequence !== delivery.nextEventSequence ||
        input.event.evidence.reconciliationId !== input.reconciliationId ||
        input.event.evidence.sourceEvidenceDigest !== input.sourceEvidenceDigest ||
        input.event.evidence.evidenceDigest !== input.resolution.evidenceDigest
      ) return { kind: "stale" as const };
      if (delivery.nextEffectAttempt > 8) return { kind: "stale" as const };
      const reconciliationExhausted =
        delivery.nextEffectAttempt >= 8 &&
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
            effectAttempt: delivery.nextEffectAttempt,
          })
        : null;
      const resolution = reconciliationExhausted
        ? {
            kind: "operator_required" as const,
            providerOperationRef: input.resolution.providerOperationRef,
            evidenceDigest: exhaustedEvidenceDigest!,
            failureCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
          }
        : input.resolution;
      const event: PublishingDeliveryEvent = reconciliationExhausted &&
          input.event.type === "delivery.reconciled"
        ? {
            ...input.event,
            evidence: {
              ...input.event.evidence,
              evidenceDigest: exhaustedEvidenceDigest!,
              resolution: "operator_required",
              providerOperationRef: input.resolution.providerOperationRef,
              failureCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
              retryable: null,
            },
          }
        : input.event;
      const result: PublishingDeliveryReconciliationResultRecord = {
        schema: "publishing-delivery-reconciliation-result/v1",
        id: `pdrr_${input.reconciliationId}`,
        workspaceId: input.workspaceId,
        deliveryId: input.deliveryId,
        reconciliationId: input.reconciliationId,
        sourceEvidenceDigest: input.sourceEvidenceDigest,
        effectKey: input.effectKey,
        effectGeneration: input.effectGeneration,
        resolution: clone(resolution),
        completedAt: input.occurredAt,
      };
      const nextState = resolution.kind === "succeeded"
        ? "succeeded" as const
        : resolution.kind === "failed_known"
          ? resolution.failureClass === "transient"
            ? "failed_transient" as const
            : "failed_terminal" as const
          : "outcome_unknown" as const;
      const updated: PublishingDeliveryRecord = {
        ...delivery,
        state: nextState,
        providerOperationRef: resolution.providerOperationRef,
        latestEffectEvidenceDigest: resolution.evidenceDigest,
        failureCode: resolution.kind === "succeeded"
          ? null
          : resolution.failureCode,
        failureClass: resolution.kind === "failed_known"
          ? resolution.failureClass
          : null,
        failureRetryable: resolution.kind === "failed_known"
          ? resolution.retryable
          : null,
        failureEffectDisposition: resolution.kind === "failed_known"
          ? resolution.effectDisposition
          : resolution.kind === "succeeded" ? null : "ambiguous",
        nextEffectAttempt: Math.min(9, delivery.nextEffectAttempt + 1),
        nextEventSequence: delivery.nextEventSequence + 1,
        completedAt: input.occurredAt,
        updatedAt: input.occurredAt,
      };
      this.deliveries.set(deliveryKey, clone(updated));
      this.events.set(deliveryKey, [
        ...(this.events.get(deliveryKey) ?? []),
        clone(event),
      ]);
      this.leases.set(key(input.workspaceId, input.deliveryId), {
        ...lease,
        releasedAt: input.occurredAt,
      });
      this.reconciliations.set(projectionKey, {
        request: clone(projection.request),
        result: clone(result),
      });
      return {
        kind: "settled" as const,
        delivery: clone(updated),
        reconciliation: clone(projection.request),
        result: clone(result),
        event: clone(event),
      };
    });
  }
}
