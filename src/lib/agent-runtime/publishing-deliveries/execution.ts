import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { ProviderOutcome } from "../runs/provider-adapter";
import { PublishingDeliveryServiceError } from "./errors";
import { publishingDeliveryOutboxDedupeKey } from "./keys";
import type {
  PublishingDeliveryClock,
  PublishingDeliveryExecutionReadinessPort,
  PublishingDeliveryExecutionLeaseRecord,
  PublishingDeliveryFailureClass,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryReconciliationResolution,
  PublishingDeliveryRecord,
  PublishingDeliveryRepository,
} from "./types";
import type {
  PreparedPublishingPlatformEffect,
  PublishingPlatformRegistry,
} from "./platform-registry";
import {
  PublishingPlatformContactReadinessError,
  PublishingPlatformPreparationError,
} from "./platform-registry";

export interface PublishingDeliveryQueue {
  schedule(input: {
    workspaceId: string;
    deliveryId: string;
    purpose: "publish" | "reconcile";
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
    purpose: "publish",
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

function relayRetryAt(now: Date, deliveryAttempts: number): Date {
  const boundedAttempt = Math.max(
    1,
    Math.min(7, Number.isSafeInteger(deliveryAttempts) ? deliveryAttempts : 1),
  );
  return new Date(now.getTime() + Math.min(60_000, 1_000 * 2 ** (boundedAttempt - 1)));
}

const unavailableReadiness: PublishingDeliveryExecutionReadinessPort = {
  checkCurrent: async () => ({ kind: "unavailable" }),
};

function readinessRetryAt(now: Date, priorBlockCount: number): Date {
  const attempt = Math.max(1, Math.min(7, priorBlockCount + 1));
  return new Date(now.getTime() + Math.min(300_000, 5_000 * 2 ** (attempt - 1)));
}

function externallyCompleted(
  delivery: PublishingDeliveryRecord,
): boolean | null {
  if (delivery.state === "succeeded") return true;
  if (
    delivery.state === "outcome_unknown" ||
    delivery.state === "confirmation_pending" ||
    (delivery.state === "dispatching" &&
      delivery.effectContactStartedAt !== null)
  ) {
    return null;
  }
  return false;
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

function normalizeProviderKnownFailure(
  outcome: Extract<ProviderOutcome<unknown>, { kind: "failed_known" }>,
  mode: "launch" | "observe",
): {
  providerOperationRef: string | null;
  failureCode: string;
  failureClass: PublishingDeliveryFailureClass;
  retryable: boolean;
  effectDisposition: "not_created" | "provider_failed_known";
} | null {
  let effectDisposition: "not_created" | "provider_failed_known" | null = null;
  if (outcome.evidence.effectDisposition === "terminal_failed") {
    effectDisposition = "provider_failed_known";
  } else if (
    outcome.evidence.effectDisposition === "not_created" &&
    mode === "launch" &&
    outcome.providerOperationRef === null
  ) {
    effectDisposition = "not_created";
  }
  return effectDisposition
    ? {
        providerOperationRef: outcome.providerOperationRef,
        failureCode: outcome.failureCode,
        failureClass: outcome.retryHint.retryable ? "transient" : "terminal",
        retryable: outcome.retryHint.retryable,
        effectDisposition,
      }
    : null;
}

export class PublishingDeliveryExecutionService {
  constructor(
    private readonly repository: PublishingDeliveryRepository,
    private readonly queue: PublishingDeliveryQueue,
    private readonly platforms: PublishingPlatformRegistry,
    private readonly clock: PublishingDeliveryClock = systemClock,
    private readonly readiness: PublishingDeliveryExecutionReadinessPort =
      unavailableReadiness,
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
        purpose: claimed.intent.purpose,
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
      const releasedAt = this.clock.now();
      await this.repository.releaseOutbox({
        intentId: claimed.intent.id,
        deliveryToken,
        availableAt: relayRetryAt(
          releasedAt,
          claimed.intent.deliveryAttempts,
        ),
      });
      if (error instanceof PublishingDeliveryServiceError) throw error;
      return executionUnavailable("Publishing Delivery scheduling failed.");
    }
  }

  async executeOne(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    purpose?: "publish" | "reconcile";
    leaseMs?: number;
  }): Promise<{
    deliveryId: string;
    state: PublishingDeliveryRecord["state"];
    externallyCompleted: boolean | null;
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
    if (input.purpose === "reconcile") {
      return this.reconcileOne({
        workspaceId: input.workspaceId,
        deliveryId: input.deliveryId,
        workerId: input.workerId,
        leaseMs,
      });
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
        externallyCompleted:
          acquired.kind === "busy" && !delivery ? null :
          delivery ? externallyCompleted(delivery) : false,
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
        externallyCompleted: externallyCompleted(delivery),
      };
    }
    if (acquired.kind === "unavailable") {
      return executionUnavailable("Publishing Delivery is unavailable.");
    }
    if (!("delivery" in acquired)) {
      return executionUnavailable("Publishing Delivery lease could not be acquired.");
    }

    // The retained adapter digest does not itself expose launch safety to the
    // repository that owns this lease. A committed contact marker with no
    // provider reference therefore always fails closed on restart.
    if (
      acquired.delivery.effectContactStartedAt !== null &&
      acquired.delivery.providerOperationRef === null
    ) {
      return this.settleRetainedUnknown({
        delivery: acquired.delivery,
        lease: acquired.lease,
        failureCode: "PROVIDER_CONTACT_OUTCOME_UNKNOWN",
      });
    }

    const platform = acquired.delivery.targetSnapshot.validation.channel.platform;
    const boundary = this.platforms.get(platform);
    if (!boundary) {
      if (acquired.delivery.providerOperationRef) {
        return this.settleConfirmationPending({
          delivery: acquired.delivery,
          lease: acquired.lease,
          evidenceDigest: canonicalDigest({
            schema: "publishing-platform-confirmation-evidence/v1",
            deliveryId: acquired.delivery.id,
            effectKey: acquired.delivery.effectKey,
            failureCode: "PLATFORM_ADAPTER_UNAVAILABLE",
          }),
          pollAfterMs: 30_000,
        });
      }
      return this.settlePreContactFailure({
        delivery: acquired.delivery,
        lease: acquired.lease,
        failureCode: "PLATFORM_ADAPTER_UNAVAILABLE",
        failureClass: "transient",
        retryable: true,
      });
    }
    let effect: PreparedPublishingPlatformEffect;
    try {
      effect = await boundary.prepare(acquired.delivery);
    } catch (error) {
      if (acquired.delivery.providerOperationRef) {
        return this.settleConfirmationPending({
          delivery: acquired.delivery,
          lease: acquired.lease,
          evidenceDigest: canonicalDigest({
            schema: "publishing-platform-confirmation-evidence/v1",
            deliveryId: acquired.delivery.id,
            effectKey: acquired.delivery.effectKey,
            failureCode: "PLATFORM_INTENT_UNAVAILABLE",
          }),
          pollAfterMs: 30_000,
        });
      }
      return this.settlePreContactFailure({
        delivery: acquired.delivery,
        lease: acquired.lease,
        failureCode: error instanceof PublishingPlatformPreparationError
          ? error.failureCode
          : "PLATFORM_INTENT_UNAVAILABLE",
        failureClass: error instanceof PublishingPlatformPreparationError
          ? error.failureClass
          : "terminal",
        retryable: error instanceof PublishingPlatformPreparationError
          ? error.retryable
          : false,
      });
    }
    if (acquired.delivery.providerOperationRef) {
      return this.observeConfirmation({
        delivery: acquired.delivery,
        lease: acquired.lease,
        effect,
        leaseMs,
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
      providerAdapterContractDigest: effect.providerContractDigest,
      preparedAt: this.clock.now(),
    });
    if (prepared.kind !== "prepared" && prepared.kind !== "replayed") {
      if (prepared.kind === "stale") {
        const cancelled = await this.currentCancellationResult(
          acquired.delivery.workspaceId,
          acquired.delivery.id,
        );
        if (cancelled) return cancelled;
      }
      return executionUnavailable(
        prepared.kind === "stale"
          ? "Publishing Delivery execution fence is stale."
          : "Publishing Delivery effect preparation failed.",
      );
    }

    const readiness = await this.readiness.checkCurrent({
      workspaceId: prepared.delivery.workspaceId,
      deliveryId: prepared.delivery.id,
      effectKey: prepared.delivery.effectKey,
      effectGeneration: prepared.delivery.effectGeneration,
      intentDigest: effect.intentDigest,
      providerAdapterContractDigest: effect.providerContractDigest,
      evaluatedAt: this.clock.now(),
    });
    if (readiness.kind === "blocked") {
      return this.blockForReadiness({
        delivery: prepared.delivery,
        lease: acquired.lease,
        failureCode: readiness.failureCode,
        evidenceDigest: readiness.evidenceDigest,
      });
    }
    if (readiness.kind === "unavailable") {
      return this.settlePreContactFailure({
        delivery: prepared.delivery,
        lease: acquired.lease,
        failureCode: "EXECUTION_READINESS_UNAVAILABLE",
        failureClass: "transient",
        retryable: true,
      });
    }
    try {
      await effect.ensureContactReady();
    } catch (error) {
      return this.settlePreContactFailure({
        delivery: prepared.delivery,
        lease: acquired.lease,
        failureCode: error instanceof PublishingPlatformContactReadinessError
          ? error.failureCode
          : "CREDENTIAL_UNAVAILABLE",
        failureClass: error instanceof PublishingPlatformContactReadinessError
          ? error.failureClass
          : "terminal",
        retryable: error instanceof PublishingPlatformContactReadinessError
          ? error.retryable
          : false,
      });
    }

    // This fenced durable marker is the last local boundary before adapter
    // contact. Cancellation that commits first makes the barrier fail closed;
    // once it commits, cancellation cannot claim prevention without later
    // terminal provider evidence.
    const contact = await this.repository.beginEffectContact({
      workspaceId: prepared.delivery.workspaceId,
      deliveryId: prepared.delivery.id,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: prepared.delivery.effectKey,
      intentDigest: effect.intentDigest,
      providerAdapterContractDigest: effect.providerContractDigest,
      readinessSession: readiness.session,
      startedAt: this.clock.now(),
    });
    if (contact.kind !== "started" && contact.kind !== "replayed") {
      if (contact.kind === "cancelled" || contact.kind === "stale") {
        const cancelled = await this.currentCancellationResult(
          prepared.delivery.workspaceId,
          prepared.delivery.id,
        );
        if (cancelled) return cancelled;
      }
      if (contact.kind === "blocked") {
        return this.blockForReadiness({
          delivery: prepared.delivery,
          lease: acquired.lease,
          failureCode: contact.failureCode,
          evidenceDigest: contact.evidenceDigest,
        });
      }
      return executionUnavailable(
        contact.kind === "unavailable"
          ? "Publishing Delivery contact boundary could not be committed."
          : "Publishing Delivery execution fence is stale.",
      );
    }

    const outcome = await this.withLeaseRenewal(
      acquired.lease,
      leaseMs,
      () => this.contactPlatform(contact.delivery, effect),
    );
    const occurredAt = this.clock.now();
    const evidenceDigest = normalizedEvidenceDigest(outcome, acquired.lease.fence);
    const knownFailure = outcome.kind === "failed_known"
      ? normalizeProviderKnownFailure(outcome, "launch")
      : null;
    const common = {
      workspaceId: contact.delivery.workspaceId,
      deliveryId: contact.delivery.id,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: contact.delivery.effectKey,
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
        : outcome.kind === "failed_known" && knownFailure
            ? {
                ...common,
                outcome: {
                  kind: "failed" as const,
                  providerOperationRef: knownFailure.providerOperationRef,
                  evidenceDigest,
                  failureCode: knownFailure.failureCode,
                  failureClass: knownFailure.failureClass,
                  retryable: knownFailure.retryable,
                  effectDisposition: knownFailure.effectDisposition,
                },
              }
            : outcome.kind === "failed_known"
              ? {
                  ...common,
                  outcome: {
                    kind: "outcome_unknown" as const,
                    providerOperationRef: outcome.providerOperationRef,
                    evidenceDigest,
                    failureCode: "PROVIDER_EVIDENCE_INCONSISTENT",
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
                      delivery: contact.delivery,
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
      if (settlement.kind === "stale") {
        const cancelled = await this.currentCancellationResult(
          contact.delivery.workspaceId,
          contact.delivery.id,
        );
        if (cancelled) return cancelled;
      }
      return executionUnavailable(
        settlement.kind === "stale"
          ? "Publishing Delivery execution fence is stale."
          : "Publishing Delivery outcome could not be committed.",
      );
    }
    return {
      deliveryId: settlement.delivery.id,
      state: settlement.delivery.state,
      externallyCompleted: externallyCompleted(settlement.delivery),
    };
  }

  private async blockForReadiness(input: {
    delivery: PublishingDeliveryRecord;
    lease: PublishingDeliveryExecutionLeaseRecord;
    failureCode: Parameters<PublishingDeliveryRepository["blockForReadiness"]>[0]["failureCode"];
    evidenceDigest: string;
  }): Promise<{
    deliveryId: string;
    state: PublishingDeliveryRecord["state"];
    externallyCompleted: boolean | null;
  }> {
    const blockedAt = this.clock.now();
    const retryAt = readinessRetryAt(blockedAt, input.delivery.readinessBlockCount);
    const result = await this.repository.blockForReadiness({
      workspaceId: input.delivery.workspaceId,
      deliveryId: input.delivery.id,
      workerId: input.lease.workerId,
      leaseToken: input.lease.leaseToken,
      fence: input.lease.fence,
      effectKey: input.delivery.effectKey,
      failureCode: input.failureCode,
      evidenceDigest: input.evidenceDigest,
      retryAt,
      blockedAt,
      outboxIntent: followUpOutbox({ delivery: input.delivery, availableAt: retryAt }),
    });
    if (result.kind === "stale") {
      const cancelled = await this.currentCancellationResult(
        input.delivery.workspaceId,
        input.delivery.id,
      );
      if (cancelled) return cancelled;
    }
    if (result.kind !== "blocked" && result.kind !== "replayed") {
      return executionUnavailable("Publishing Delivery readiness block could not be committed.");
    }
    return {
      deliveryId: result.delivery.id,
      state: result.delivery.state,
      externallyCompleted: false,
    };
  }

  private async observeConfirmation(input: {
    delivery: PublishingDeliveryRecord;
    lease: PublishingDeliveryExecutionLeaseRecord;
    effect: PreparedPublishingPlatformEffect;
    leaseMs: number;
  }): Promise<{
    deliveryId: string;
    state: PublishingDeliveryRecord["state"];
    externallyCompleted: boolean | null;
  }> {
    if (
      input.delivery.intentDigest !== input.effect.intentDigest ||
      input.delivery.providerAdapterContractDigest !==
        input.effect.providerContractDigest ||
      input.effect.observation !== "provider_operation_ref"
    ) {
      return this.settleRetainedUnknown({
        delivery: input.delivery,
        lease: input.lease,
        failureCode: "PLATFORM_CONTRACT_UNAVAILABLE",
      });
    }
    try {
      await input.effect.ensureContactReady();
    } catch {
      return this.settleConfirmationPending({
        delivery: input.delivery,
        lease: input.lease,
        evidenceDigest: canonicalDigest({
          schema: "publishing-platform-confirmation-evidence/v1",
          deliveryId: input.delivery.id,
          effectKey: input.delivery.effectKey,
          failureCode: "CREDENTIAL_UNAVAILABLE",
        }),
        pollAfterMs: 30_000,
      });
    }
    const outcome = await this.withLeaseRenewal(
      input.lease,
      input.leaseMs,
      () => input.effect.observe(
        input.delivery.effectKey,
        input.delivery.providerOperationRef!,
      ),
    );
    const occurredAt = this.clock.now();
    const evidenceDigest = normalizedEvidenceDigest(outcome, input.lease.fence);
    const knownFailure = outcome.kind === "failed_known"
      ? normalizeProviderKnownFailure(outcome, "observe")
      : null;
    const common = {
      workspaceId: input.delivery.workspaceId,
      deliveryId: input.delivery.id,
      workerId: input.lease.workerId,
      leaseToken: input.lease.leaseToken,
      fence: input.lease.fence,
      effectKey: input.delivery.effectKey,
      intentDigest: input.delivery.intentDigest!,
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
        : outcome.kind === "failed_known" && knownFailure
          ? {
              ...common,
              outcome: {
                kind: "failed" as const,
                providerOperationRef: knownFailure.providerOperationRef,
                evidenceDigest,
                failureCode: knownFailure.failureCode,
                failureClass: knownFailure.failureClass,
                retryable: knownFailure.retryable,
                effectDisposition: knownFailure.effectDisposition,
              },
            }
          : outcome.kind === "failed_known"
            ? {
                ...common,
                outcome: {
                  kind: "outcome_unknown" as const,
                  providerOperationRef: outcome.providerOperationRef,
                  evidenceDigest,
                  failureCode: "PROVIDER_EVIDENCE_INCONSISTENT",
                },
              }
          : outcome.providerOperationRef
            ? (() => {
                const pollAt = new Date(
                  occurredAt.getTime() + safeDelay(outcome.pollAfterMs, 30_000),
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
                    delivery: input.delivery,
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
    return this.settlementResult(settlement);
  }

  private async settleConfirmationPending(input: {
    delivery: PublishingDeliveryRecord;
    lease: PublishingDeliveryExecutionLeaseRecord;
    evidenceDigest: string;
    pollAfterMs: number;
  }) {
    const occurredAt = this.clock.now();
    const pollAt = new Date(occurredAt.getTime() + input.pollAfterMs);
    const settlement = await this.repository.settleEffect({
      workspaceId: input.delivery.workspaceId,
      deliveryId: input.delivery.id,
      workerId: input.lease.workerId,
      leaseToken: input.lease.leaseToken,
      fence: input.lease.fence,
      effectKey: input.delivery.effectKey,
      intentDigest: input.delivery.intentDigest!,
      outcome: {
        kind: "confirmation_pending",
        providerOperationRef: input.delivery.providerOperationRef!,
        evidenceDigest: input.evidenceDigest,
        pollAt,
      },
      retryOutboxIntent: followUpOutbox({
        delivery: input.delivery,
        availableAt: pollAt,
      }),
      occurredAt,
    });
    return this.settlementResult(settlement);
  }

  private async settleRetainedUnknown(input: {
    delivery: PublishingDeliveryRecord;
    lease: PublishingDeliveryExecutionLeaseRecord;
    failureCode: string;
  }) {
    if (!input.delivery.intentDigest) {
      return executionUnavailable("Publishing Delivery retained intent is unavailable.");
    }
    const occurredAt = this.clock.now();
    const settlement = await this.repository.settleEffect({
      workspaceId: input.delivery.workspaceId,
      deliveryId: input.delivery.id,
      workerId: input.lease.workerId,
      leaseToken: input.lease.leaseToken,
      fence: input.lease.fence,
      effectKey: input.delivery.effectKey,
      intentDigest: input.delivery.intentDigest,
      outcome: {
        kind: "outcome_unknown",
        providerOperationRef: input.delivery.providerOperationRef,
        evidenceDigest: canonicalDigest({
          schema: "publishing-platform-confirmation-evidence/v1",
          deliveryId: input.delivery.id,
          effectKey: input.delivery.effectKey,
          providerOperationRef: input.delivery.providerOperationRef,
          failureCode: input.failureCode,
        }),
        failureCode: input.failureCode,
      },
      occurredAt,
    });
    return this.settlementResult(settlement);
  }

  private async settlementResult(
    settlement: Awaited<ReturnType<PublishingDeliveryRepository["settleEffect"]>>,
  ) {
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
      externallyCompleted: externallyCompleted(settlement.delivery),
    };
  }

  private async reconcileOne(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    leaseMs: number;
  }): Promise<{
    deliveryId: string;
    state: PublishingDeliveryRecord["state"];
    externallyCompleted: boolean | null;
  }> {
    const now = this.clock.now();
    const acquired = await this.repository.acquireReconciliationLease({
      ...input,
      now,
      expiresAt: new Date(now.getTime() + input.leaseMs),
    });
    if (acquired.kind !== "acquired") {
      if (acquired.kind === "unavailable") {
        return executionUnavailable("Publishing Delivery reconciliation is unavailable.");
      }
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
        externallyCompleted: externallyCompleted(delivery),
      };
    }

    const { delivery, reconciliation, lease } = acquired;
    let effect: PreparedPublishingPlatformEffect | null = null;
    let resolution: PublishingDeliveryReconciliationResolution;
    const boundary = this.platforms.get(
      delivery.targetSnapshot.validation.channel.platform,
    );
    try {
      effect = boundary ? await boundary.prepare(delivery) : null;
    } catch {
      effect = null;
    }

    const retainedIdentityMatches =
      effect !== null &&
      effect.intentDigest === reconciliation.sourceIntentDigest &&
      effect.providerContractDigest ===
        reconciliation.sourceProviderAdapterContractDigest &&
      delivery.effectKey === reconciliation.sourceEffectKey &&
      delivery.effectGeneration === reconciliation.sourceEffectGeneration;
    if (
      !retainedIdentityMatches ||
      effect?.observation !== "provider_operation_ref" ||
      reconciliation.sourceProviderOperationRef === null
    ) {
      resolution = {
        kind: "operator_required",
        providerOperationRef: reconciliation.sourceProviderOperationRef,
        evidenceDigest: canonicalDigest({
          schema: "publishing-delivery-reconciliation-evidence/v1",
          reconciliationId: reconciliation.id,
          sourceEvidenceDigest: reconciliation.sourceEvidenceDigest,
          retainedIdentityMatches,
          observation: effect?.observation ?? null,
          providerOperationRefPresent:
            reconciliation.sourceProviderOperationRef !== null,
        }),
        failureCode: "RECONCILIATION_OPERATOR_REQUIRED",
      };
    } else {
      try {
        await effect.ensureContactReady();
        const outcome = await this.withLeaseRenewal(
          lease,
          input.leaseMs,
          () => effect.observe(
            reconciliation.sourceEffectKey,
            reconciliation.sourceProviderOperationRef!,
          ),
        );
        const evidenceDigest = normalizedEvidenceDigest(outcome, lease.fence);
        const knownFailure = outcome.kind === "failed_known"
          ? normalizeProviderKnownFailure(outcome, "observe")
          : null;
        resolution = outcome.kind === "succeeded"
          ? {
              kind: "succeeded",
              providerOperationRef: outcome.providerOperationRef,
              evidenceDigest,
            }
          : outcome.kind === "failed_known" && knownFailure
            ? {
                kind: "failed_known",
                providerOperationRef: knownFailure.providerOperationRef,
                evidenceDigest,
                failureCode: knownFailure.failureCode,
                failureClass: knownFailure.failureClass,
                retryable: knownFailure.retryable,
                effectDisposition: knownFailure.effectDisposition,
              }
            : outcome.kind === "failed_known"
              ? {
                  kind: "operator_required",
                  providerOperationRef: outcome.providerOperationRef,
                  evidenceDigest,
                  failureCode: "PROVIDER_EVIDENCE_INCONSISTENT",
                }
            : {
                kind: "still_unknown",
                providerOperationRef: outcome.providerOperationRef,
                evidenceDigest,
                failureCode: outcome.failureCode,
              };
      } catch {
        resolution = {
          kind: "still_unknown",
          providerOperationRef: reconciliation.sourceProviderOperationRef,
          evidenceDigest: canonicalDigest({
            schema: "publishing-delivery-reconciliation-evidence/v1",
            reconciliationId: reconciliation.id,
            sourceEvidenceDigest: reconciliation.sourceEvidenceDigest,
            failureCode: "RECONCILIATION_CONTACT_UNAVAILABLE",
          }),
          failureCode: "RECONCILIATION_CONTACT_UNAVAILABLE",
        };
      }
    }

    const occurredAt = this.clock.now();
    const eventResolution = resolution.kind === "failed_known"
      ? resolution.failureClass === "transient"
        ? "failed_transient" as const
        : "failed_terminal" as const
      : resolution.kind;
    const event = {
      schema: "publishing-delivery-event/v1" as const,
      id: randomUUID(),
      workspaceId: delivery.workspaceId,
      deliveryId: delivery.id,
      sequence: delivery.nextEventSequence,
      type: "delivery.reconciled" as const,
      evidence: {
        reconciliationId: reconciliation.id,
        effectKey: reconciliation.sourceEffectKey,
        effectGeneration: reconciliation.sourceEffectGeneration,
        sourceEvidenceDigest: reconciliation.sourceEvidenceDigest,
        evidenceDigest: resolution.evidenceDigest,
        resolution: eventResolution,
        providerOperationRef: resolution.providerOperationRef,
        failureCode:
          resolution.kind === "succeeded" ? null : resolution.failureCode,
        retryable:
          resolution.kind === "failed_known" ? resolution.retryable : null,
      },
      occurredAt,
    };
    const settled = await this.repository.settleReconciliation({
      workspaceId: delivery.workspaceId,
      deliveryId: delivery.id,
      reconciliationId: reconciliation.id,
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      fence: lease.fence,
      effectKey: reconciliation.sourceEffectKey,
      effectGeneration: reconciliation.sourceEffectGeneration,
      intentDigest: reconciliation.sourceIntentDigest,
      providerAdapterContractDigest:
        reconciliation.sourceProviderAdapterContractDigest,
      sourceEvidenceDigest: reconciliation.sourceEvidenceDigest,
      resolution,
      event,
      occurredAt,
    });
    if (settled.kind !== "settled" && settled.kind !== "replayed") {
      return executionUnavailable(
        settled.kind === "stale"
          ? "Publishing Delivery reconciliation fence is stale."
          : "Publishing Delivery reconciliation could not be committed.",
      );
    }
    return {
      deliveryId: settled.delivery.id,
      state: settled.delivery.state,
      externallyCompleted: externallyCompleted(settled.delivery),
    };
  }

  private async currentCancellationResult(
    workspaceId: string,
    deliveryId: string,
  ): Promise<{
    deliveryId: string;
    state: PublishingDeliveryRecord["state"];
    externallyCompleted: boolean | null;
  } | null> {
    const delivery = await this.repository.getDelivery({
      workspaceId,
      deliveryId,
    });
    if (!delivery || delivery.desiredState !== "cancel") return null;
    if (
      delivery.state !== "cancelled" &&
      delivery.state !== "succeeded" &&
      delivery.state !== "failed_transient" &&
      delivery.state !== "failed_terminal" &&
      delivery.state !== "outcome_unknown"
    ) {
      return null;
    }
    return {
      deliveryId: delivery.id,
      state: delivery.state,
      externallyCompleted: externallyCompleted(delivery),
    };
  }

  private contactPlatform(
    delivery: PublishingDeliveryRecord,
    effect: PreparedPublishingPlatformEffect,
  ): Promise<ProviderOutcome<unknown>> {
    if (delivery.providerOperationRef) {
      return executionUnavailable(
        "Publishing Delivery launch cannot observe a retained Provider effect.",
      );
    }
    return effect.launch(delivery.effectKey);
  }

  private async settlePreContactFailure(input: {
    delivery: PublishingDeliveryRecord;
    lease: PublishingDeliveryExecutionLeaseRecord;
    failureCode: string;
    failureClass: PublishingDeliveryFailureClass;
    retryable: boolean;
    evidenceDigest?: string;
  }): Promise<{
    deliveryId: string;
    state: PublishingDeliveryRecord["state"];
    externallyCompleted: boolean | null;
  }> {
    const occurredAt = this.clock.now();
    const evidenceDigest = input.evidenceDigest ?? canonicalDigest({
      schema: "publishing-platform-not-contacted-evidence/v1",
      deliveryId: input.delivery.id,
      effectKey: input.delivery.effectKey,
      executionFence: input.lease.fence.toString(),
      failureCode: input.failureCode,
      effectDisposition: "not_created",
      occurredAt: occurredAt.toISOString(),
    });
    const failed = await this.repository.failBeforeEffect({
      workspaceId: input.delivery.workspaceId,
      deliveryId: input.delivery.id,
      workerId: input.lease.workerId,
      leaseToken: input.lease.leaseToken,
      fence: input.lease.fence,
      effectKey: input.delivery.effectKey,
      evidenceDigest,
      failureCode: input.failureCode,
      failureClass: input.failureClass,
      retryable: input.retryable,
      effectDisposition: "not_created",
      occurredAt,
    });
    if (failed.kind !== "settled" && failed.kind !== "replayed") {
      if (failed.kind === "stale") {
        const cancelled = await this.currentCancellationResult(
          input.delivery.workspaceId,
          input.delivery.id,
        );
        if (cancelled) return cancelled;
      }
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
