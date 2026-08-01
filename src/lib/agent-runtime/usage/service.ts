import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { ArtifactProviderMetadata } from "@/lib/agent-runtime/artifacts/types";
import { addDecimals, canonicalDecimal, divideDecimalsExact, multiplyDecimals } from "./decimal";
import { builtinPricingSnapshots } from "./catalog";
import type {
  CorrectUsageInput,
  CostValuation,
  MeteringEventListFilters,
  PricingSnapshot,
  SettleProviderUsageInput,
  UsageListFilters,
  UsageMeteringEvent,
  UsageLedgerAppendPlan,
  UsageRecord,
  UsageRepository,
  ValuationListFilters,
} from "./types";

function measurement(record: UsageRecord): UsageMeteringEvent["measurements"][number] {
  return {
    usageRecordId: record.id,
    interval: structuredClone(record.interval),
    dimension: record.dimension,
    unit: record.unit,
    source: record.source,
    quantity: record.quantity,
  };
}

function digestId(prefix: string, value: unknown): string {
  return `${prefix}_${canonicalDigest(value).slice(7, 39)}`;
}

function isoCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError("Currency must be ISO 4217.");
  return currency;
}

function safeEvidenceRef(value: string): string {
  const ref = value.trim();
  if (!ref || ref.length > 500 || /[\u0000-\u001f\u007f]/.test(ref)) {
    throw new TypeError("Provider cost evidence reference is invalid.");
  }
  return /^evidence:sha256:[a-f0-9]{64}$/.test(ref)
    ? ref
    : `evidence:${canonicalDigest({ kind: "provider_cost", reference: ref })}`;
}

function safeDetails(
  value: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 4_096 || /"[^"]*(secret|token|password|ciphertext|prompt|content)[^"]*"\s*:/i.test(text)) {
    throw new TypeError("Metering Event details are unsafe.");
  }
  return structuredClone(value);
}

function currentHeads(records: UsageRecord[]): UsageRecord[] {
  const superseded = new Set(
    records.map((record) => record.supersedesUsageRecordId).filter((id): id is string => Boolean(id)),
  );
  return records.filter((record) => !superseded.has(record.id));
}

function applicableHeads(records: UsageRecord[]): UsageRecord[] {
  const settlementsWithDetailedUsage = new Set(
    records
      .filter((record) => record.dimension !== "runtime.provider_operation@1")
      .map((record) => record.settlementId),
  );
  return records.filter(
    (record) =>
      record.dimension !== "runtime.provider_operation@1" ||
      !settlementsWithDetailedUsage.has(record.settlementId),
  );
}

function normalizedUsage(
  usage: ArtifactProviderMetadata["usage"],
): ArtifactProviderMetadata["usage"] {
  const seen = new Set<string>();
  return usage.map((item) => {
    if (!/^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$/.test(item.dimension)) {
      throw new UsageServiceError("USAGE_INVALID_INPUT", "Usage dimension is invalid.");
    }
    if (!["count", "byte", "millisecond", "megapixel"].includes(item.unit)) {
      throw new UsageServiceError("USAGE_INVALID_INPUT", "Usage unit is invalid.");
    }
    const key = `${item.dimension}:${item.unit}`;
    if (seen.has(key)) {
      throw new UsageServiceError("USAGE_INVALID_INPUT", "Usage dimensions must be unique per unit.");
    }
    seen.add(key);
    if (item.source === "unknown") {
      if (item.quantity !== null) {
        throw new UsageServiceError("USAGE_INVALID_INPUT", "Unknown usage must have an unknown quantity, and known usage must have an exact quantity.");
      }
      return { ...item, source: "unknown" as const, quantity: null };
    }
    if (item.quantity === null) {
      throw new UsageServiceError("USAGE_INVALID_INPUT", "Unknown usage must have an unknown quantity, and known usage must have an exact quantity.");
    }
    return {
      ...item,
      quantity: canonicalDecimal(item.quantity),
    };
  });
}

export class UsageServiceError extends Error {
  constructor(
    readonly code:
      | "USAGE_UNAVAILABLE"
      | "USAGE_CONFLICT"
      | "USAGE_INVALID_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "UsageServiceError";
  }
}

