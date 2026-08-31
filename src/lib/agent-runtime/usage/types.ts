import type { ArtifactProviderMetadata } from "../artifacts/types";

export type UsageUnit = "count" | "byte" | "millisecond" | "megapixel";
export type UsageSource = "reported" | "measured" | "estimated" | "unknown";
export type PricingSource =
  | "effect_not_created"
  | "provider_reported"
  | "workspace_override"
  | "builtin_catalog"
  | "mixed"
  | "unknown";
export type ValuationBasis =
  | "effect_not_created"
  | "provider_reported"
  | "runtime_calculated"
  | "unknown";

export interface UsageBinding {
  workspaceId: string;
  principalId: string;
  workflowId: string;
  runId: string;
  stepAttemptId: string;
  stepId: string;
  attempt: number;
  provider: string;
  providerOperation: string;
  providerOperationRef: string | null;
  model: string;
  effectKey: string;
}

export interface UsageRecord {
  schema: "usage-record/v1";
  id: string;
  settlementId: string;
  binding: UsageBinding;
  interval: { startedAt: Date; endedAt: Date };
  dimension: string;
  unit: UsageUnit;
  source: UsageSource;
  quantity: string | null;
  outcome: SettleProviderUsageInput["outcome"];
  evidence: ArtifactProviderMetadata["evidence"];
  directArtifactId: string | null;
  lineageArtifactIds: string[];
  supersedesUsageRecordId: string | null;
  correctionReason: string | null;
  recordedAt: Date;
}

export interface PricingSnapshot {
  schema: "pricing-snapshot/v1";
  id: string;
  workspaceId: string | null;
  source: "workspace_override" | "builtin_catalog";
  provider: string;
  providerOperation: string;
  model: string;
  dimension: string;
  unit: UsageUnit;
  price: string;
  currency: string;
  perQuantity: string;
  version: string;
  sourceUrl: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  recordedAt: Date;
}

export interface FxSnapshot {
  schema: "fx-snapshot/v1";
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source: string;
  observedAt: Date;
  recordedAt: Date;
}

export interface CostValuation {
  schema: "cost-valuation/v1";
  id: string;
  settlementId: string;
  workspaceId: string;
  principalId: string;
  runId: string;
  stepAttemptId: string;
  usageRecordIds: string[];
  basis: ValuationBasis;
  pricingSource: PricingSource;
  amount: string | null;
  currency: string | null;
  providerCostEvidenceRef: string | null;
  pricingSnapshotIds: string[];
  pricingSnapshots: PricingSnapshot[];
  fxSnapshotId: string | null;
  supersedesCostValuationId: string | null;
  recordedAt: Date;
}

export interface UsageMeteringEvent {
  schema: "usage-metering-event/v1";
  id: string;
  settlementId: string;
  workspaceId: string;
  principalId: string;
  runId: string;
  stepAttemptId: string;
  effectKey: string;
  type:
    | "usage.settled"
    | "usage.corrected"
    | "cost.valued"
    | "artifact.attributed";
  usageRecordIds: string[];
  costValuationId: string | null;
  measurements: Array<{
    usageRecordId: string;
    interval: { startedAt: Date; endedAt: Date };
    dimension: string;
    unit: UsageUnit;
    source: UsageSource;
    quantity: string | null;
  }>;
  details: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}

export interface UsageArtifactAttribution {
  schema: "usage-artifact-attribution/v1";
  id: string;
  settlementId: string;
  workspaceId: string;
  artifactId: string;
  runId: string;
  stepAttemptId: string;
  effectKey: string;
  outputName: string;
  basis: "single_output";
  recordedAt: Date;
}

export interface UsageLedgerAppendPlan {
  kind: "settlement" | "correction";
  receiptId: string;
  settlementId: string;
  requestDigest: string;
  records: UsageRecord[];
  pricingSnapshots: PricingSnapshot[];
  valuation: CostValuation;
  events: UsageMeteringEvent[];
}

export interface UsageAttributionAppendPlan {
  receiptId: string;
  requestDigest: string;
  settlementId: string;
  artifactId: string;
  attribution: UsageArtifactAttribution;
  event: UsageMeteringEvent;
}

export interface UsageCommitWriter<Transaction = unknown> {
  appendPlan(
    plan: UsageLedgerAppendPlan,
    transaction?: Transaction,
  ): Promise<"created" | "replayed" | "conflict">;
  appendAttributionPlan(
    plan: UsageAttributionAppendPlan,
    transaction?: Transaction,
  ): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  appendBundle(
    input: {
      usagePlan?: UsageLedgerAppendPlan | null;
      attributionPlan?: UsageAttributionAppendPlan | null;
    },
    transaction?: Transaction,
  ): Promise<"created" | "replayed" | "conflict" | "unavailable">;
}

export interface ProviderReportedCost {
  amount: string;
  currency: string;
  evidenceRef: string;
}

