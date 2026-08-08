import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { ProviderOutcome } from "../runs/provider-adapter";
import { PublishingDeliveryServiceError } from "./errors";
import { publishingDeliveryOutboxDedupeKey } from "./keys";
import type {
  PublishingDeliveryClock,
  PublishingDeliveryExecutionLeaseRecord,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryRepository,
} from "./types";
import type {
  PreparedPublishingPlatformEffect,
  PublishingPlatformRegistry,
} from "./platform-registry";

export interface PublishingDeliveryQueue {
  schedule(input: {
    workspaceId: string;
    deliveryId: string;
    dedupeKey: string;
  }): Promise<void>;
}

const systemClock: PublishingDeliveryClock = { now: () => new Date() };

function executionUnavailable(message: string): never {
  throw new PublishingDeliveryServiceError(
    "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
    message,
  );
}

function followUpOutbox(input: {
  delivery: PublishingDeliveryRecord;
  availableAt: Date;
}): PublishingDeliveryOutboxIntentRecord {
  const generation = input.delivery.nextOutboxGeneration;
  return {
    id: randomUUID(),
    workspaceId: input.delivery.workspaceId,
    deliveryId: input.delivery.id,
    dedupeKey: publishingDeliveryOutboxDedupeKey(
      input.delivery.workspaceId,
      input.delivery.id,
      generation,
    ),
    generation,
    state: "pending",
    availableAt: input.availableAt,
    deliveryToken: null,
    deliveryAttempts: 0,
    claimedAt: null,
    deliveredAt: null,
  };
}

function safeDelay(value: number | null, fallback: number): number {
  if (value === null || !Number.isFinite(value)) return fallback;
  return Math.max(1_000, Math.min(3_600_000, Math.floor(value)));
}

function normalizedEvidenceDigest(
  outcome: ProviderOutcome<unknown>,
  fence: bigint,
): string {
  return canonicalDigest({
    schema: "publishing-platform-effect-evidence/v1",
    executionFence: fence.toString(),
    providerEvidenceDigest: canonicalDigest({
      kind: outcome.kind,
      providerOperationRef: outcome.providerOperationRef,
      evidence: outcome.evidence,
      usage: outcome.usage,
      reportedCost: outcome.reportedCost ?? null,
      ...(outcome.kind === "succeeded"
        ? { outputs: outcome.outputs }
        : outcome.kind === "failed_known"
          ? {
              failureCode: outcome.failureCode,
              retryHint: outcome.retryHint,
            }
          : {
              failureCode: outcome.failureCode,
              pollAfterMs: outcome.pollAfterMs,
            }),
    }),
  });
}

export class PublishingDeliveryExecutionService {
  constructor(
    private readonly repository: PublishingDeliveryRepository,
    private readonly queue: PublishingDeliveryQueue,
    private readonly platforms: PublishingPlatformRegistry,
    private readonly clock: PublishingDeliveryClock = systemClock,
  ) {}

  /** Claims durable scheduling intent and hands it to the durable queue. */
  async relayNext(): Promise<{ delivered: boolean; deliveryId?: string }> {
    const now = this.clock.now();
    const claimed = await this.repository.claimOutbox({
      now,
      claimExpiresBefore: new Date(now.getTime() - 30_000),
      deliveryToken: randomUUID(),
    });
    if (claimed.kind === "empty") return { delivered: false };
    if (claimed.kind === "unavailable") {
      return executionUnavailable("Publishing Delivery scheduling is unavailable.");
    }
    const deliveryToken = claimed.intent.deliveryToken;
    if (!deliveryToken) {
      return executionUnavailable("Publishing Delivery scheduling claim is invalid.");
    }
    try {
      await this.queue.schedule({
        workspaceId: claimed.intent.workspaceId,
        deliveryId: claimed.intent.deliveryId,
        dedupeKey: claimed.intent.dedupeKey,
      });
      const marked = await this.repository.markOutboxDelivered({
        intentId: claimed.intent.id,
        deliveryToken,
        deliveredAt: this.clock.now(),
      });
      if (marked !== "delivered") {
        return executionUnavailable("Publishing Delivery scheduling ownership was lost.");
      }
      return { delivered: true, deliveryId: claimed.intent.deliveryId };
    } catch (error) {
      await this.repository.releaseOutbox({
        intentId: claimed.intent.id,
        deliveryToken,
        availableAt: this.clock.now(),
      });
      if (error instanceof PublishingDeliveryServiceError) throw error;
      return executionUnavailable("Publishing Delivery scheduling failed.");
    }
  }