export class UsageLedgerService {
  constructor(private readonly repository: UsageRepository) {}

  settlementIdFor(binding: SettleProviderUsageInput["binding"]): string {
    return digestId("settlement", {
      workspaceId: binding.workspaceId,
      stepAttemptId: binding.stepAttemptId,
      effectKey: binding.effectKey,
    });
  }

  private async value(input: {
    settlementId: string;
    records: UsageRecord[];
    providerReportedCost?: SettleProviderUsageInput["providerReportedCost"];
    supersedesCostValuationId?: string | null;
    recordedAt: Date;
  }): Promise<{ valuation: CostValuation; snapshots: PricingSnapshot[] }> {
    const first = input.records[0];
    if (!first) throw new UsageServiceError("USAGE_INVALID_INPUT", "Usage cannot be empty.");
    let basis: CostValuation["basis"] = "unknown";
    let pricingSource: CostValuation["pricingSource"] = "unknown";
    let amount: string | null = null;
    let currency: string | null = null;
    let snapshots: PricingSnapshot[] = [];
    let providerCostEvidenceRef: string | null = null;

    if (input.providerReportedCost) {
      basis = "provider_reported";
      pricingSource = "provider_reported";
      amount = canonicalDecimal(input.providerReportedCost.amount);
      currency = isoCurrency(input.providerReportedCost.currency);
      providerCostEvidenceRef = safeEvidenceRef(input.providerReportedCost.evidenceRef);
    } else if (input.records.every((record) => record.quantity !== null)) {
      const overrides = await this.repository.findPricingSnapshots({
        workspaceId: first.binding.workspaceId,
        provider: first.binding.provider,
        providerOperation: first.binding.providerOperation,
        model: first.binding.model,
        at: first.interval.endedAt,
      });
      const builtins = builtinPricingSnapshots({
        provider: first.binding.provider,
        providerOperation: first.binding.providerOperation,
        model: first.binding.model,
        at: first.interval.endedAt,
      });
      const selected = input.records.map((record) => {
        const override = overrides.find(
          (snapshot) => snapshot.dimension === record.dimension && snapshot.unit === record.unit,
        );
        return override ?? builtins.find(
            (snapshot) =>
              snapshot.dimension === record.dimension &&
              snapshot.unit === record.unit,
          );
      });
      if (selected.every((snapshot): snapshot is PricingSnapshot => Boolean(snapshot))) {
        const currencies = new Set(selected.map((snapshot) => snapshot.currency));
        if (currencies.size === 1) {
          try {
            amount = input.records.reduce((sum, record, index) => {
              const snapshot = selected[index]!;
              const line = divideDecimalsExact(
                multiplyDecimals(record.quantity!, snapshot.price),
                snapshot.perQuantity,
              );
              return addDecimals(sum, line);
            }, "0");
            basis = "runtime_calculated";
            const sources = new Set(selected.map((snapshot) => snapshot.source));
            pricingSource = sources.size === 1 ? selected[0]!.source : "mixed";
            currency = selected[0]!.currency;
            snapshots = selected;
          } catch (error) {
            if (!(error instanceof TypeError)) throw error;
          }
        }
      }
    }

    const identity = {
      settlementId: input.settlementId,
      usageRecordIds: input.records.map((record) => record.id),
      basis,
      pricingSource,
      amount,
      currency,
      providerCostEvidenceRef,
      pricingSnapshotIds: snapshots.map((snapshot) => snapshot.id),
      supersedesCostValuationId: input.supersedesCostValuationId ?? null,
    };
    return {
      snapshots,
      valuation: {
        schema: "cost-valuation/v1",
        id: digestId("valuation", identity),
        settlementId: input.settlementId,
        workspaceId: first.binding.workspaceId,
        principalId: first.binding.principalId,
        runId: first.binding.runId,
        stepAttemptId: first.binding.stepAttemptId,
        usageRecordIds: identity.usageRecordIds,
        basis,
        pricingSource,
        amount,
        currency,
        providerCostEvidenceRef,
        pricingSnapshotIds: identity.pricingSnapshotIds,
        pricingSnapshots: structuredClone(snapshots),
        fxSnapshotId: null,
        supersedesCostValuationId: identity.supersedesCostValuationId,
        recordedAt: input.recordedAt,
      },
    };
  }

