import type { PricingSnapshot } from "../usage/types";

export type BudgetScope = "workspace" | "principal";
export type BudgetPeriodKind = "calendar_day" | "calendar_week" | "calendar_month" | "lifetime";
export type UnknownPriceTreatment = "deny" | "fixed_allowance";
export type BudgetReservationState =
  | "held"
  | "settled"
  | "released"
  | "outcome_unknown"
  | "held_unknown_cost";

export interface BudgetPolicy {
  schema: "budget-policy/v1";
  id: string;
  workspaceId: string;
  principalId: string | null;
  scope: BudgetScope;
  currency: string;
  period: BudgetPeriodKind;
  timezone: string;
  status: "active" | "revoked";
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetPolicyRevision {
  schema: "budget-policy-revision/v1";
  id: string;
  policyId: string;
  workspaceId: string;
  principalId: string | null;
  revision: number;
  warningThreshold: string;
  hardLimit: string;
  unknownPriceTreatment: UnknownPriceTreatment;
  unknownPriceAllowance: string | null;
  createdByUserId: string;
  createdAt: Date;
}

export interface WorkspacePricingOverride {
  schema: "workspace-pricing-override/v1";
  id: string;
  workspaceId: string;
  provider: string;
  providerOperation: string;
  model: string;
  serviceTier: string;
  dimension: string;
  unit: PricingSnapshot["unit"];
  price: string;
  currency: string;
  perQuantity: string;
  runCeiling: string;
  sourceRef: string;
  effectiveFrom: Date;
  status: "active" | "revoked";
  createdByUserId: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedByUserId: string | null;
}

export interface BudgetPeriodWindow {
  kind: BudgetPeriodKind;
  timezone: string;
  startsAt: Date;
  endsAt: Date | null;
}

export interface CredentialSpendGrantEvidence {
  grantId: string;
  credentialSlotId: string;
  credentialProfileId: string;
  mode: "bounded" | "audited_unbounded";
  limit: string | null;
  committed: string;
  available: string | null;
}

export interface RunStepExposure {
  stepId: string;
  provider: string;
  providerOperation: string;
  model: string;
  serviceTier: string;
  automaticAttempts: number;
  credentialSlotId: string | null;
  credentialProfileId: string | null;
  amountPerAttempt: string | null;
  currency: string | null;
  pricingSnapshotIds: string[];
  pricingSource: "workspace_override" | "builtin_catalog" | "unknown";
}

export interface BudgetReservationRequirement {
  scope: BudgetScope;
  policyId: string;
  policyRevisionId: string;
  principalId: string | null;
  period: BudgetPeriodWindow;
  amount: string;
  currency: string;
  committedBefore: string;
  availableBefore: string;
  stepAllocations: Array<{
    stepId: string;
    amountPerAttempt: string;
    automaticAttempts: number;
  }>;
}

export interface RunAdmissionPreview {
  schema: "run-admission-preview/v1";
  workspaceId: string;
  principalId: string;
  workflowId: string;
  workflowRevisionId: string;
  evaluatedAt: Date;
  ceiling: {
    amount: string | null;
    currency: string | null;
    certainty: "conservative" | "unknown";
    fxSnapshotIds: string[];
  };
  applicableCredentialSpendGrants: CredentialSpendGrantEvidence[];
  applicablePolicies: Array<{
    policy: BudgetPolicy;
    revision: BudgetPolicyRevision;
    period: BudgetPeriodWindow;
  }>;
  requiredReservations: BudgetReservationRequirement[];
  stepExposures: RunStepExposure[];
  warnings: string[];
  admissible: boolean;
  denialReasons: string[];
}

export interface BudgetReservation {
  schema: "budget-reservation/v1";
  id: string;
  workspaceId: string;
  admittedPrincipalId: string;
  principalId: string | null;
  runId: string;
  policyId: string;
  policyRevisionId: string;
  scope: BudgetScope;
  period: BudgetPeriodWindow;
  currency: string;
  reservedAmount: string;
  heldAmount: string;
  settledAmount: string;
  releasedAmount: string;
  state: BudgetReservationState;
  pricingSnapshotIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetAdmissionPlan {
  schema: "budget-admission-plan/v1";
  workspaceId: string;
  principalId: string;
  runId: string;
  requestDigest: string;
  reservations: BudgetReservation[];
  grantIds: string[];
  fxSnapshotIds: string[];
  stepExposures: RunStepExposure[];
  reservationAllocations: Array<{
    policyRevisionId: string;
    stepId: string;
    amountPerAttempt: string;
    currency: string;
  }>;
  createdAt: Date;
}

export interface BudgetSettlementPlan {
  schema: "budget-settlement-plan/v1";
  workspaceId: string;
  runId: string;
  stepAttemptId: string;
  settlementId: string;
  costValuationId: string;
  outcome: "succeeded" | "failed_known" | "outcome_unknown";
  amount: string | null;
  currency: string | null;
  fxSnapshotId: string | null;
  runTerminal: boolean;
  recordedAt: Date;
}

/** Immutable request to allocate one provider-facing Step Attempt under its accepted Run envelope. */
export interface BudgetAttemptAllocationInput {
  schema: "budget-attempt-allocation-input/v1";
  id: string;
  workspaceId: string;
  principalId: string;
  runId: string;
  stepAttemptId: string;
  stepId: string;
  attempt: number;
  effectKey: string;
  credentialEffectRef: string;
  provider: string;
  providerOperation: string;
  model: string;
  recordedAt: Date;
}

export interface BudgetAdmissionInput {
  workspaceId: string;
  principalId: string;
  workflowId: string;
  workflowRevisionId: string;
  runId?: string;
  stepExposures: RunStepExposure[];
  at: Date;
}

export interface CreateBudgetPolicyRevisionInput {
  workspaceId: string;
  principalId: string | null;
  currency: string;
  period: BudgetPeriodKind;
  timezone: string;
  warningThreshold: string;
  hardLimit: string;
  unknownPriceTreatment: UnknownPriceTreatment;
  unknownPriceAllowance: string | null;
  actorUserId: string;
  idempotencyKey: string;
  recordedAt: Date;
}

export interface CreatePricingOverrideInput {
  workspaceId: string;
  provider: string;
  providerOperation: string;
  model: string;
  serviceTier: string;
  dimension: string;
  unit: PricingSnapshot["unit"];
  price: string;
  currency: string;
  perQuantity: string;
  runCeiling: string;
  sourceRef: string;
  effectiveFrom: Date;
  actorUserId: string;
  idempotencyKey: string;
  recordedAt: Date;
}

export interface BudgetRepository<Transaction = unknown> {
  getAdminReceipt(input: {
    workspaceId: string;
    kind: "policy_revision" | "pricing_override";
    idempotencyKey: string;
  }): Promise<{ requestDigest: string; resourceId: string } | null>;
  getPolicyRevision(input: {
    workspaceId: string;
    revisionId: string;
  }): Promise<{ policy: BudgetPolicy; revision: BudgetPolicyRevision } | null>;
  getPricingOverride(input: {
    workspaceId: string;
    overrideId: string;
  }): Promise<WorkspacePricingOverride | null>;
  getEffectivePolicies(input: {
    workspaceId: string;
    principalId: string;
  }): Promise<Array<{ policy: BudgetPolicy; revision: BudgetPolicyRevision }>>;
  listPolicies(workspaceId: string): Promise<Array<{ policy: BudgetPolicy; revision: BudgetPolicyRevision }>>;
  appendPolicyRevision(input: {
    policy: BudgetPolicy;
    revision: BudgetPolicyRevision;
    requestDigest: string;
    idempotencyKey: string;
  }): Promise<"created" | "replayed" | "conflict">;
  getCommittedAmount(input: {
    workspaceId: string;
    policyRevisionId: string;
    periodStartsAt: Date;
    periodEndsAt: Date | null;
  }): Promise<string>;
  listActivePricingOverrides(input: {
    workspaceId: string;
    at: Date;
  }): Promise<WorkspacePricingOverride[]>;
  listPricingOverrides(workspaceId: string): Promise<WorkspacePricingOverride[]>;
  appendPricingOverride(input: {
    override: WorkspacePricingOverride;
    requestDigest: string;
    idempotencyKey: string;
  }): Promise<"created" | "replayed" | "conflict">;
  revokePricingOverride(input: {
    workspaceId: string;
    overrideId: string;
    actorUserId: string;
    recordedAt: Date;
  }): Promise<boolean>;
  getCredentialGrantEvidence(input: {
    workspaceId: string;
    principalId: string;
    credentialSlotIds: string[];
    credentialProfileIds: string[];
  }): Promise<CredentialSpendGrantEvidence[]>;
  isSpendSuspended(workspaceId: string): Promise<boolean>;
  setSpendSuspended(input: {
    workspaceId: string;
    suspended: boolean;
    reason: string;
    actorUserId: string;
    recordedAt: Date;
  }): Promise<void>;
  commitAdmission(
    plan: BudgetAdmissionPlan,
    transaction?: Transaction,
  ): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  commitSettlement(
    plan: BudgetSettlementPlan,
    transaction?: Transaction,
  ): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  commitAttemptAllocation(
    input: BudgetAttemptAllocationInput,
    transaction?: Transaction,
  ): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  listReservations(input: {
    workspaceId: string;
    runId?: string;
    principalId?: string;
  }): Promise<BudgetReservation[]>;
}

export interface BudgetCommitWriter<Transaction = unknown> {
  commitAdmission(plan: BudgetAdmissionPlan, transaction?: Transaction): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  commitAttemptAllocation(input: BudgetAttemptAllocationInput, transaction?: Transaction): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  commitSettlement(plan: BudgetSettlementPlan, transaction?: Transaction): Promise<"created" | "replayed" | "conflict" | "unavailable">;
}
