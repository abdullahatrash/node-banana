import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  PublishingDeliveryCancellationOutcome,
  PublishingDeliveryEvent,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryRepository,
} from "./types";

type CancellationTerminalEvent = Extract<
  PublishingDeliveryEvent,
  { type: "delivery.cancelled" | "publication.outcome_unknown" }
>;
type CancellationTerminalEventPlan = CancellationTerminalEvent extends infer Event
  ? Event extends CancellationTerminalEvent
    ? Pick<Event, "type" | "evidence">
    : never
  : never;

export interface PublishingDeliveryCancellationTransitionPlan {
  outcome: PublishingDeliveryCancellationOutcome;
  externallyCompletedAtRequest: boolean | null;
  effectDisposition: Extract<
    PublishingDeliveryEvent,
    { type: "delivery.cancellation_requested" }
  >["evidence"]["effectDisposition"];
  nextState: PublishingDeliveryRecord["state"];
  completedAt: Date | null;
  latestEffectEvidenceDigest: string | null;
  failureCode: string | null;
  terminalEvent: CancellationTerminalEventPlan | null;
  releaseLease: boolean;
  clearReadinessBlock: boolean;
}

/**
 * Pure desired-state transition shared by durable and in-memory repositories.
 * Adapters remain responsible only for locking and atomically persisting this plan.
 */
export function planPublishingDeliveryCancellation(input: {
  delivery: PublishingDeliveryRecord;
  cancellationId: string;
  requestedAt: Date;
  activeLease: boolean;
}): PublishingDeliveryCancellationTransitionPlan {
  const { delivery } = input;
  const cancellableState =
    delivery.state === "scheduled" || delivery.state === "dispatching" ||
    delivery.state === "blocked";
  const beforeContact = cancellableState && delivery.effectContactStartedAt === null;
  const contactedNonterminal =
    cancellableState && delivery.effectContactStartedAt !== null;

  const outcome: PublishingDeliveryCancellationOutcome = beforeContact
    ? "prevented"
    : delivery.state === "confirmation_pending"
      ? "conditional"
      : delivery.state === "outcome_unknown" || contactedNonterminal
        ? "unknown"
        : "too_late";
  const effectDisposition = beforeContact
    ? "not_created" as const
    : delivery.state === "confirmation_pending"
      ? "provider_accepted" as const
      : delivery.state === "succeeded" ||
          delivery.state === "failed_transient" ||
          delivery.state === "failed_terminal" ||
          delivery.state === "outcome_unknown" || delivery.state === "cancelled"
        ? "terminal" as const
        : "contact_started" as const;

  if (beforeContact) {
    return {
      outcome,
      externallyCompletedAtRequest: false,
      effectDisposition,
      nextState: "cancelled",
      completedAt: input.requestedAt,
      latestEffectEvidenceDigest: delivery.latestEffectEvidenceDigest,
      failureCode: delivery.failureCode,
      terminalEvent: {
        type: "delivery.cancelled",
        evidence: {
          cancellationId: input.cancellationId,
          effectKey: delivery.effectKey,
          effectDisposition: "not_created",
        },
      },
      releaseLease: true,
      clearReadinessBlock: delivery.state === "blocked",
    };
  }

  if (contactedNonterminal && !input.activeLease) {
    const evidenceDigest = canonicalDigest({
      schema: "publishing-delivery-cancellation-unknown/v1",
      cancellationId: input.cancellationId,
      effectKey: delivery.effectKey,
    });
    return {
      outcome,
      externallyCompletedAtRequest: null,
      effectDisposition,
      nextState: "outcome_unknown",
      completedAt: input.requestedAt,
      latestEffectEvidenceDigest: evidenceDigest,
      failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
      terminalEvent: {
        type: "publication.outcome_unknown",
        evidence: {
          effectKey: delivery.effectKey,
          providerOperationRef: null,
          evidenceDigest,
          failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
        },
      },
      releaseLease: true,
      clearReadinessBlock: false,
    };
  }

  return {
    outcome,
    externallyCompletedAtRequest:
      outcome === "unknown" || outcome === "conditional"
        ? null
        : delivery.state === "succeeded",
    effectDisposition,
    nextState: delivery.state,
    completedAt: delivery.completedAt,
    latestEffectEvidenceDigest: delivery.latestEffectEvidenceDigest,
    failureCode: delivery.failureCode,
    terminalEvent: null,
    releaseLease: delivery.state === "outcome_unknown",
    clearReadinessBlock: false,
  };
}

type SettlementOutcome = Parameters<
  PublishingDeliveryRepository["settleEffect"]
>[0]["outcome"];

/** Cancellation suppresses semantic retries after provider contact. */
export function normalizePublishingDeliverySettlement(input: {
  desiredState: PublishingDeliveryRecord["desiredState"];
  outcome: SettlementOutcome;
  retryOutboxIntent?: PublishingDeliveryOutboxIntentRecord;
}): { outcome: SettlementOutcome; retryOutboxIntent?: PublishingDeliveryOutboxIntentRecord } {
  if (input.desiredState !== "cancel" || input.outcome.kind !== "retry_scheduled") {
    return {
      outcome: input.outcome,
      retryOutboxIntent: input.retryOutboxIntent,
    };
  }
  return {
    outcome: {
      kind: "outcome_unknown",
      providerOperationRef: null,
      evidenceDigest: input.outcome.evidenceDigest,
      failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
    },
    retryOutboxIntent: undefined,
  };
}