  async planProviderOutcome(input: SettleProviderUsageInput): Promise<UsageLedgerAppendPlan> {
    if (input.interval.endedAt < input.interval.startedAt) {
      throw new UsageServiceError("USAGE_INVALID_INPUT", "Usage interval is invalid.");
    }
    const usage = normalizedUsage(input.metadata?.usage.length
      ? input.metadata.usage
      : [{
          dimension: "runtime.provider_operation@1",
          unit: "count" as const,
          source: "unknown" as const,
          quantity: null,
        }]);
    const settlementId = this.settlementIdFor(input.binding);
    const lineageArtifactIds = [...new Set(input.lineageArtifactIds ?? [])].sort();
    const records: UsageRecord[] = usage
      .slice()
      .sort((a, b) => a.dimension.localeCompare(b.dimension))
      .map((quantity) => {
        const identity = {
          settlementId,
          dimension: quantity.dimension,
          unit: quantity.unit,
          revision: 1,
        };
        return {
          schema: "usage-record/v1",
          id: digestId("usage", identity),
          settlementId,
          binding: structuredClone(input.binding),
          interval: structuredClone(input.interval),
          dimension: quantity.dimension,
          unit: quantity.unit,
          source: quantity.source,
          quantity: quantity.quantity,
          outcome: input.outcome,
          evidence: structuredClone(input.metadata?.evidence ?? {
            providerRequestId: null,
            httpStatus: null,
            providerCode: null,
            operatorTraceRef: null,
            effectDisposition: "unknown",
          }),
          directArtifactId: null,
          lineageArtifactIds,
          supersedesUsageRecordId: null,
          correctionReason: null,
          recordedAt: input.recordedAt,
        };
      });
    const { valuation, snapshots } = await this.value({
      settlementId,
      records,
      providerReportedCost: input.providerReportedCost,
      recordedAt: input.recordedAt,
    });
    const events: UsageMeteringEvent[] = [
      {
        schema: "usage-metering-event/v1",
        id: digestId("meter", { settlementId, type: "usage.settled" }),
        settlementId,
        workspaceId: input.binding.workspaceId,
        principalId: input.binding.principalId,
        runId: input.binding.runId,
        stepAttemptId: input.binding.stepAttemptId,
        effectKey: input.binding.effectKey,
        type: "usage.settled",
        usageRecordIds: records.map((record) => record.id),
        costValuationId: null,
        measurements: records.map(measurement),
        details: safeDetails({ outcome: input.outcome, recordCount: records.length }),
        occurredAt: input.recordedAt,
      },
      {
        schema: "usage-metering-event/v1",
        id: digestId("meter", { settlementId, type: "cost.valued", valuationId: valuation.id }),
        settlementId,
        workspaceId: input.binding.workspaceId,
        principalId: input.binding.principalId,
        runId: input.binding.runId,
        stepAttemptId: input.binding.stepAttemptId,
        effectKey: input.binding.effectKey,
        type: "cost.valued",
        usageRecordIds: records.map((record) => record.id),
        costValuationId: valuation.id,
        measurements: records.map(measurement),
        details: safeDetails({ pricingSource: valuation.pricingSource, basis: valuation.basis, known: valuation.amount !== null }),
        occurredAt: input.recordedAt,
      },
    ];
    const requestDigest = canonicalDigest({
      settlementId,
      binding: input.binding,
      interval: {
        startedAt: input.interval.startedAt.toISOString(),
        endedAt: input.interval.endedAt.toISOString(),
      },
      metadata: input.metadata,
      outcome: input.outcome,
      providerReportedCost: input.providerReportedCost ?? null,
      lineageArtifactIds,
    });
    return {
      kind: "settlement",
      receiptId: settlementId,
      settlementId,
      requestDigest,
      records,
      pricingSnapshots: snapshots,
      valuation,
      events,
    };
  }

