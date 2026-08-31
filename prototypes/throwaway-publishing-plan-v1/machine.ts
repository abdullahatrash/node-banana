import {
  type Approval,
  type ApprovalAction,
  type Delivery,
  type DeliveryStatus,
  type PublishValidation,
  type PublishingPlan,
  type PublishingPlanRevision,
  type PublishingTarget,
  digestPlan,
  planRef,
  publishingPlanSchema,
} from "./contracts";

interface ChannelRecord {
  workspaceId: string;
  platform: "youtube" | "reddit";
  enabled: boolean;
}

const defaultChannelRegistry: Record<string, ChannelRecord> = {
  channel_youtube_main: {
    workspaceId: "ws_acme",
    platform: "youtube",
    enabled: true,
  },
  channel_reddit_product: {
    workspaceId: "ws_acme",
    platform: "reddit",
    enabled: true,
  },
};

const deliveryTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
  scheduled: ["queued", "blocked", "cancelled"],
  queued: ["publishing", "blocked", "cancelled"],
  blocked: ["queued", "cancelled"],
  retry_scheduled: ["queued", "cancelled"],
  publishing: ["published", "failed"],
  published: [],
  failed: [],
  cancelled: [],
};

function sameSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function targetAction(target: PublishingTarget): ApprovalAction {
  return target.timing.mode === "at" ? "schedule" : "publish-now";
}

function validateTarget(
  channels: Record<string, ChannelRecord>,
  workspaceId: string,
  target: PublishingTarget,
  now: Date,
  trigger: PublishValidation["trigger"],
): string[] {
  const reasons: string[] = [];
  const channel = channels[target.channelRef];

  if (!channel) {
    reasons.push("Channel does not exist.");
    return reasons;
  }
  if (channel.workspaceId !== workspaceId) {
    reasons.push("Channel belongs to another Workspace.");
  }
  if (!channel.enabled) {
    reasons.push("Channel is disabled.");
  }
  if (
    trigger !== "pre-publish" &&
    target.timing.mode === "at" &&
    new Date(target.timing.publishAt).getTime() <= now.getTime()
  ) {
    reasons.push("Scheduled time must be in the future.");
  }
  if (channel.platform === "youtube") {
    if (typeof target.publishingSettings.title !== "string") {
      reasons.push("YouTube title is required.");
    }
    if (target.content.artifacts.every((artifact) => artifact.kind !== "video")) {
      reasons.push("YouTube requires a video Artifact in this prototype.");
    }
  }
  if (channel.platform === "reddit") {
    if (typeof target.publishingSettings.subreddit !== "string") {
      reasons.push("Reddit subreddit is required.");
    }
    if (typeof target.publishingSettings.title !== "string") {
      reasons.push("Reddit title is required.");
    }
  }

  return reasons;
}

export class PublishingPlanMachine {
  private clock = new Date("2029-12-01T12:00:00.000Z");
  private readonly channels = structuredClone(defaultChannelRegistry);
  private revisionCounter = 0;
  private validationCounter = 0;
  private approvalCounter = 0;
  private deliveryCounter = 0;

  readonly revisions: PublishingPlanRevision[] = [];
  readonly validations: PublishValidation[] = [];
  readonly approvals: Approval[] = [];
  readonly deliveries: Delivery[] = [];

  constructor(
    private readonly approvalMaxAgeMs = 24 * 60 * 60 * 1_000,
    private readonly maxProviderAttempts = 3,
  ) {
    if (maxProviderAttempts < 1) {
      throw new Error("Provider attempt limit must be at least one.");
    }
  }

  get currentRevision(): PublishingPlanRevision | null {
    return this.revisions.at(-1) ?? null;
  }

  persistPlan(input: unknown): PublishingPlanRevision {
    const definition = publishingPlanSchema.parse(input);
    const previous = this.currentRevision;
    if (previous && previous.id !== definition.id) {
      throw new Error("This machine instance owns one Publishing Plan.");
    }
    if (previous && previous.workspaceId !== definition.workspaceId) {
      throw new Error("A Publishing Plan cannot move between Workspaces.");
    }

    this.revisionCounter += 1;
    const revision: PublishingPlanRevision = {
      schema: "publishing-plan-revision/v1",
      id: definition.id,
      workspaceId: definition.workspaceId,
      revision: this.revisionCounter,
      digest: digestPlan(definition),
      definition,
      createdAt: this.tick(),
    };
    this.revisions.push(revision);
    for (const approval of this.approvals) {
      this.expireIfNeeded(approval);
      if (
        approval.plan.id === revision.id &&
        approval.plan.revision < revision.revision &&
        (approval.status === "pending" || approval.status === "approved")
      ) {
        approval.status = "superseded";
        approval.supersededAt = this.tick();
        approval.supersededBy = planRef(revision);
      }
    }
    return revision;
  }

