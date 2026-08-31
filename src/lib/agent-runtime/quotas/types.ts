import type { UsageUnit } from "../usage/types";

export type QuotaScope = "workspace" | "principal";
export type QuotaPolicyKind = "admission" | "concurrency" | "rate" | "storage" | "usage";
export type QuotaBoundary =
  | "run_admission"
  | "run_concurrency"
  | "provider_effect"
  | "artifact_storage"
  | "usage_settlement";
export type QuotaWindowKind =
  | "concurrent"
  | "calendar_minute"
  | "calendar_hour"
  | "calendar_day"
  | "calendar_week"
  | "calendar_month"
  | "lifetime";
export type QuotaReservationRule = "consume" | "release_on_terminal" | "release_on_transition";
export type QuotaExhaustionBehavior = "deny" | "wait";
export type QuotaReservationState = "held" | "settled" | "released";
export type QuotaWaitState = "waiting" | "resumed" | "cancelled";
export type QuotaResumeActor =
  | { kind: "human"; userId: string }
  | { kind: "principal"; principalId: string }
  | { kind: "system" };

export interface QuotaPolicy {
  schema: "quota-policy/v1";
  id: string;
  workspaceId: string;
  principalId: string | null;
  scope: QuotaScope;
  kind: QuotaPolicyKind;
  boundary: QuotaBoundary;
  dimension: string;
  unit: UsageUnit;
  window: QuotaWindowKind;
  timezone: string;
  reservationRule: QuotaReservationRule;
  status: "active" | "revoked";
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotaPolicyRevision {
  schema: "quota-policy-revision/v1";
  id: string;
  policyId: string;
  workspaceId: string;
  principalId: string | null;
  revision: number;
  warningThreshold: string;
  hardLimit: string;
  exhaustionBehavior: QuotaExhaustionBehavior;
  createdByUserId: string;
  createdAt: Date;
}

export interface QuotaWindow {
  kind: QuotaWindowKind;
  timezone: string;
  startsAt: Date;
  endsAt: Date | null;
}

export interface QuotaSubject {
  kind: "run" | "step_attempt" | "artifact" | "usage_settlement";
  id: string;
}

export interface QuotaClaim {
  dimension: string;
  unit: UsageUnit;
  amount: string;
}

export interface QuotaCapacityProjection {
  committed: string;
  reservationIds: string[];
}

export interface QuotaReservationRequirement {
  scope: QuotaScope;
  policyId: string;
  policyRevisionId: string;
  principalId: string | null;
  kind: QuotaPolicyKind;
  boundary: QuotaBoundary;
  dimension: string;
  unit: UsageUnit;
  window: QuotaWindow;
  reservationRule: QuotaReservationRule;
  exhaustionBehavior: QuotaExhaustionBehavior;
  amount: string;
  hardLimit: string;
  committedBefore: string;
  availableBefore: string;
  blockingReservationIds: string[];
}

export interface QuotaExhaustionEvidence {
  schema: "quota-exhaustion-evidence/v1";
  policyId: string;
  policyRevisionId: string;
  scope: QuotaScope;
  dimension: string;
  unit: UsageUnit;
  window: QuotaWindow;
  hardLimit: string;
  committed: string;
  requested: string;
  available: string;
  blockingReservationIds: string[];
  evaluatedAt: Date;
  eligibleAt: Date | null;
  eligibility:
    | { kind: "window_renewal"; eligibleAt: Date }
    | { kind: "capacity_release"; requiredAvailable: string };
  evidenceRef: string;
  evidenceVersion: 1;
}

export interface QuotaReservation {
  schema: "quota-reservation/v1";
  id: string;
  workspaceId: string;
  admittedPrincipalId: string;
  principalId: string | null;
  runId: string | null;
  transitionKey: string;
  boundary: QuotaBoundary;
  subject: QuotaSubject;
  policyId: string;
  policyRevisionId: string;
  scope: QuotaScope;
  kind: QuotaPolicyKind;
  dimension: string;
  unit: UsageUnit;
  window: QuotaWindow;
  reservationRule: QuotaReservationRule;
  reservedAmount: string;
  heldAmount: string;
  settledAmount: string;
  releasedAmount: string;
  overageAmount: string;
  state: QuotaReservationState;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotaWait {
  schema: "quota-wait/v1";
  id: string;
  workspaceId: string;
  admittedPrincipalId: string;
  runId: string;
  transitionKey: string;
  boundary: QuotaBoundary;
  subject: QuotaSubject;
  claims: QuotaClaim[];
  reasonCode: "QUOTA_RENEWABLE_CAPACITY_EXHAUSTED";
  evidence: QuotaExhaustionEvidence[];
  eligibleAt: Date | null;
  state: QuotaWaitState;
  resumeReason: string | null;
  resumedBy: QuotaResumeActor | null;
  resumeIdempotencyKey: string | null;
  resolutionReservationIds: string[];
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface QuotaClaimInput {
  workspaceId: string;
  principalId: string;
  runId: string | null;
  transitionKey: string;
  boundary: QuotaBoundary;
  subject: QuotaSubject;
  claims: QuotaClaim[];
  recordedAt: Date;
}

export interface QuotaClaimPreview {
  schema: "quota-claim-preview/v1";
  workspaceId: string;
  principalId: string;
  runId: string | null;
  transitionKey: string;
  boundary: QuotaBoundary;
  subject: QuotaSubject;
  claims: QuotaClaim[];
  applicablePolicies: Array<{ policy: QuotaPolicy; revision: QuotaPolicyRevision }>;
  requiredReservations: QuotaReservationRequirement[];
  decision: "admit" | "wait" | "deny";
  exhaustionEvidence: QuotaExhaustionEvidence[];
  denialReasons: Array<"QUOTA_POLICY_UNAVAILABLE" | "QUOTA_CAPACITY_EXHAUSTED" | "EMERGENCY_SPEND_SUSPENDED">;
  warnings: string[];
  evaluatedAt: Date;
}

export interface QuotaClaimPlan {
  schema: "quota-claim-plan/v1";
  workspaceId: string;
  principalId: string;
  runId: string | null;
  transitionKey: string;
  boundary: QuotaBoundary;
  subject: QuotaSubject;
  claims: QuotaClaim[];
  policyRevisionIds: string[];
  reservations: QuotaReservation[];
  waitId: string;
  resumesWaitId: string | null;
  resumeReason: string | null;
  resumeActor: QuotaResumeActor | null;
  resumeIdempotencyKey: string | null;
  requestDigest: string;
  createdAt: Date;
}

export type QuotaAdmissionPlan = QuotaClaimPlan;

export type QuotaClaimCommitResult =
  | { kind: "created" | "replayed"; reservations: QuotaReservation[] }
  | { kind: "wait" | "replayed_wait"; wait: QuotaWait }
  | {
      kind: "denied";
      reasonCodes: Array<"QUOTA_POLICY_UNAVAILABLE" | "QUOTA_CAPACITY_EXHAUSTED" | "EMERGENCY_SPEND_SUSPENDED">;
      evidence: QuotaExhaustionEvidence[];
    }
  | { kind: "conflict" | "unavailable" };

export interface QuotaClaimPlanIdentity {
  readonly transitionKey: string;
  readonly boundary: QuotaBoundary;
  readonly subject: Readonly<QuotaSubject>;
}

export type QuotaClaimBatchCommitResult =
  | {
      kind: "committed";
      results: Array<Extract<QuotaClaimCommitResult, { kind: "created" | "replayed" }>>;
    }
  | {
      kind: "blocked";
      blockedPlan: QuotaClaimPlanIdentity;
      result: Exclude<QuotaClaimCommitResult, { kind: "created" | "replayed" }>;
    };

export interface QuotaTransitionInput {
  workspaceId: string;
  transitionId: string;
  subject: QuotaSubject;
  outcome: "release" | "settle";
  amount: string | null;
  evidenceRef: string;
  recordedAt: Date;
}

export interface QuotaTransitionPlan {
  schema: "quota-transition-plan/v1";
  workspaceId: string;
  transitionId: string;
  subject: QuotaSubject;
  outcome: "release" | "settle";
  amount: string | null;
  evidenceRef: string;
  reservationIds: string[];
  requestDigest: string;
  recordedAt: Date;
}

export interface QuotaEligibleWaitRef {
  waitId: string;
  workspaceId: string;
  runId: string;
  eligibleAt: Date | null;
}

export type QuotaTransitionCommitResult =
  | { kind: "created" | "replayed"; newlyEligibleWaits: QuotaEligibleWaitRef[] }
  | { kind: "conflict" | "unavailable" };

export interface QuotaUsageReconciliationInput {
  workspaceId: string;
  reconciliationId: string;
  subject: { kind: "usage_settlement"; id: string };
  dimension: string;
  unit: UsageUnit;
  actualAmount: string | null;
  evidenceRef: string;
  recordedAt: Date;
}

export interface QuotaUsageReconciliationPlan {
  schema: "quota-usage-reconciliation-plan/v1";
  workspaceId: string;
  reconciliationId: string;
  subject: { kind: "usage_settlement"; id: string };
  dimension: string;
  unit: UsageUnit;
  actualAmount: string | null;
  evidenceRef: string;
  reservationIds: string[];
  requestDigest: string;
  recordedAt: Date;
}

export type QuotaUsageReconciliationCommitResult =
  | { kind: "created" | "replayed"; reservations: QuotaReservation[] }
  | { kind: "conflict" | "unavailable" };

export interface CreateQuotaPolicyRevisionInput {
  workspaceId: string;
  principalId: string | null;
  kind: QuotaPolicyKind;
  boundary: QuotaBoundary;
  dimension: string;
  unit: UsageUnit;
  window: QuotaWindowKind;
  timezone: string;
  reservationRule: QuotaReservationRule;
  warningThreshold: string;
  hardLimit: string;
  exhaustionBehavior: QuotaExhaustionBehavior;
  actorUserId: string;
  idempotencyKey: string;
  recordedAt: Date;
}

export interface EffectiveQuotaCapacity {
  schema: "effective-quota-capacity/v1";
  policy: QuotaPolicy;
  revision: QuotaPolicyRevision;
  window: QuotaWindow;
  committed: string;
  available: string;
  blockingReservationIds: string[];
  warning: boolean;
  exhausted: boolean;
  evaluatedAt: Date;
}

export interface QuotaPolicyAppendInput {
  policy: QuotaPolicy;
  revision: QuotaPolicyRevision;
  requestDigest: string;
  idempotencyKey: string;
}

export interface QuotaCommitWriter<Transaction = unknown> {
  getWait(
    input: { workspaceId: string; waitId: string },
    transaction?: Transaction,
  ): Promise<QuotaWait | null>;
  commitClaim(plan: QuotaClaimPlan, transaction?: Transaction): Promise<QuotaClaimCommitResult>;
  commitClaimsAtomically(
    plans: QuotaClaimPlan[],
    transaction?: Transaction,
  ): Promise<QuotaClaimBatchCommitResult>;
  commitTransition(
    plan: QuotaTransitionPlan,
    transaction?: Transaction,
  ): Promise<QuotaTransitionCommitResult>;
  commitUsageReconciliation(
    plan: QuotaUsageReconciliationPlan,
    transaction?: Transaction,
  ): Promise<QuotaUsageReconciliationCommitResult>;
}

export interface QuotaRepository<Transaction = unknown> extends QuotaCommitWriter<Transaction> {
  getAdminReceipt(input: {
    workspaceId: string;
    idempotencyKey: string;
  }): Promise<{ requestDigest: string; resourceId: string } | null>;
  getPolicyRevision(input: {
    workspaceId: string;
    revisionId: string;
  }): Promise<{ policy: QuotaPolicy; revision: QuotaPolicyRevision } | null>;
  listPolicies(workspaceId: string): Promise<Array<{ policy: QuotaPolicy; revision: QuotaPolicyRevision }>>;
  appendPolicyRevision(input: QuotaPolicyAppendInput): Promise<
    "created" | "replayed" | "conflict" | "unavailable"
  >;
  isSpendSuspended(workspaceId: string): Promise<boolean>;
  getCapacityProjection(input: {
    workspaceId: string;
    policyRevisionId: string;
    window: QuotaWindow;
  }): Promise<QuotaCapacityProjection>;
  getReservations(input: {
    workspaceId: string;
    subject?: QuotaSubject;
    runId?: string | null;
    admittedPrincipalId?: string;
    limit?: number;
  }): Promise<QuotaReservation[]>;
  getWait(input: { workspaceId: string; waitId: string }): Promise<QuotaWait | null>;
  listWaits(input: {
    workspaceId: string;
    runId?: string;
    state?: QuotaWaitState;
    admittedPrincipalId?: string;
    limit?: number;
  }): Promise<QuotaWait[]>;
  listEligibleWaits(input: {
    workspaceId: string;
    at: Date;
    limit: number;
  }): Promise<QuotaEligibleWaitRef[]>;
}
