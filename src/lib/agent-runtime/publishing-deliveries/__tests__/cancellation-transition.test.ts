import { describe, expect, it } from "vitest";
import {
  normalizePublishingDeliverySettlement,
  planPublishingDeliveryCancellation,
} from "../cancellation-transition";
import type {
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
} from "../types";

const requestedAt = new Date("2026-08-09T14:00:00.000Z");

function delivery(
  state: PublishingDeliveryRecord["state"],
  options: {
    contacted?: boolean;
    completedAt?: Date | null;
    desiredState?: PublishingDeliveryRecord["desiredState"];
  } = {},
): PublishingDeliveryRecord {
  return {
    id: "delivery_1",
    workspaceId: "workspace_1",
    effectKey: "publishing-effect:v1:workspace_1:delivery_1",
    desiredState: options.desiredState ?? "publish",
    state,
    effectContactStartedAt: options.contacted
      ? new Date("2026-08-09T13:59:00.000Z")
      : null,
    latestEffectEvidenceDigest: null,
    failureCode: null,
    completedAt: options.completedAt ?? null,
  } as PublishingDeliveryRecord;
}

const cancellationId = "pdc_transition_1";

describe("Publishing Delivery cancellation transition planner", () => {
  it.each([
    ["scheduled", false],
    ["dispatching", true],
    ["blocked", false],
  ] as const)("prevents %s before provider contact", (state, activeLease) => {
    const plan = planPublishingDeliveryCancellation({
      delivery: delivery(state),
      cancellationId,
      requestedAt,
      activeLease,
    });

    expect(plan).toMatchObject({
      outcome: "prevented",
      externallyCompletedAtRequest: false,
      effectDisposition: "not_created",
      nextState: "cancelled",
      completedAt: requestedAt,
      releaseLease: true,
      clearReadinessBlock: state === "blocked",
      terminalEvent: { type: "delivery.cancelled" },
    });
  });

  it("keeps a contacted active worker fenced and reports unknown truthfully", () => {
    const plan = planPublishingDeliveryCancellation({
      delivery: delivery("dispatching", { contacted: true }),
      cancellationId,
      requestedAt,
      activeLease: true,
    });

    expect(plan).toMatchObject({
      outcome: "unknown",
      externallyCompletedAtRequest: null,
      effectDisposition: "contact_started",
      nextState: "dispatching",
      terminalEvent: null,
      releaseLease: false,
    });
  });

  it("terminalizes contacted work with no active fence using deterministic evidence", () => {
    const first = planPublishingDeliveryCancellation({
      delivery: delivery("scheduled", { contacted: true }),
      cancellationId,
      requestedAt,
      activeLease: false,
    });
    const replayedPlan = planPublishingDeliveryCancellation({
      delivery: delivery("scheduled", { contacted: true }),
      cancellationId,
      requestedAt,
      activeLease: false,
    });

    expect(first).toEqual(replayedPlan);
    expect(first).toMatchObject({
      outcome: "unknown",
      externallyCompletedAtRequest: null,
      nextState: "outcome_unknown",
      failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
      releaseLease: true,
      terminalEvent: {
        type: "publication.outcome_unknown",
        evidence: { failureCode: "CANCELLED_AFTER_EFFECT_CONTACT" },
      },
    });
  });

  it.each([
    ["confirmation_pending", "conditional", null, "provider_accepted", false],
    ["succeeded", "too_late", true, "terminal", false],
    ["failed_terminal", "too_late", false, "terminal", false],
    ["outcome_unknown", "unknown", null, "terminal", true],
  ] as const)(
    "preserves %s without claiming reversal",
    (state, outcome, externallyCompletedAtRequest, effectDisposition, releaseLease) => {
      const completedAt = new Date("2026-08-09T13:58:00.000Z");
      const plan = planPublishingDeliveryCancellation({
        delivery: delivery(state, { completedAt }),
        cancellationId,
        requestedAt,
        activeLease: false,
      });

      expect(plan).toMatchObject({
        outcome,
        externallyCompletedAtRequest,
        effectDisposition,
        nextState: state,
        completedAt,
        terminalEvent: null,
        releaseLease,
      });
    },
  );
});

describe("Publishing Delivery cancellation settlement normalization", () => {
  const retryOutboxIntent = {
    id: "outbox_2",
  } as PublishingDeliveryOutboxIntentRecord;
  const retry = {
    kind: "retry_scheduled" as const,
    evidenceDigest: `sha256:${"a".repeat(64)}`,
    failureCode: "TEMPORARY_PROVIDER_FAILURE",
    retryAt: new Date("2026-08-09T14:01:00.000Z"),
  };

  it("leaves an authorized publish retry and follow-up unchanged", () => {
    expect(normalizePublishingDeliverySettlement({
      desiredState: "publish",
      outcome: retry,
      retryOutboxIntent,
    })).toEqual({ outcome: retry, retryOutboxIntent });
  });

  it("turns a cancelled retry into terminal ambiguity and drops follow-up", () => {
    expect(normalizePublishingDeliverySettlement({
      desiredState: "cancel",
      outcome: retry,
      retryOutboxIntent,
    })).toEqual({
      outcome: {
        kind: "outcome_unknown",
        providerOperationRef: null,
        evidenceDigest: retry.evidenceDigest,
        failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
      },
      retryOutboxIntent: undefined,
    });
  });
});