  validate(
    revision: PublishingPlanRevision,
    trigger: PublishValidation["trigger"] = "explicit",
  ): PublishValidation {
    this.assertKnownRevision(revision);
    this.validationCounter += 1;
    const validation: PublishValidation = {
      schema: "publish-validation/v1",
      id: `validation_${this.validationCounter}`,
      plan: planRef(revision),
      trigger,
      checkedAt: this.tick(),
      targets: revision.definition.targets.map((target) => {
        const reasons = validateTarget(
          this.channels,
          revision.workspaceId,
          target,
          this.clock,
          trigger,
        );
        return {
          targetId: target.id,
          channelRef: target.channelRef,
          ready: reasons.length === 0,
          reasons,
        };
      }),
    };
    this.validations.push(validation);
    return validation;
  }

  requestApproval(input: {
    revision: PublishingPlanRevision;
    action: ApprovalAction;
    targetIds: string[];
    requestedBy: string;
    expiresAt: string;
  }): Approval {
    this.assertCurrentRevision(input.revision);
    const targetIds = [...new Set(input.targetIds)].sort();
    if (targetIds.length === 0) {
      throw new Error("Approval needs at least one target.");
    }
    this.assertReady(input.revision, targetIds);
    this.assertTargetsMatchAction(input.revision, targetIds, input.action);
    if (new Date(input.expiresAt).getTime() <= this.clock.getTime()) {
      throw new Error("Approval expiry must be in the future.");
    }
    if (
      new Date(input.expiresAt).getTime() >
      this.clock.getTime() + this.approvalMaxAgeMs
    ) {
      throw new Error("Approval expiry exceeds the Workspace policy maximum.");
    }

    this.approvalCounter += 1;
    const approval: Approval = {
      schema: "publishing-approval/v1",
      id: `approval_${this.approvalCounter}`,
      workspaceId: input.revision.workspaceId,
      plan: planRef(input.revision),
      action: input.action,
      targetIds,
      status: "pending",
      requestedBy: input.requestedBy,
      requestedAt: this.tick(),
      expiresAt: input.expiresAt,
      decision: null,
      revocation: null,
      expiredAt: null,
      supersededAt: null,
      supersededBy: null,
      consumedAt: null,
      releaseIdempotencyKey: null,
    };
    this.approvals.push(approval);
    return approval;
  }

  approve(approvalId: string, approverRef: string): Approval {
    const approval = this.getApproval(approvalId);
    this.expireIfNeeded(approval);
    if (approval.status !== "pending") {
      throw new Error(`Cannot approve from "${approval.status}".`);
    }
    approval.status = "approved";
    approval.decision = {
      basis: "human",
      approverRef,
      decidedAt: this.tick(),
    };
    return approval;
  }

  approveByPolicy(
    approvalId: string,
    input: {
      policyRef: string;
      policyVersion: number;
      evaluationRef: string;
    },
  ): Approval {
    const approval = this.getApproval(approvalId);
    this.expireIfNeeded(approval);
    if (approval.status !== "pending") {
      throw new Error(`Cannot approve from "${approval.status}".`);
    }
    approval.status = "approved";
    approval.decision = {
      basis: "policy",
      policyRef: input.policyRef,
      policyVersion: input.policyVersion,
      evaluationRef: input.evaluationRef,
      decidedAt: this.tick(),
    };
    return approval;
  }

  revoke(approvalId: string, revokedBy: string, reason: string): Approval {
    const approval = this.getApproval(approvalId);
    this.expireIfNeeded(approval);
    if (approval.status !== "pending" && approval.status !== "approved") {
      throw new Error(`Cannot revoke from "${approval.status}".`);
    }
    approval.status = "revoked";
    approval.revocation = {
      revokedBy,
      revokedAt: this.tick(),
      reason,
    };
    return approval;
  }