  async commitPlan(plan: UsageLedgerAppendPlan): Promise<void> {
    const result = await this.repository.appendPlan(plan);
    if (result === "conflict") {
      throw new UsageServiceError("USAGE_CONFLICT", "Usage ledger replay conflicts with existing evidence.");
    }
  }

  async settleProviderOutcome(input: SettleProviderUsageInput): Promise<{ settlementId: string }> {
    const plan = await this.planProviderOutcome(input);
    await this.commitPlan(plan);
    return { settlementId: plan.settlementId };
  }

  private async planCorrection(input: CorrectUsageInput): Promise<UsageLedgerAppendPlan> {
    const existing = await this.repository.getSettlementRecords(input.workspaceId, input.settlementId);
    const allHeads = currentHeads(existing);
    const correctedUsage = normalizedUsage(input.usage);
    const replacesMissingMeterPlaceholder = correctedUsage.some(
      (record) => record.dimension !== "runtime.provider_operation@1",
    );
    const heads = replacesMissingMeterPlaceholder
      ? allHeads.filter((record) => record.dimension !== "runtime.provider_operation@1")
      : applicableHeads(allHeads);
    if (!allHeads.length) throw new UsageServiceError("USAGE_UNAVAILABLE", "Usage settlement is unavailable.");
    const settlementBinding = allHeads[0]!.binding;
    if (input.binding) {
      const immutableIdentityMatches =
        input.binding.workspaceId === settlementBinding.workspaceId &&
        input.binding.principalId === settlementBinding.principalId &&
        input.binding.workflowId === settlementBinding.workflowId &&
        input.binding.runId === settlementBinding.runId &&
        input.binding.stepAttemptId === settlementBinding.stepAttemptId &&
        input.binding.stepId === settlementBinding.stepId &&
        input.binding.attempt === settlementBinding.attempt &&
        input.binding.provider === settlementBinding.provider &&
        input.binding.providerOperation === settlementBinding.providerOperation &&
        input.binding.model === settlementBinding.model &&
        input.binding.effectKey === settlementBinding.effectKey;
      const resolvedProviderReferences = new Set(
        allHeads
          .map((record) => record.binding.providerOperationRef)
          .filter((reference): reference is string => reference !== null),
      );
      const providerReferenceTransitionIsValid = resolvedProviderReferences.size > 0
        ? resolvedProviderReferences.size === 1 &&
          resolvedProviderReferences.has(input.binding.providerOperationRef ?? "")
        : input.binding.providerOperationRef === null ||
          (
            input.reason === "provider_reconciliation" &&
            input.binding.providerOperationRef !== null
          );
      if (
        !immutableIdentityMatches ||
        !providerReferenceTransitionIsValid ||
        this.settlementIdFor(input.binding) !== input.settlementId
      ) {
        throw new UsageServiceError("USAGE_INVALID_INPUT", "Usage correction binding does not match the settlement.");
      }
    }
    if (input.interval && input.interval.endedAt < input.interval.startedAt) {
      throw new UsageServiceError("USAGE_INVALID_INPUT", "Usage correction interval is invalid.");
    }
    const byDimension = new Map(heads.map((record) => [`${record.dimension}:${record.unit}`, record]));
    const corrections = new Map(correctedUsage.map((record) => [`${record.dimension}:${record.unit}`, record]));
    const correctionId = digestId("correction", {
      settlementId: input.settlementId,
      supersededHeadIds: heads.map((record) => record.id).sort(),
      reason: input.reason,
      outcome: input.outcome ?? null,
      usage: correctedUsage,
      evidence: input.evidence,
    });
    const dimensions = new Set([...byDimension.keys(), ...corrections.keys()]);
    const records = [...dimensions].sort().map((key) => {
      const prior = byDimension.get(key) ?? null;
      const corrected = corrections.get(key);
      const template = prior ?? allHeads[0]!;
      const quantity = corrected ?? {
        dimension: template.dimension,
        unit: template.unit,
        source: template.source,
        quantity: template.quantity,
      };
      return {
        ...structuredClone(template),
        id: digestId("usage", { correctionId, dimension: quantity.dimension, unit: quantity.unit }),
        dimension: quantity.dimension,
        unit: quantity.unit,
        source: quantity.source,
        quantity: quantity.quantity,
        outcome: input.outcome ?? template.outcome,
        evidence: structuredClone(corrected ? input.evidence : template.evidence),
        binding: structuredClone(input.binding ?? template.binding),
        interval: structuredClone(input.interval ?? template.interval),
        directArtifactId: null,
        supersedesUsageRecordId: prior?.id ?? null,
        correctionReason: input.reason,
        recordedAt: input.recordedAt,
      } satisfies UsageRecord;
    });
    const priorValuations = await this.repository.getSettlementValuations(input.workspaceId, input.settlementId);
    const priorHeads = priorValuations.filter(
      (candidate) => !priorValuations.some((value) => value.supersedesCostValuationId === candidate.id),
    );
    if (priorHeads.length > 1) throw new UsageServiceError("USAGE_CONFLICT", "Cost valuation correction chain has forked.");
    const priorValuation = priorHeads[0] ?? null;
    const effectiveProviderReportedCost = input.providerReportedCost ?? (
      priorValuation?.basis === "provider_reported" &&
      priorValuation.amount !== null &&
      priorValuation.currency !== null &&
      priorValuation.providerCostEvidenceRef !== null
        ? {
            amount: priorValuation.amount,
            currency: priorValuation.currency,
            evidenceRef: priorValuation.providerCostEvidenceRef,
          }
        : null
    );
    const { valuation, snapshots } = await this.value({
      settlementId: input.settlementId,
      records,
      providerReportedCost: effectiveProviderReportedCost,
      supersedesCostValuationId: priorValuation?.id ?? null,
      recordedAt: input.recordedAt,
    });
    const event: UsageMeteringEvent = {
      schema: "usage-metering-event/v1",
      id: digestId("meter", { correctionId, valuationId: valuation.id }),
      settlementId: input.settlementId,
      workspaceId: records[0]!.binding.workspaceId,
      principalId: records[0]!.binding.principalId,
      runId: records[0]!.binding.runId,
      stepAttemptId: records[0]!.binding.stepAttemptId,
      effectKey: records[0]!.binding.effectKey,
      type: "usage.corrected",
      usageRecordIds: records.map((record) => record.id),
      costValuationId: valuation.id,
      measurements: records.map(measurement),
      details: safeDetails({
        reason: input.reason,
        ...(input.outcome ? { outcome: input.outcome } : {}),
      }),
      occurredAt: input.recordedAt,
    };
    const requestDigest = canonicalDigest({
      correctionId,
      reason: input.reason,
      outcome: input.outcome ?? null,
      usage: correctedUsage,
      evidence: input.evidence,
      providerReportedCost: effectiveProviderReportedCost,
      binding: input.binding ?? null,
      interval: input.interval
        ? {
            startedAt: input.interval.startedAt.toISOString(),
            endedAt: input.interval.endedAt.toISOString(),
          }
        : null,
    });
    return {
      kind: "correction",
      receiptId: correctionId,
      settlementId: input.settlementId,
      requestDigest,
      records,
      pricingSnapshots: snapshots,
      valuation,
      events: [event],
    };
  }