export interface SettleProviderUsageInput {
  binding: UsageBinding;
  interval: { startedAt: Date; endedAt: Date };
  metadata: ArtifactProviderMetadata | null;
  outcome: "succeeded" | "failed_known" | "outcome_unknown";
  providerReportedCost?: ProviderReportedCost | null;
  lineageArtifactIds?: string[];
  recordedAt: Date;
}

export interface CorrectUsageInput {
  workspaceId: string;
  settlementId: string;
  reason: string;
  usage: ArtifactProviderMetadata["usage"];
  evidence: ArtifactProviderMetadata["evidence"];
  providerReportedCost?: ProviderReportedCost | null;
  outcome?: SettleProviderUsageInput["outcome"];
  binding?: UsageBinding;
  interval?: { startedAt: Date; endedAt: Date };
  recordedAt: Date;
}

export interface UsageListFilters {
  runId?: string;
  stepAttemptId?: string;
  principalId?: string;
  provider?: string;
  model?: string;
  artifactId?: string;
  from?: Date;
  to?: Date;
  before?: { recordedAt: Date; id: string };
  limit?: number;
}

export interface ValuationListFilters {
  usageRecordId?: string;
  runId?: string;
  principalId?: string;
  pricingSource?: PricingSource;
  currency?: string;
  from?: Date;
  to?: Date;
  before?: { recordedAt: Date; id: string };
  limit?: number;
}

export interface MeteringEventListFilters {
  principalId?: string;
  types?: UsageMeteringEvent["type"][];
  from?: Date;
  to?: Date;
  before?: { recordedAt: Date; id: string };
  limit?: number;
}

export interface UsageRepository {
  appendPlan(input: UsageLedgerAppendPlan): Promise<"created" | "replayed" | "conflict">;
  appendAttributionPlan(input: UsageAttributionAppendPlan): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  appendSettlement(input: {
    settlementId: string;
    requestDigest: string;
    records: UsageRecord[];
    pricingSnapshots: PricingSnapshot[];
    valuation: CostValuation;
    events: UsageMeteringEvent[];
  }): Promise<"created" | "replayed" | "conflict">;
  appendCorrection(input: {
    correctionId: string;
    requestDigest: string;
    records: UsageRecord[];
    pricingSnapshots: PricingSnapshot[];
    valuation: CostValuation;
    events: UsageMeteringEvent[];
  }): Promise<"created" | "replayed" | "conflict">;
  appendAttribution(input: {
    attributionId: string;
    requestDigest: string;
    settlementId: string;
    artifactId: string;
    attribution: UsageArtifactAttribution;
    event: UsageMeteringEvent;
  }): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  getUsageRecord(workspaceId: string, id: string): Promise<UsageRecord | null>;
  listUsageRecords(workspaceId: string, filters?: UsageListFilters): Promise<UsageRecord[]>;
  getCostValuation(workspaceId: string, id: string): Promise<CostValuation | null>;
  listCostValuations(workspaceId: string, filters?: ValuationListFilters): Promise<CostValuation[]>;
  listMeteringEvents(workspaceId: string, filters?: MeteringEventListFilters): Promise<UsageMeteringEvent[]>;
  findPricingSnapshots(input: {
    workspaceId: string;
    provider: string;
    providerOperation: string;
    model: string;
    at: Date;
  }): Promise<PricingSnapshot[]>;
  getSettlementRecords(workspaceId: string, settlementId: string): Promise<UsageRecord[]>;
  getSettlementValuations(workspaceId: string, settlementId: string): Promise<CostValuation[]>;
}

export interface UsageSettlementPort {
  settlementIdFor(binding: UsageBinding): string;
  planProviderOutcome(input: SettleProviderUsageInput): Promise<UsageLedgerAppendPlan>;
  planProviderReconciliation(input: SettleProviderUsageInput): Promise<UsageLedgerAppendPlan | null>;
  commitPlan(plan: UsageLedgerAppendPlan): Promise<void>;
  getCurrentValuation?(workspaceId: string, settlementId: string): Promise<CostValuation | null>;
  planGeneratedArtifactAttribution(input: {
    workspaceId: string;
    principalId: string;
    runId: string;
    stepAttemptId: string;
    effectKey: string;
    settlementId: string;
    artifactId: string;
    outputName: string;
    recordedAt: Date;
  }): UsageAttributionAppendPlan;
  settleProviderOutcome(input: SettleProviderUsageInput): Promise<{ settlementId: string }>;
  reconcileProviderOutcome(input: SettleProviderUsageInput): Promise<{ settlementId: string }>;
  attributeGeneratedArtifact(input: {
    workspaceId: string;
    principalId: string;
    runId: string;
    stepAttemptId: string;
    effectKey: string;
    settlementId: string;
    artifactId: string;
    outputName: string;
    recordedAt: Date;
  }): Promise<void>;
}