  release(input: {
    revision: PublishingPlanRevision;
    approvalId: string;
    targetIds: string[];
    idempotencyKey: string;
  }): Delivery[] {
    this.assertCurrentRevision(input.revision);
    const approval = this.getApproval(input.approvalId);
    this.expireIfNeeded(approval);
    if (
      approval.plan.id !== input.revision.id ||
      approval.plan.revision !== input.revision.revision ||
      approval.plan.digest !== input.revision.digest
    ) {
      throw new Error(
        "Approval is bound to a different Publishing Plan revision or digest.",
      );
    }
    if (!sameSet(approval.targetIds, input.targetIds)) {
      throw new Error("Release target set must exactly match the Approval.");
    }

    if (approval.status === "consumed") {
      if (approval.releaseIdempotencyKey !== input.idempotencyKey) {
        throw new Error(
          "Approval was already consumed by another release command.",
        );
      }
      return this.deliveries.filter(
        (delivery) => delivery.approvalId === approval.id,
      );
    }
    if (approval.status !== "approved") {
      throw new Error(`Approval is "${approval.status}", not "approved".`);
    }

    this.validate(input.revision, "release-gate");
    this.assertReady(input.revision, input.targetIds);

    const conflicting = this.deliveries.some(
      (delivery) => delivery.idempotencyKey === input.idempotencyKey,
    );
    if (conflicting) {
      throw new Error("Idempotency key was already used for another release.");
    }

    const targets = input.targetIds.map((targetId) => {
      const target = this.getTarget(input.revision, targetId);
      if (targetAction(target) !== approval.action) {
        throw new Error(
          `Target "${targetId}" does not match approval action "${approval.action}".`,
        );
      }
      return target;
    });

    const deliveries = targets.map((target) => {
      this.deliveryCounter += 1;
      const now = this.tick();
      const delivery: Delivery = {
        schema: "publishing-delivery/v1",
        id: `delivery_${this.deliveryCounter}`,
        workspaceId: input.revision.workspaceId,
        plan: planRef(input.revision),
        targetId: target.id,
        channelRef: target.channelRef,
        action: approval.action,
        approvalId: approval.id,
        idempotencyKey: input.idempotencyKey,
        publishAt:
          target.timing.mode === "at" ? target.timing.publishAt : null,
        status: target.timing.mode === "at" ? "scheduled" : "queued",
        providerPostRef: null,
        block: null,
        attempts: [],
        nextRetryAt: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      this.deliveries.push(delivery);
      return delivery;
    });
    approval.status = "consumed";
    approval.consumedAt = this.tick();
    approval.releaseIdempotencyKey = input.idempotencyKey;
    return deliveries;
  }

  transitionDelivery(
    deliveryId: string,
    next: DeliveryStatus,
    extra?: {
      providerPostRef?: string;
      error?: { code: string; message: string };
    },
  ): Delivery {
    const delivery = this.deliveries.find((item) => item.id === deliveryId);
    if (!delivery) throw new Error(`Unknown Delivery "${deliveryId}".`);
    if (!deliveryTransitions[delivery.status].includes(next)) {
      throw new Error(
        `Delivery cannot transition from "${delivery.status}" to "${next}".`,
      );
    }
    if (next === "published" && !extra?.providerPostRef) {
      throw new Error("Published Delivery needs a provider post reference.");
    }
    if (next === "failed" && !extra?.error) {
      throw new Error("Failed Delivery needs a sanitized error.");
    }
    if (next === "publishing") {
      const revision = this.revisions.find(
        (item) =>
          item.id === delivery.plan.id &&
          item.revision === delivery.plan.revision &&
          item.digest === delivery.plan.digest,
      );
      if (!revision) {
        throw new Error("Delivery references an unknown Plan revision.");
      }
      const validation = this.validate(revision, "pre-publish");
      const readiness = validation.targets.find(
        (item) => item.targetId === delivery.targetId,
      );
      if (!readiness?.ready) {
        delivery.status = "blocked";
        delivery.block = {
          code: "publish_validation_failed",
          message: readiness?.reasons.join("; ") || "Target is not ready.",
          validationId: validation.id,
        };
        delivery.updatedAt = this.tick();
        return delivery;
      }
      delivery.attempts.push({
        id: `${delivery.id}:attempt:${delivery.attempts.length + 1}`,
        number: delivery.attempts.length + 1,
        status: "started",
        startedAt: this.tick(),
        finishedAt: null,
        error: null,
        reconciliation: null,
      });
    }
    if (next === "published" || next === "failed") {
      const attempt = delivery.attempts.at(-1);
      if (!attempt || attempt.status !== "started") {
        throw new Error(
          `${next} Delivery needs a currently started provider attempt.`,
        );
      }
      attempt.status = next === "published" ? "succeeded" : "failed";
      attempt.finishedAt = this.tick();
      attempt.error = extra?.error ?? null;
    }
    delivery.status = next;
    delivery.updatedAt = this.tick();
    delivery.providerPostRef = extra?.providerPostRef ?? null;
    delivery.block = null;
    delivery.nextRetryAt = null;
    delivery.error = extra?.error ?? null;
    return delivery;
  }

  recordProviderFailure(
    deliveryId: string,
    input: {
      kind: "retryable-safe" | "non-retryable" | "outcome-unknown";
      error: { code: string; message: string };
      retryAt?: string;
    },
  ): Delivery {
    const delivery = this.getDelivery(deliveryId);
    if (delivery.status !== "publishing") {
      throw new Error(
        `Cannot record provider failure from "${delivery.status}".`,
      );
    }
    const attempt = delivery.attempts.at(-1);
    if (!attempt || attempt.status !== "started") {
      throw new Error("Delivery has no started provider attempt.");
    }
    attempt.finishedAt = this.tick();
    attempt.error = input.error;

    if (input.kind === "outcome-unknown") {
      attempt.status = "outcome_unknown";
      delivery.status = "blocked";
      delivery.block = {
        code: "provider_outcome_unknown",
        message: input.error.message,
        attemptId: attempt.id,
      };
      delivery.updatedAt = this.tick();
      return delivery;
    }

    if (
      input.kind === "retryable-safe" &&
      delivery.attempts.length < this.maxProviderAttempts
    ) {
      if (!input.retryAt) {
        throw new Error("Safe retry needs a bounded retry time.");
      }
      attempt.status = "retry_scheduled";
      delivery.status = "retry_scheduled";
      delivery.nextRetryAt = input.retryAt;
      delivery.error = input.error;
      delivery.updatedAt = this.tick();
      return delivery;
    }

    attempt.status = "failed";
    delivery.status = "failed";
    delivery.error = input.error;
    delivery.nextRetryAt = null;
    delivery.updatedAt = this.tick();
    return delivery;
  }

  resumeRetry(deliveryId: string): Delivery {
    const delivery = this.getDelivery(deliveryId);
    if (delivery.status !== "retry_scheduled") {
      throw new Error(`Cannot resume retry from "${delivery.status}".`);
    }
    delivery.status = "queued";
    delivery.nextRetryAt = null;
    delivery.updatedAt = this.tick();
    return delivery;
  }

  reconcileProviderOutcome(
    deliveryId: string,
    result:
      | { outcome: "published"; providerPostRef: string }
      | { outcome: "not-published" },
  ): Delivery {
    const delivery = this.getDelivery(deliveryId);
    if (
      delivery.status !== "blocked" ||
      delivery.block?.code !== "provider_outcome_unknown"
    ) {
      throw new Error("Delivery is not awaiting provider reconciliation.");
    }
    delivery.block = null;
    const reconciledAt = this.tick();
    delivery.updatedAt = reconciledAt;
    const attempt = delivery.attempts.at(-1);
    if (!attempt || attempt.status !== "outcome_unknown") {
      throw new Error("Delivery has no ambiguous Attempt to reconcile.");
    }
    if (result.outcome === "published") {
      delivery.status = "published";
      delivery.providerPostRef = result.providerPostRef;
      attempt.reconciliation = {
        outcome: "published",
        reconciledAt,
        providerPostRef: result.providerPostRef,
      };
    } else {
      delivery.status = "queued";
      attempt.reconciliation = {
        outcome: "not-published",
        reconciledAt,
        providerPostRef: null,
      };
    }
    return delivery;
  }

  resumeDelivery(deliveryId: string): Delivery {
    const delivery = this.getDelivery(deliveryId);
    if (delivery.status !== "blocked") {
      throw new Error(`Cannot resume Delivery from "${delivery.status}".`);
    }
    if (delivery.block?.code === "provider_outcome_unknown") {
      throw new Error(
        "Unknown provider outcome requires reconciliation before retry.",
      );
    }
    const revision = this.revisions.find(
      (item) =>
        item.id === delivery.plan.id &&
        item.revision === delivery.plan.revision &&
        item.digest === delivery.plan.digest,
    );
    if (!revision) {
      throw new Error("Delivery references an unknown Plan revision.");
    }
    const validation = this.validate(revision, "pre-publish");
    const readiness = validation.targets.find(
      (item) => item.targetId === delivery.targetId,
    );
    if (!readiness?.ready) {
      delivery.block = {
        code: "publish_validation_failed",
        message: readiness?.reasons.join("; ") || "Target is not ready.",
        validationId: validation.id,
      };
      delivery.updatedAt = this.tick();
      return delivery;
    }
    delivery.status = "queued";
    delivery.block = null;
    delivery.updatedAt = this.tick();
    return delivery;
  }

  snapshot() {
    return {
      currentPlan: this.currentRevision
        ? planRef(this.currentRevision)
        : null,
      revisions: this.revisions,
      validations: this.validations,
      approvals: this.approvals,
      deliveries: this.deliveries,
    };
  }

  progress(revision: PublishingPlanRevision) {
    this.assertKnownRevision(revision);
    const validation = [...this.validations]
      .reverse()
      .find(
        (item) =>
          item.plan.id === revision.id &&
          item.plan.revision === revision.revision &&
          item.plan.digest === revision.digest,
      );

    return revision.definition.targets.map((target) => ({
      targetId: target.id,
      ready:
        validation?.targets.find((item) => item.targetId === target.id)
          ?.ready ?? null,
      approvals: this.approvals
        .filter(
          (approval) =>
            approval.plan.digest === revision.digest &&
            approval.targetIds.includes(target.id),
        )
        .map((approval) => ({
          id: approval.id,
          status: approval.status,
        })),
      deliveries: this.deliveries
        .filter(
          (delivery) =>
            delivery.plan.digest === revision.digest &&
            delivery.targetId === target.id,
        )
        .map((delivery) => ({
          id: delivery.id,
          status: delivery.status,
        })),
    }));
  }

  setChannelEnabled(channelRef: string, enabled: boolean): void {
    const channel = this.channels[channelRef];
    if (!channel) throw new Error(`Unknown Channel "${channelRef}".`);
    channel.enabled = enabled;
  }

  advanceTime(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      throw new Error("Time advance must be a positive finite duration.");
    }
    this.clock = new Date(this.clock.getTime() + milliseconds);
  }