  async executeOne(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    leaseMs?: number;
  }): Promise<{
    deliveryId: string;
    state: PublishingDeliveryRecord["state"];
    externallyCompleted: boolean;
  }> {
    const leaseMs = input.leaseMs ?? 30_000;
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/.test(input.workerId) ||
      !Number.isInteger(leaseMs) ||
      leaseMs < 1_000 ||
      leaseMs > 60_000
    ) {
      throw new PublishingDeliveryServiceError(
        "PUBLISHING_DELIVERY_INVALID_INPUT",
        "Publishing Delivery worker identity or lease is invalid.",
      );
    }
    const now = this.clock.now();
    const acquired = await this.repository.acquireLease({
      workspaceId: input.workspaceId,
      deliveryId: input.deliveryId,
      workerId: input.workerId,
      now,
      expiresAt: new Date(now.getTime() + leaseMs),
    });
    if (acquired.kind === "not_due" || acquired.kind === "busy") {
      const delivery = await this.repository.getDelivery({
        workspaceId: input.workspaceId,
        deliveryId: input.deliveryId,
      });
      return {
        deliveryId: input.deliveryId,
        state:
          delivery?.state ??
          (acquired.kind === "not_due" ? "scheduled" : "dispatching"),
        externallyCompleted: false,
      };
    }
    if (acquired.kind === "terminal") {
      const delivery = await this.repository.getDelivery({
        workspaceId: input.workspaceId,
        deliveryId: input.deliveryId,
      });
      if (!delivery) {
        return executionUnavailable("Publishing Delivery is unavailable.");
      }
      return {
        deliveryId: delivery.id,
        state: delivery.state,
        externallyCompleted: delivery.state === "succeeded",
      };
    }
    if (acquired.kind === "unavailable") {
      return executionUnavailable("Publishing Delivery is unavailable.");
    }
    if (!("delivery" in acquired)) {
      return executionUnavailable("Publishing Delivery lease could not be acquired.");
    }

    const platform = acquired.delivery.targetSnapshot.validation.channel.platform;
    const boundary = this.platforms.get(platform);
    if (!boundary) {
      return this.settlePreContactFailure({
        delivery: acquired.delivery,
        lease: acquired.lease,
        failureCode: "PLATFORM_ADAPTER_UNAVAILABLE",
      });
    }
    let effect: PreparedPublishingPlatformEffect;
    try {
      effect = await boundary.prepare(acquired.delivery);
    } catch {
      return this.settlePreContactFailure({
        delivery: acquired.delivery,
        lease: acquired.lease,
        failureCode: "PLATFORM_INTENT_UNAVAILABLE",
      });
    }
    const prepared = await this.repository.prepareEffect({
      workspaceId: acquired.delivery.workspaceId,
      deliveryId: acquired.delivery.id,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: acquired.delivery.effectKey,
      intentDigest: effect.intentDigest,
      preparedAt: this.clock.now(),
    });
    if (prepared.kind !== "prepared" && prepared.kind !== "replayed") {
      return executionUnavailable(
        prepared.kind === "stale"
          ? "Publishing Delivery execution fence is stale."
          : "Publishing Delivery effect preparation failed.",
      );
    }

    const outcome = await this.withLeaseRenewal(
      acquired.lease,
      leaseMs,
      () => this.contactPlatform(prepared.delivery, effect),
    );
    const occurredAt = this.clock.now();
    const evidenceDigest = normalizedEvidenceDigest(outcome, acquired.lease.fence);
    const common = {
      workspaceId: prepared.delivery.workspaceId,
      deliveryId: prepared.delivery.id,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: prepared.delivery.effectKey,
      intentDigest: effect.intentDigest,
      occurredAt,
    };
    const settlement = await this.repository.settleEffect(
      outcome.kind === "succeeded"
        ? {
            ...common,
            outcome: {
              kind: "succeeded",
              providerOperationRef: outcome.providerOperationRef,
              evidenceDigest,
            },
          }
        : outcome.kind === "failed_known" && outcome.retryHint.retryable
          ? (() => {
              const retryAt = new Date(
                occurredAt.getTime() +
                  safeDelay(outcome.retryHint.retryAfterMs, 30_000),
              );
              return {
                ...common,
                outcome: {
                  kind: "retry_scheduled" as const,
                  evidenceDigest,
                  failureCode: outcome.failureCode,
                  retryAt,
                },
                retryOutboxIntent: followUpOutbox({
                  delivery: prepared.delivery,
                  availableAt: retryAt,
                }),
              };
            })()
          : outcome.kind === "failed_known"
            ? {
                ...common,
                outcome: {
                  kind: "failed" as const,
                  providerOperationRef: outcome.providerOperationRef,
                  evidenceDigest,
                  failureCode: outcome.failureCode,
                },
              }
            : outcome.providerOperationRef
              ? (() => {
                  const pollAt = new Date(
                    occurredAt.getTime() +
                      safeDelay(outcome.pollAfterMs, 30_000),
                  );
                  return {
                    ...common,
                    outcome: {
                      kind: "confirmation_pending" as const,
                      providerOperationRef: outcome.providerOperationRef,
                      evidenceDigest,
                      pollAt,
                    },
                    retryOutboxIntent: followUpOutbox({
                      delivery: prepared.delivery,
                      availableAt: pollAt,
                    }),
                  };
                })()
              : {
                  ...common,
                  outcome: {
                    kind: "outcome_unknown" as const,
                    providerOperationRef: null,
                    evidenceDigest,
                    failureCode: outcome.failureCode,
                  },
                },
    );
    if (settlement.kind !== "settled" && settlement.kind !== "replayed") {
      return executionUnavailable(
        settlement.kind === "stale"
          ? "Publishing Delivery execution fence is stale."
          : "Publishing Delivery outcome could not be committed.",
      );
    }
    return {
      deliveryId: settlement.delivery.id,
      state: settlement.delivery.state,
      externallyCompleted: settlement.delivery.state === "succeeded",
    };
  }

  private contactPlatform(
    delivery: PublishingDeliveryRecord,
    effect: PreparedPublishingPlatformEffect,
  ): Promise<ProviderOutcome<unknown>> {
    return delivery.providerOperationRef
      ? effect.observe(delivery.effectKey, delivery.providerOperationRef)
      : effect.launch(delivery.effectKey);
  }

  private async settlePreContactFailure(input: {
    delivery: PublishingDeliveryRecord;
    lease: PublishingDeliveryExecutionLeaseRecord;
    failureCode: "PLATFORM_ADAPTER_UNAVAILABLE" | "PLATFORM_INTENT_UNAVAILABLE";
  }): Promise<{
    deliveryId: string;
    state: PublishingDeliveryRecord["state"];
    externallyCompleted: false;
  }> {
    const occurredAt = this.clock.now();
    const evidenceDigest = canonicalDigest({
      schema: "publishing-platform-not-contacted-evidence/v1",
      deliveryId: input.delivery.id,
      effectKey: input.delivery.effectKey,
      executionFence: input.lease.fence.toString(),
      failureCode: input.failureCode,
      effectDisposition:
        input.delivery.intentDigest === null
          ? "not_created"
          : input.delivery.providerOperationRef
            ? "existing_effect_not_observed"
            : "effect_not_relaunched",
      occurredAt: occurredAt.toISOString(),
    });
    if (input.delivery.intentDigest === null) {
      const failed = await this.repository.failBeforeEffect({
        workspaceId: input.delivery.workspaceId,
        deliveryId: input.delivery.id,
        workerId: input.lease.workerId,
        leaseToken: input.lease.leaseToken,
        fence: input.lease.fence,
        effectKey: input.delivery.effectKey,
        evidenceDigest,
        failureCode: input.failureCode,
        occurredAt,
      });
      if (failed.kind !== "settled" && failed.kind !== "replayed") {
        return executionUnavailable(
          "Publishing Delivery pre-contact failure could not be committed.",
        );
      }
      return {
        deliveryId: failed.delivery.id,
        state: failed.delivery.state,
        externallyCompleted: false,
      };
    }

    // A prior prepared intent may already identify an accepted external effect.
    // Preserve its confirmation state/ref and retry observation; never relaunch.
    const retryAt = new Date(occurredAt.getTime() + 30_000);
    const confirmation =
      input.delivery.state === "confirmation_pending" &&
      input.delivery.providerOperationRef !== null;
    const settled = await this.repository.settleEffect({
      workspaceId: input.delivery.workspaceId,
      deliveryId: input.delivery.id,
      workerId: input.lease.workerId,
      leaseToken: input.lease.leaseToken,
      fence: input.lease.fence,
      effectKey: input.delivery.effectKey,
      intentDigest: input.delivery.intentDigest,
      outcome: confirmation
        ? {
            kind: "confirmation_pending",
            providerOperationRef: input.delivery.providerOperationRef!,
            evidenceDigest,
            pollAt: retryAt,
          }
        : {
            kind: "retry_scheduled",
            evidenceDigest,
            failureCode: input.failureCode,
            retryAt,
          },
      retryOutboxIntent: followUpOutbox({
        delivery: input.delivery,
        availableAt: retryAt,
      }),
      occurredAt,
    });
    if (settled.kind !== "settled" && settled.kind !== "replayed") {
      return executionUnavailable(
        "Publishing Delivery pre-contact failure could not be committed.",
      );
    }
    return {
      deliveryId: settled.delivery.id,
      state: settled.delivery.state,
      externallyCompleted: false,
    };
  }

  private async withLeaseRenewal<T>(
    lease: PublishingDeliveryExecutionLeaseRecord,
    leaseMs: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const renew = async () => {
      const now = this.clock.now();
      return this.repository.renewLease({
        workspaceId: lease.workspaceId,
        deliveryId: lease.deliveryId,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        fence: lease.fence,
        now,
        expiresAt: new Date(now.getTime() + leaseMs),
      });
    };
    if (!(await renew())) {
      return executionUnavailable(
        "Publishing Delivery lease was lost before Platform contact.",
      );
    }
    const intervalMs = Math.max(250, Math.min(10_000, Math.floor(leaseMs / 3)));
    let renewal: Promise<void> | null = null;
    let lost = false;
    const timer = setInterval(() => {
      if (renewal || lost) return;
      renewal = renew()
        .then((value) => {
          if (!value) lost = true;
        })
        .catch(() => {
          lost = true;
        })
        .finally(() => {
          renewal = null;
        });
    }, intervalMs);
    timer.unref?.();
    try {
      const result = await operation();
      if (renewal) await renewal;
      if (lost) {
        return executionUnavailable(
          "Publishing Delivery lease was lost during Platform contact.",
        );
      }
      return result;
    } finally {
      clearInterval(timer);
    }
  }
}
