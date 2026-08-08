import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  PublishingApprovalRequestRecord,
  PublishingApprovalValidationSession,
} from "../publishing-approvals/types";
import type {
  PublishingDeliveryAuthorizationSession,
  PublishingDeliveryEvent,
  PublishingDeliveryExecutionLeaseRecord,
  PublishingDeliveryMutationReceiptRecord,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryReleaseRecord,
  PublishingDeliveryReleaseResult,
  PublishingDeliveryRepository,
} from "./types";
import { publishingDeliveryOutboxDedupeKey } from "./keys";
import {
  publishingDeliveryAcceptedRef,
  validPublishingDeliveryAuthorizationSession,
  validPublishingDeliveryValidationSession,
} from "./validation";

function key(...values: string[]): string {
  return values.join("\u0000");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function terminal(state: PublishingDeliveryRecord["state"]): boolean {
  return state === "succeeded" || state === "failed" || state === "outcome_unknown";
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
  readonly leases = new Map<string, PublishingDeliveryExecutionLeaseRecord>();
  private readonly fences = new Map<string, bigint>();
  private authorizationVerifier: (
    session: PublishingDeliveryAuthorizationSession,
  ) => Promise<boolean> = async () => false;
  private validationVerifier: (
    session: PublishingApprovalValidationSession,
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
        storedApproval.decision.id !== input.release.approvalDecisionId ||
        storedApproval.requestingPrincipalId !== input.release.consumingPrincipalId ||
        storedApproval.planRevisionId !== input.release.planRevisionId ||
        storedApproval.planRevisionDigest !== input.release.planRevisionDigest
      ) return { kind: "approval_invalid" };
      if (storedApproval.consumption) return { kind: "approval_consumed" };
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
          delivery.state !== "scheduled" ||
          delivery.nextEventSequence !== 3 ||
          delivery.nextOutboxGeneration !== 2 ||
          delivery.intentDigest !== null ||
          delivery.providerOperationRef !== null ||
          delivery.latestEffectEvidenceDigest !== null
        ) return { kind: "unavailable" };
        const deliveryEvents = input.firstEvents
          .filter((event) => event.deliveryId === delivery.id)
          .sort((left, right) => left.sequence - right.sequence);
        const outbox = input.outboxIntents.find((item) => item.deliveryId === delivery.id);
        if (
          deliveryEvents.length !== 2 ||
          deliveryEvents[0]?.type !== "delivery.accepted" ||
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
    const release = this.releases.get(key(delivery.workspaceId, delivery.releaseId));
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
        const release = this.releases.get(key(item.workspaceId, item.releaseId));
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
      const latestOutbox = [...this.outbox.values()]
        .filter((item) => item.workspaceId === input.workspaceId && item.deliveryId === input.deliveryId)
        .sort((left, right) => right.generation - left.generation)[0];
      if (
        !latestOutbox ||
        latestOutbox.generation !== delivery.nextOutboxGeneration - 1 ||
        (latestOutbox.state !== "claimed" && latestOutbox.state !== "delivered") ||
        latestOutbox.availableAt.getTime() > input.now.getTime()
      ) return { kind: "not_due" as const };
      const leaseKey = key(input.workspaceId, input.deliveryId);
      const existing = this.leases.get(leaseKey);
      if (existing && !existing.releasedAt && existing.expiresAt.getTime() > input.now.getTime()) return { kind: "busy" as const };
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
        if (delivery.intentDigest !== input.intentDigest) return { kind: "stale" as const };
        if (delivery.state === "dispatching") {
          const event = [...(this.events.get(deliveryKey) ?? [])].reverse().find((item) => item.type === "effect.prepared" && item.evidence.intentDigest === input.intentDigest);
          return event ? { kind: "replayed" as const, delivery: clone(delivery), event: clone(event) } : { kind: "unavailable" as const };
        }
        if (delivery.state === "confirmation_pending") {
          const event = [...(this.events.get(deliveryKey) ?? [])].reverse().find((item) => item.type === "effect.prepared" && item.evidence.intentDigest === input.intentDigest);
          return event ? { kind: "replayed" as const, delivery: clone(delivery), event: clone(event) } : { kind: "unavailable" as const };
        }
        if (delivery.state !== "scheduled") return { kind: "stale" as const };
      }
      const event: PublishingDeliveryEvent = { schema: "publishing-delivery-event/v1", id: `pde_${delivery.id}_${delivery.nextEventSequence}`, workspaceId: delivery.workspaceId, deliveryId: delivery.id, sequence: delivery.nextEventSequence, type: "effect.prepared", evidence: { effectKey: delivery.effectKey, intentDigest: input.intentDigest }, occurredAt: input.preparedAt };
      const updated = { ...delivery, state: "dispatching" as const, intentDigest: input.intentDigest, providerOperationRef: null, latestEffectEvidenceDigest: null, failureCode: null, dispatchStartedAt: input.preparedAt, completedAt: null, nextEventSequence: delivery.nextEventSequence + 1, updatedAt: input.preparedAt };
      this.deliveries.set(deliveryKey, clone(updated));
      this.events.set(deliveryKey, [...(this.events.get(deliveryKey) ?? []), clone(event)]);
      return { kind: "prepared" as const, delivery: clone(updated), event: clone(event) };
    });
  }

  async failBeforeEffect(input: Parameters<PublishingDeliveryRepository["failBeforeEffect"]>[0]) {
    return this.lock(async () => {
      const deliveryKey = key(input.workspaceId, input.deliveryId);
      const delivery = this.deliveries.get(deliveryKey);
      const exactLease = this.exactLease(input);
      if (!delivery || !exactLease || delivery.effectKey !== input.effectKey || delivery.intentDigest !== null) return { kind: "stale" as const };
      if (exactLease.releasedAt !== null && delivery.state === "failed" && delivery.latestEffectEvidenceDigest === input.evidenceDigest && delivery.failureCode === input.failureCode) {
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
          evidenceDigest: input.evidenceDigest,
          failureCode: input.failureCode,
        },
        occurredAt: input.occurredAt,
      };
      const updated: PublishingDeliveryRecord = {
        ...delivery,
        state: "failed",
        intentDigest: null,
        providerOperationRef: null,
        latestEffectEvidenceDigest: input.evidenceDigest,
        failureCode: input.failureCode,
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
      const outcome = input.outcome;
      const state = outcome.kind === "succeeded" ? "succeeded" as const : outcome.kind === "failed" ? "failed" as const : outcome.kind === "outcome_unknown" ? "outcome_unknown" as const : outcome.kind === "confirmation_pending" ? "confirmation_pending" as const : "scheduled" as const;
      if (exactLease.releasedAt !== null && delivery.latestEffectEvidenceDigest === outcome.evidenceDigest && delivery.state === state) {
        const replay = (this.events.get(deliveryKey) ?? []).at(-1);
        return replay ? { kind: "replayed" as const, delivery: clone(delivery), event: clone(replay) } : { kind: "unavailable" as const };
      }
      const lease = this.activeLease({ ...input, at: input.occurredAt });
      if (!lease) return { kind: "stale" as const };
      if (terminal(delivery.state)) return { kind: "stale" as const };
      const followUpRequired = outcome.kind === "retry_scheduled" || outcome.kind === "confirmation_pending";
      const followUp = input.retryOutboxIntent;
      if (followUpRequired !== Boolean(followUp)) return { kind: "unavailable" as const };
      if (followUp && (followUp.workspaceId !== delivery.workspaceId || followUp.deliveryId !== delivery.id || followUp.state !== "pending" || followUp.generation !== delivery.nextOutboxGeneration || followUp.dedupeKey !== publishingDeliveryOutboxDedupeKey(delivery.workspaceId, delivery.id, delivery.nextOutboxGeneration) || followUp.availableAt.getTime() !== (outcome.kind === "retry_scheduled" ? outcome.retryAt.getTime() : outcome.kind === "confirmation_pending" ? outcome.pollAt.getTime() : -1))) return { kind: "unavailable" as const };
      const common = { schema: "publishing-delivery-event/v1" as const, id: `pde_${delivery.id}_${delivery.nextEventSequence}`, workspaceId: delivery.workspaceId, deliveryId: delivery.id, sequence: delivery.nextEventSequence, occurredAt: input.occurredAt };
      const event: PublishingDeliveryEvent = outcome.kind === "retry_scheduled"
        ? { ...common, type: "publication.retry_scheduled", evidence: { effectKey: delivery.effectKey, evidenceDigest: outcome.evidenceDigest, failureCode: outcome.failureCode, retryAt: outcome.retryAt.toISOString() } }
        : outcome.kind === "confirmation_pending"
          ? { ...common, type: "publication.confirmation_pending", evidence: { effectKey: delivery.effectKey, providerOperationRef: outcome.providerOperationRef, evidenceDigest: outcome.evidenceDigest, pollAt: outcome.pollAt.toISOString() } }
          : outcome.kind === "outcome_unknown"
            ? { ...common, type: "publication.outcome_unknown", evidence: { effectKey: delivery.effectKey, providerOperationRef: null, evidenceDigest: outcome.evidenceDigest, failureCode: outcome.failureCode } }
            : outcome.kind === "succeeded"
              ? { ...common, type: "publication.succeeded", evidence: { effectKey: delivery.effectKey, providerOperationRef: outcome.providerOperationRef, evidenceDigest: outcome.evidenceDigest, failureCode: null } }
              : { ...common, type: "publication.failed", evidence: { effectKey: delivery.effectKey, providerOperationRef: outcome.providerOperationRef, evidenceDigest: outcome.evidenceDigest, failureCode: outcome.failureCode } };
      const updated: PublishingDeliveryRecord = {
        ...delivery,
        state,
        providerOperationRef: outcome.kind === "confirmation_pending" || outcome.kind === "succeeded" || outcome.kind === "failed" ? outcome.providerOperationRef : null,
        latestEffectEvidenceDigest: outcome.evidenceDigest,
        failureCode: outcome.kind === "failed" || outcome.kind === "outcome_unknown" || outcome.kind === "retry_scheduled" ? outcome.failureCode : null,
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
}