  private assertReady(
    revision: PublishingPlanRevision,
    targetIds: string[],
  ): void {
    const validation = [...this.validations]
      .reverse()
      .find(
        (item) =>
          item.plan.id === revision.id &&
          item.plan.revision === revision.revision &&
          item.plan.digest === revision.digest,
      );
    if (!validation) {
      throw new Error("This exact Publishing Plan revision was not validated.");
    }
    for (const targetId of targetIds) {
      const readiness = validation.targets.find(
        (item) => item.targetId === targetId,
      );
      if (!readiness?.ready) {
        throw new Error(`Target "${targetId}" is not ready.`);
      }
    }
  }

  private assertTargetsMatchAction(
    revision: PublishingPlanRevision,
    targetIds: string[],
    action: ApprovalAction,
  ): void {
    for (const targetId of targetIds) {
      const target = this.getTarget(revision, targetId);
      if (targetAction(target) !== action) {
        throw new Error(
          `Target "${targetId}" requires "${targetAction(target)}", not "${action}".`,
        );
      }
    }
  }

  private assertKnownRevision(revision: PublishingPlanRevision): void {
    if (!this.revisions.includes(revision)) {
      throw new Error("Unknown Publishing Plan revision.");
    }
  }

  private assertCurrentRevision(revision: PublishingPlanRevision): void {
    this.assertKnownRevision(revision);
    if (revision !== this.currentRevision) {
      throw new Error("Only the current Publishing Plan revision can advance.");
    }
  }

  private getTarget(
    revision: PublishingPlanRevision,
    targetId: string,
  ): PublishingTarget {
    const target = revision.definition.targets.find(
      (item) => item.id === targetId,
    );
    if (!target) throw new Error(`Unknown target "${targetId}".`);
    return target;
  }

  private getApproval(approvalId: string): Approval {
    const approval = this.approvals.find((item) => item.id === approvalId);
    if (!approval) throw new Error(`Unknown Approval "${approvalId}".`);
    return approval;
  }

  private getDelivery(deliveryId: string): Delivery {
    const delivery = this.deliveries.find((item) => item.id === deliveryId);
    if (!delivery) throw new Error(`Unknown Delivery "${deliveryId}".`);
    return delivery;
  }

  private expireIfNeeded(approval: Approval): void {
    if (
      (approval.status === "pending" || approval.status === "approved") &&
      new Date(approval.expiresAt).getTime() <= this.clock.getTime()
    ) {
      approval.status = "expired";
      approval.expiredAt = this.tick();
    }
  }

  private tick(): string {
    this.clock = new Date(this.clock.getTime() + 1_000);
    return this.clock.toISOString();
  }
}