  async correctUsage(input: CorrectUsageInput): Promise<{ correctionId: string }> {
    const plan = await this.planCorrection(input);
    await this.commitPlan(plan);
    return { correctionId: plan.receiptId };
  }

  async planProviderReconciliation(input: SettleProviderUsageInput): Promise<UsageLedgerAppendPlan | null> {
    const settlementId = this.settlementIdFor(input.binding);
    const existing = await this.repository.getSettlementRecords(
      input.binding.workspaceId,
      settlementId,
    );
    if (!existing.length) return this.planProviderOutcome(input);
    const heads = applicableHeads(currentHeads(existing));
    const reconciledUsage = normalizedUsage(input.metadata?.usage.length
      ? input.metadata.usage
      : heads.map((record) =>
          record.source === "unknown"
            ? {
                dimension: record.dimension,
                unit: record.unit,
                source: "unknown" as const,
                quantity: null,
              }
            : {
                dimension: record.dimension,
                unit: record.unit,
                source: record.source,
                quantity: record.quantity!,
              }));
    const current = new Map(heads.map((record) => [`${record.dimension}:${record.unit}`, record]));
    const usageMatches = reconciledUsage.length === heads.length && reconciledUsage.every((candidate) => {
      const record = current.get(`${candidate.dimension}:${candidate.unit}`);
      return record?.source === candidate.source && record.quantity === candidate.quantity;
    });
    const valuationHistory = await this.repository.getSettlementValuations(input.binding.workspaceId, settlementId);
    const valuationHead = valuationHistory.find((candidate) =>
      !valuationHistory.some((value) => value.supersedesCostValuationId === candidate.id));
    const providerCostMatches = input.providerReportedCost
      ? valuationHead?.basis === "provider_reported" &&
        valuationHead.amount === canonicalDecimal(input.providerReportedCost.amount) &&
        valuationHead.currency === isoCurrency(input.providerReportedCost.currency) &&
        valuationHead.providerCostEvidenceRef === safeEvidenceRef(input.providerReportedCost.evidenceRef)
      : true;
    const outcomeMatches = heads.every((record) => record.outcome === input.outcome);
    const evidenceMatches = heads.every((record) =>
      record.binding.providerOperationRef === input.binding.providerOperationRef &&
      (!input.metadata || canonicalDigest(record.evidence) === canonicalDigest(input.metadata.evidence)));
    if (usageMatches && providerCostMatches && evidenceMatches && outcomeMatches) return null;
    return this.planCorrection({
      workspaceId: input.binding.workspaceId,
      settlementId,
      reason: "provider_reconciliation",
      outcome: input.outcome,
      usage: reconciledUsage,
      evidence: input.metadata?.evidence ?? heads[0]?.evidence ?? {
        providerRequestId: null,
        httpStatus: null,
        providerCode: null,
        operatorTraceRef: null,
        effectDisposition: "unknown",
      },
      providerReportedCost: input.providerReportedCost,
      binding: input.binding,
      interval: input.interval,
      recordedAt: input.recordedAt,
    });
  }

