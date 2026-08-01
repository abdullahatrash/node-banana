import type { BudgetReservation } from "../budgets/types";
import type { QuotaReservation, QuotaWait } from "../quotas/types";
import type { WorkflowRunRecord } from "../runs/types";

export type SafeContractEvidenceProjection = Record<string, unknown>;

export type WorkflowRunContractEvidenceSource = WorkflowRunRecord & {
  sourceRunId?: string | null;
  rootRunId?: string | null;
  derivationDepth?: number;
};

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function projectRunContractEvidence(
  run: WorkflowRunContractEvidenceSource,
): SafeContractEvidenceProjection {
  return {
    schema: "support-run-summary/v1",
    id: run.id,
    workflowId: run.workflowId,
    workflowRevisionId: run.workflowRevisionId,
    state: run.state,
    startSnapshotDigest: run.startSnapshotDigest,
    finalSnapshotDigest: run.finalSnapshotDigest,
    sourceRunId: run.sourceRunId ?? run.derivation?.sourceRunId ?? null,
    rootRunId: run.rootRunId ?? run.derivation?.rootRunId ?? null,
    derivationDepth: run.derivationDepth ?? (run.derivation ? 1 : 0),
    resumeAt: iso(run.resumeAt),
    failureCode: run.failureCode,
    acceptedAt: run.acceptedAt.toISOString(),
    startedAt: iso(run.startedAt),
    completedAt: iso(run.completedAt),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export function projectBudgetReservationContractEvidence(
  reservation: BudgetReservation,
): SafeContractEvidenceProjection {
  return {
    schema: "support-budget-summary/v1",
    id: reservation.id,
    runId: reservation.runId,
    policyId: reservation.policyId,
    policyRevisionId: reservation.policyRevisionId,
    scope: reservation.scope,
    period: {
      kind: reservation.period.kind,
      timezone: reservation.period.timezone,
      startsAt: reservation.period.startsAt.toISOString(),
      endsAt: iso(reservation.period.endsAt),
    },
    currency: reservation.currency,
    reservedAmount: reservation.reservedAmount,
    heldAmount: reservation.heldAmount,
    settledAmount: reservation.settledAmount,
    releasedAmount: reservation.releasedAmount,
    state: reservation.state,
    pricingSnapshotIds: reservation.pricingSnapshotIds.filter(
      (id): id is string => typeof id === "string",
    ),
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

export function projectQuotaReservationContractEvidence(
  reservation: QuotaReservation,
): SafeContractEvidenceProjection {
  return {
    schema: "support-quota-reservation-summary/v1",
    id: reservation.id,
    runId: reservation.runId,
    transitionKey: reservation.transitionKey,
    boundary: reservation.boundary,
    subject: {
      kind: reservation.subject.kind,
      id: reservation.subject.id,
    },
    policyId: reservation.policyId,
    policyRevisionId: reservation.policyRevisionId,
    scope: reservation.scope,
    kind: reservation.kind,
    dimension: reservation.dimension,
    unit: reservation.unit,
    window: {
      kind: reservation.window.kind,
      timezone: reservation.window.timezone,
      startsAt: reservation.window.startsAt.toISOString(),
      endsAt: iso(reservation.window.endsAt),
    },
    reservationRule: reservation.reservationRule,
    reservedAmount: reservation.reservedAmount,
    heldAmount: reservation.heldAmount,
    settledAmount: reservation.settledAmount,
    releasedAmount: reservation.releasedAmount,
    overageAmount: reservation.overageAmount,
    state: reservation.state,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

export function projectQuotaWaitContractEvidence(
  wait: QuotaWait,
): SafeContractEvidenceProjection {
  return {
    schema: "support-quota-wait-summary/v1",
    id: wait.id,
    runId: wait.runId,
    transitionKey: wait.transitionKey,
    boundary: wait.boundary,
    subject: {
      kind: wait.subject.kind,
      id: wait.subject.id,
    },
    claims: wait.claims.map((claim) => ({
      dimension: claim.dimension,
      unit: claim.unit,
      amount: claim.amount,
    })),
    reasonCode: wait.reasonCode,
    eligibleAt: iso(wait.eligibleAt),
    state: wait.state,
    resumedBy: wait.resumedBy ? { kind: wait.resumedBy.kind } : null,
    resolutionReservationIds: wait.resolutionReservationIds.filter(
      (id): id is string => typeof id === "string",
    ),
    createdAt: wait.createdAt.toISOString(),
    resolvedAt: iso(wait.resolvedAt),
  };
}