  async reconcileProviderOutcome(input: SettleProviderUsageInput): Promise<{ settlementId: string }> {
    const settlementId = this.settlementIdFor(input.binding);
    const plan = await this.planProviderReconciliation(input);
    if (plan) await this.commitPlan(plan);
    return { settlementId };
  }

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
  }) {
    const attributionId = digestId("attribution", {
      settlementId: input.settlementId,
      artifactId: input.artifactId,
    });
    const event: UsageMeteringEvent = {
      schema: "usage-metering-event/v1",
      id: digestId("meter", { attributionId, type: "artifact.attributed" }),
      settlementId: input.settlementId,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      runId: input.runId,
      stepAttemptId: input.stepAttemptId,
      effectKey: input.effectKey,
      type: "artifact.attributed",
      usageRecordIds: [],
      costValuationId: null,
      measurements: [],
      details: safeDetails({ artifactId: input.artifactId, basis: "single_output" }),
      occurredAt: input.recordedAt,
    };
    const attribution = {
      schema: "usage-artifact-attribution/v1" as const,
      id: attributionId,
      settlementId: input.settlementId,
      workspaceId: input.workspaceId,
      artifactId: input.artifactId,
      runId: input.runId,
      stepAttemptId: input.stepAttemptId,
      effectKey: input.effectKey,
      outputName: input.outputName,
      basis: "single_output" as const,
      recordedAt: input.recordedAt,
    };
    return {
      receiptId: attributionId,
      requestDigest: canonicalDigest({
        settlementId: input.settlementId,
        artifactId: input.artifactId,
        runId: input.runId,
        stepAttemptId: input.stepAttemptId,
        effectKey: input.effectKey,
        outputName: input.outputName,
        basis: "single_output",
      }),
      settlementId: input.settlementId,
      artifactId: input.artifactId,
      attribution,
      event,
    };
  }

  async attributeGeneratedArtifact(input: Parameters<UsageLedgerService["planGeneratedArtifactAttribution"]>[0]): Promise<void> {
    const plan = this.planGeneratedArtifactAttribution(input);
    const result = await this.repository.appendAttributionPlan(plan);
    if (result === "conflict") throw new UsageServiceError("USAGE_CONFLICT", "Artifact attribution conflicts with existing evidence.");
    if (result === "unavailable") throw new UsageServiceError("USAGE_UNAVAILABLE", "Usage settlement is unavailable for attribution.");
  }

  getUsageRecord(workspaceId: string, id: string) {
    return this.repository.getUsageRecord(workspaceId, id);
  }
  listUsageRecords(workspaceId: string, filters?: UsageListFilters) {
    return this.repository.listUsageRecords(workspaceId, filters);
  }
  getCostValuation(workspaceId: string, id: string) {
    return this.repository.getCostValuation(workspaceId, id);
  }
  listCostValuations(workspaceId: string, filters?: ValuationListFilters) {
    return this.repository.listCostValuations(workspaceId, filters);
  }
  listMeteringEvents(workspaceId: string, filters?: MeteringEventListFilters) {
    return this.repository.listMeteringEvents(workspaceId, filters);
  }

  async getSummary(workspaceId: string, filters: UsageListFilters = {}) {
    const records = applicableHeads(currentHeads(await this.repository.listUsageRecords(workspaceId, filters)));
    const valuations = await this.repository.listCostValuations(workspaceId, {
      runId: filters.runId,
      principalId: filters.principalId,
      from: filters.from,
      to: filters.to,
    });
    const valuationHeads = valuations.filter(
      (candidate) => !valuations.some((value) => value.supersedesCostValuationId === candidate.id),
    );
    const quantityTotals = new Map<string, { dimension: string; unit: string; source: string; quantity: string | null; unknownCount: number }>();
    for (const record of records) {
      const key = `${record.dimension}:${record.unit}:${record.source}`;
      const total = quantityTotals.get(key) ?? {
        dimension: record.dimension,
        unit: record.unit,
        source: record.source,
        quantity: null,
        unknownCount: 0,
      };
      if (record.quantity === null) total.unknownCount += 1;
      else total.quantity = addDecimals(total.quantity ?? "0", record.quantity);
      quantityTotals.set(key, total);
    }
    const costs = new Map<string, { currency: string; amount: string; knownCount: number }>();
    let unknownValuationCount = 0;
    for (const valuation of valuationHeads) {
      if (valuation.amount === null || valuation.currency === null) {
        unknownValuationCount += 1;
        continue;
      }
      const total = costs.get(valuation.currency) ?? { currency: valuation.currency, amount: "0", knownCount: 0 };
      total.amount = addDecimals(total.amount, valuation.amount);
      total.knownCount += 1;
      costs.set(valuation.currency, total);
    }
    return {
      schema: "usage-summary/v1" as const,
      quantityTotals: [...quantityTotals.values()].sort((a, b) => `${a.dimension}:${a.unit}:${a.source}`.localeCompare(`${b.dimension}:${b.unit}:${b.source}`)),
      costSubtotals: [...costs.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      unknownValuationCount,
      complete: unknownValuationCount === 0 && records.every((record) => record.quantity !== null),
    };
  }

  async getAgentUsage(workspaceId: string, principalId: string, filters: UsageListFilters = {}) {
    const scoped = { ...filters, principalId };
    const [records, valuations, summary, events] = await Promise.all([
      this.listUsageRecords(workspaceId, { ...scoped, limit: 50 }),
      this.listCostValuations(workspaceId, { principalId, from: filters.from, to: filters.to, limit: 50 }),
      this.getSummary(workspaceId, scoped),
      this.listMeteringEvents(workspaceId, { principalId, from: filters.from, to: filters.to, limit: 50 }),
    ]);
    return {
      schema: "agent-usage-view/v1" as const,
      principalId,
      summary,
      recentUsageRecords: records,
      recentCostValuations: valuations,
      recentMeteringEvents: events,
      reservationEvidence: {
        state: "unsupported" as const,
        reasonCode: "RUNTIME_BUDGET_AND_QUOTA_NOT_AVAILABLE" as const,
      },
    };
  }
}
