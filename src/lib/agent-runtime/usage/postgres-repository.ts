import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  runtimeCostValuations,
  runtimeCostValuationPricingSnapshots,
  runtimeCostValuationUsageRecords,
  runtimePricingSnapshots,
  runtimeUsageArtifactAttributions,
  runtimeUsageMeteringEvents,
  runtimeUsageRecords,
  usageLedgerReceipts,
} from "@/lib/db/schema";
import type {
  CostValuation,
  MeteringEventListFilters,
  PricingSnapshot,
  UsageListFilters,
  UsageMeteringEvent,
  UsageRecord,
  UsageRepository,
  ValuationListFilters,
} from "./types";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function usageRecord(record: UsageRecord): UsageRecord {
  return {
    ...structuredClone(record),
    interval: {
      startedAt: date(record.interval.startedAt),
      endedAt: date(record.interval.endedAt),
    },
    recordedAt: date(record.recordedAt),
  };
}

function valuation(value: CostValuation): CostValuation {
  return { ...structuredClone(value), recordedAt: date(value.recordedAt) };
}

function snapshot(value: PricingSnapshot): PricingSnapshot {
  return {
    ...structuredClone(value),
    effectiveFrom: date(value.effectiveFrom),
    effectiveTo: value.effectiveTo ? date(value.effectiveTo) : null,
    recordedAt: date(value.recordedAt),
  };
}

function meteringEvent(value: UsageMeteringEvent): UsageMeteringEvent {
  return { ...structuredClone(value), occurredAt: date(value.occurredAt) };
}

function constraintConflict(error: unknown, names: string[]): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; constraint?: unknown; cause?: unknown };
  if (value.cause && constraintConflict(value.cause, names)) return true;
  return value.code === "23505" && typeof value.constraint === "string" && names.includes(value.constraint);
}

class UsageBundleAbort extends Error {
  constructor(readonly result: "conflict" | "unavailable") {
    super(`Usage bundle aborted: ${result}`);
  }
}

export class DrizzleUsageRepository implements UsageRepository {
  constructor(private readonly database: () => Db) {}

  private async append(input: {
    receiptId: string;
    requestDigest: string;
    kind: "settlement" | "correction";
    records: UsageRecord[];
    pricingSnapshots: PricingSnapshot[];
    valuation: CostValuation;
    events: UsageMeteringEvent[];
  }, transaction?: Tx): Promise<"created" | "replayed" | "conflict"> {
    const execute = async (tx: Db | Tx) => {
      const first = input.records[0]!;
      const claimed = await tx.insert(usageLedgerReceipts).values({
        id: input.receiptId,
        workspaceId: first.binding.workspaceId,
        requestDigest: input.requestDigest,
        kind: input.kind,
        createdAt: input.valuation.recordedAt,
      }).onConflictDoNothing({ target: usageLedgerReceipts.id })
        .returning({ id: usageLedgerReceipts.id });
      if (!claimed[0]) {
        const existing = await tx
          .select({
            workspaceId: usageLedgerReceipts.workspaceId,
            requestDigest: usageLedgerReceipts.requestDigest,
            kind: usageLedgerReceipts.kind,
          })
          .from(usageLedgerReceipts)
          .where(eq(usageLedgerReceipts.id, input.receiptId))
          .limit(1);
        return existing[0]?.workspaceId === first.binding.workspaceId &&
          existing[0]?.requestDigest === input.requestDigest &&
          existing[0]?.kind === input.kind
          ? "replayed" as const
          : "conflict" as const;
      }
      if (input.pricingSnapshots.length) {
        await tx.insert(runtimePricingSnapshots).values(
          input.pricingSnapshots.map((value) => ({
            id: value.id,
            workspaceId: value.workspaceId,
            source: value.source,
            provider: value.provider,
            providerOperation: value.providerOperation,
            model: value.model,
            dimension: value.dimension,
            unit: value.unit,
            price: value.price,
            currency: value.currency,
            perQuantity: value.perQuantity,
            effectiveFrom: value.effectiveFrom,
            effectiveTo: value.effectiveTo,
            snapshot: value,
            recordedAt: value.recordedAt,
          })),
        ).onConflictDoNothing();
      }
      await tx.insert(runtimeUsageRecords).values(
        input.records.map((record) => ({
          id: record.id,
          settlementId: record.settlementId,
          workspaceId: record.binding.workspaceId,
          principalId: record.binding.principalId,
          workflowId: record.binding.workflowId,
          runId: record.binding.runId,
          stepAttemptId: record.binding.stepAttemptId,
          stepId: record.binding.stepId,
          attempt: record.binding.attempt,
          effectKey: record.binding.effectKey,
          provider: record.binding.provider,
          providerOperation: record.binding.providerOperation,
          providerOperationRef: record.binding.providerOperationRef,
          model: record.binding.model,
          intervalStartedAt: record.interval.startedAt,
          intervalEndedAt: record.interval.endedAt,
          dimension: record.dimension,
          unit: record.unit,
          source: record.source,
          quantity: record.quantity,
          outcome: record.outcome,
          supersedesUsageRecordId: record.supersedesUsageRecordId,
          record,
          recordedAt: record.recordedAt,
        })),
      );
      await tx.insert(runtimeCostValuations).values({
        id: input.valuation.id,
        settlementId: input.valuation.settlementId,
        workspaceId: input.valuation.workspaceId,
        principalId: input.valuation.principalId,
        runId: input.valuation.runId,
        stepAttemptId: input.valuation.stepAttemptId,
          source: input.valuation.pricingSource,
        amount: input.valuation.amount,
        currency: input.valuation.currency,
        supersedesCostValuationId: input.valuation.supersedesCostValuationId,
        valuation: input.valuation,
        recordedAt: input.valuation.recordedAt,
      });
      await tx.insert(runtimeCostValuationUsageRecords).values(
        input.valuation.usageRecordIds.map((usageRecordId) => ({
          workspaceId: input.valuation.workspaceId,
          settlementId: input.valuation.settlementId,
          costValuationId: input.valuation.id,
          usageRecordId,
        })),
      );
      if (input.valuation.pricingSnapshotIds.length) {
        await tx.insert(runtimeCostValuationPricingSnapshots).values(
          input.valuation.pricingSnapshotIds.map((pricingSnapshotId) => {
            const pricing = input.valuation.pricingSnapshots.find(
              (snapshot) => snapshot.id === pricingSnapshotId,
            );
            if (!pricing || (pricing.workspaceId !== null && pricing.workspaceId !== input.valuation.workspaceId)) {
              throw new Error("Cost valuation pricing evidence is invalid.");
            }
            return {
              workspaceId: input.valuation.workspaceId,
              costValuationId: input.valuation.id,
              pricingWorkspaceId: pricing.workspaceId,
              pricingSnapshotId,
              pricingSource: pricing.source,
            };
          }),
        );
      }
      await tx.insert(runtimeUsageMeteringEvents).values(
        input.events.map((event) => ({
          id: event.id,
          settlementId: event.settlementId,
          workspaceId: event.workspaceId,
          principalId: event.principalId,
          runId: event.runId,
          stepAttemptId: event.stepAttemptId,
          effectKey: event.effectKey,
          eventType: event.type,
          event,
          occurredAt: event.occurredAt,
        })),
      );
      return "created" as const;
    };
    if (transaction) return execute(transaction);
    try {
      return await this.database().transaction(execute);
    } catch (error) {
      if (constraintConflict(error, [
        "runtime_usage_records_superseded_unique",
        "runtime_cost_valuations_superseded_unique",
      ])) return "conflict";
      throw error;
    }
  }

  appendPlan(
    input: Parameters<UsageRepository["appendPlan"]>[0],
    transaction?: Tx,
  ) {
    return this.append({
      receiptId: input.receiptId,
      requestDigest: input.requestDigest,
      kind: input.kind,
      records: input.records,
      pricingSnapshots: input.pricingSnapshots,
      valuation: input.valuation,
      events: input.events,
    }, transaction);
  }

  appendSettlement(input: Parameters<UsageRepository["appendSettlement"]>[0]) {
    return this.append({ ...input, receiptId: input.settlementId, kind: "settlement" });
  }

  appendCorrection(input: Parameters<UsageRepository["appendCorrection"]>[0]) {
    return this.append({ ...input, receiptId: input.correctionId, kind: "correction" });
  }

  async appendAttribution(
    input: Parameters<UsageRepository["appendAttribution"]>[0],
    transaction?: Tx,
  ) {
    const execute = async (tx: Db | Tx) => {
      const records = await tx
        .select({
          id: runtimeUsageRecords.id,
          runId: runtimeUsageRecords.runId,
          stepAttemptId: runtimeUsageRecords.stepAttemptId,
          effectKey: runtimeUsageRecords.effectKey,
        })
        .from(runtimeUsageRecords)
        .where(
          and(
            eq(runtimeUsageRecords.workspaceId, input.event.workspaceId),
            eq(runtimeUsageRecords.settlementId, input.settlementId),
          ),
        )
        .limit(1);
      if (
        !records[0] ||
        records[0].runId !== input.attribution.runId ||
        records[0].stepAttemptId !== input.attribution.stepAttemptId ||
        records[0].effectKey !== input.attribution.effectKey
      ) return "unavailable" as const;
      const claimed = await tx.insert(usageLedgerReceipts).values({
        id: input.attributionId,
        workspaceId: input.event.workspaceId,
        requestDigest: input.requestDigest,
        kind: "attribution",
        createdAt: input.attribution.recordedAt,
      }).onConflictDoNothing({ target: usageLedgerReceipts.id })
        .returning({ id: usageLedgerReceipts.id });
      if (!claimed[0]) {
        const existing = await tx
          .select({
            workspaceId: usageLedgerReceipts.workspaceId,
            requestDigest: usageLedgerReceipts.requestDigest,
            kind: usageLedgerReceipts.kind,
          })
          .from(usageLedgerReceipts)
          .where(eq(usageLedgerReceipts.id, input.attributionId))
          .limit(1);
        return existing[0]?.workspaceId === input.event.workspaceId &&
          existing[0]?.requestDigest === input.requestDigest &&
          existing[0]?.kind === "attribution"
          ? "replayed" as const
          : "conflict" as const;
      }
      await tx.insert(runtimeUsageArtifactAttributions).values({
        id: input.attribution.id,
        settlementId: input.attribution.settlementId,
        workspaceId: input.attribution.workspaceId,
        artifactId: input.attribution.artifactId,
        runId: input.attribution.runId,
        stepAttemptId: input.attribution.stepAttemptId,
        effectKey: input.attribution.effectKey,
        outputName: input.attribution.outputName,
        basis: input.attribution.basis,
        attribution: input.attribution,
        recordedAt: input.attribution.recordedAt,
      });
      await tx.insert(runtimeUsageMeteringEvents).values({
        id: input.event.id,
        settlementId: input.event.settlementId,
        workspaceId: input.event.workspaceId,
        principalId: input.event.principalId,
        runId: input.event.runId,
        stepAttemptId: input.event.stepAttemptId,
        effectKey: input.event.effectKey,
        eventType: input.event.type,
        event: input.event,
        occurredAt: input.event.occurredAt,
      });
      return "created" as const;
    };
    if (transaction) return execute(transaction);
    try {
      return await this.database().transaction(execute);
    } catch (error) {
      if (constraintConflict(error, ["runtime_usage_artifact_attributions_settlement_unique"])) return "conflict";
      throw error;
    }
  }

  appendAttributionPlan(
    input: Parameters<UsageRepository["appendAttributionPlan"]>[0],
    transaction?: Tx,
  ) {
    return this.appendAttribution({
      attributionId: input.receiptId,
      requestDigest: input.requestDigest,
      settlementId: input.settlementId,
      artifactId: input.artifactId,
      attribution: input.attribution,
      event: input.event,
    }, transaction);
  }

  async appendBundle(
    input: {
      usagePlan?: Parameters<UsageRepository["appendPlan"]>[0] | null;
      attributionPlan?: Parameters<UsageRepository["appendAttributionPlan"]>[0] | null;
    },
    transaction?: Tx,
  ) {
    const execute = async (tx: Tx) => {
      let created = false;
      if (input.usagePlan) {
        const result = await this.appendPlan(input.usagePlan, tx);
        if (result === "conflict") throw new UsageBundleAbort(result);
        created ||= result === "created";
      }
      if (input.attributionPlan) {
        const result = await this.appendAttributionPlan(input.attributionPlan, tx);
        if (result !== "created" && result !== "replayed") throw new UsageBundleAbort(result);
        created ||= result === "created";
      }
      return created ? "created" as const : "replayed" as const;
    };
    if (transaction) return execute(transaction);
    try {
      return await this.database().transaction(execute);
    } catch (error) {
      if (error instanceof UsageBundleAbort) return error.result;
      if (constraintConflict(error, [
        "runtime_usage_records_superseded_unique",
        "runtime_cost_valuations_superseded_unique",
        "runtime_usage_artifact_attributions_settlement_unique",
        "runtime_usage_records_pkey",
        "runtime_cost_valuations_pkey",
        "runtime_usage_metering_events_pkey",
        "usage_ledger_receipts_pkey",
      ])) return "conflict";
      throw error;
    }
  }

  private async projectAttributions(records: UsageRecord[]): Promise<UsageRecord[]> {
    const settlementIds = [...new Set(records.map((record) => record.settlementId))];
    if (!settlementIds.length) return records;
    const rows = await this.database()
      .select({
        settlementId: runtimeUsageArtifactAttributions.settlementId,
        artifactId: runtimeUsageArtifactAttributions.artifactId,
      })
      .from(runtimeUsageArtifactAttributions)
      .where(and(
        eq(runtimeUsageArtifactAttributions.workspaceId, records[0]!.binding.workspaceId),
        inArray(runtimeUsageArtifactAttributions.settlementId, settlementIds),
      ));
    const attributed = new Map(rows.map((row) => [row.settlementId, row.artifactId]));
    return records.map((record) => ({
      ...record,
      directArtifactId: attributed.get(record.settlementId) ?? null,
    }));
  }

  async getUsageRecord(workspaceId: string, id: string) {
    const rows = await this.database()
      .select({ record: runtimeUsageRecords.record })
      .from(runtimeUsageRecords)
      .where(and(eq(runtimeUsageRecords.workspaceId, workspaceId), eq(runtimeUsageRecords.id, id)))
      .limit(1);
    const records = rows[0] ? [usageRecord(rows[0].record)] : [];
    return (await this.projectAttributions(records))[0] ?? null;
  }

  async listUsageRecords(workspaceId: string, filters: UsageListFilters = {}) {
    const rows = await this.database()
      .select({
        record: runtimeUsageRecords.record,
        directArtifactId: runtimeUsageArtifactAttributions.artifactId,
      })
      .from(runtimeUsageRecords)
      .leftJoin(
        runtimeUsageArtifactAttributions,
        and(
          eq(runtimeUsageArtifactAttributions.workspaceId, runtimeUsageRecords.workspaceId),
          eq(runtimeUsageArtifactAttributions.settlementId, runtimeUsageRecords.settlementId),
        ),
      )
      .where(and(
        eq(runtimeUsageRecords.workspaceId, workspaceId),
        filters.runId ? eq(runtimeUsageRecords.runId, filters.runId) : undefined,
        filters.stepAttemptId ? eq(runtimeUsageRecords.stepAttemptId, filters.stepAttemptId) : undefined,
        filters.principalId ? eq(runtimeUsageRecords.principalId, filters.principalId) : undefined,
        filters.provider ? eq(runtimeUsageRecords.provider, filters.provider) : undefined,
        filters.model ? eq(runtimeUsageRecords.model, filters.model) : undefined,
        filters.artifactId ? eq(runtimeUsageArtifactAttributions.artifactId, filters.artifactId) : undefined,
        filters.from ? gte(runtimeUsageRecords.recordedAt, filters.from) : undefined,
        filters.to ? lt(runtimeUsageRecords.recordedAt, filters.to) : undefined,
        filters.before ? or(
          lt(runtimeUsageRecords.recordedAt, filters.before.recordedAt),
          and(
            eq(runtimeUsageRecords.recordedAt, filters.before.recordedAt),
            lt(runtimeUsageRecords.id, filters.before.id),
          ),
        ) : undefined,
      ))
      .orderBy(desc(runtimeUsageRecords.recordedAt), desc(runtimeUsageRecords.id))
      .limit(filters.limit ?? 2_147_483_647);
    return rows.map((row) => ({
      ...usageRecord(row.record),
      directArtifactId: row.directArtifactId ?? null,
    }));
  }

  async getCostValuation(workspaceId: string, id: string) {
    const rows = await this.database()
      .select({ valuation: runtimeCostValuations.valuation })
      .from(runtimeCostValuations)
      .where(and(eq(runtimeCostValuations.workspaceId, workspaceId), eq(runtimeCostValuations.id, id)))
      .limit(1);
    return rows[0] ? valuation(rows[0].valuation) : null;
  }

  async listCostValuations(workspaceId: string, filters: ValuationListFilters = {}) {
    const rows = await this.database()
      .select({ valuation: runtimeCostValuations.valuation })
      .from(runtimeCostValuations)
      .where(and(
        eq(runtimeCostValuations.workspaceId, workspaceId),
        filters.usageRecordId
          ? sql`${runtimeCostValuations.valuation}->'usageRecordIds' ? ${filters.usageRecordId}`
          : undefined,
        filters.runId ? eq(runtimeCostValuations.runId, filters.runId) : undefined,
        filters.principalId ? eq(runtimeCostValuations.principalId, filters.principalId) : undefined,
        filters.pricingSource ? eq(runtimeCostValuations.source, filters.pricingSource) : undefined,
        filters.currency ? eq(runtimeCostValuations.currency, filters.currency) : undefined,
        filters.from ? gte(runtimeCostValuations.recordedAt, filters.from) : undefined,
        filters.to ? lt(runtimeCostValuations.recordedAt, filters.to) : undefined,
        filters.before ? or(
          lt(runtimeCostValuations.recordedAt, filters.before.recordedAt),
          and(
            eq(runtimeCostValuations.recordedAt, filters.before.recordedAt),
            lt(runtimeCostValuations.id, filters.before.id),
          ),
        ) : undefined,
      ))
      .orderBy(desc(runtimeCostValuations.recordedAt), desc(runtimeCostValuations.id))
      .limit(filters.limit ?? 2_147_483_647);
    return rows.map((row) => valuation(row.valuation));
  }

  async listMeteringEvents(workspaceId: string, filters: MeteringEventListFilters = {}) {
    const rows = await this.database()
      .select({ event: runtimeUsageMeteringEvents.event })
      .from(runtimeUsageMeteringEvents)
      .where(and(
        eq(runtimeUsageMeteringEvents.workspaceId, workspaceId),
        filters.principalId ? eq(runtimeUsageMeteringEvents.principalId, filters.principalId) : undefined,
        filters.types?.length ? inArray(runtimeUsageMeteringEvents.eventType, filters.types) : undefined,
        filters.from ? gte(runtimeUsageMeteringEvents.occurredAt, filters.from) : undefined,
        filters.to ? lt(runtimeUsageMeteringEvents.occurredAt, filters.to) : undefined,
        filters.before ? or(
          lt(runtimeUsageMeteringEvents.occurredAt, filters.before.recordedAt),
          and(
            eq(runtimeUsageMeteringEvents.occurredAt, filters.before.recordedAt),
            lt(runtimeUsageMeteringEvents.id, filters.before.id),
          ),
        ) : undefined,
      ))
      .orderBy(desc(runtimeUsageMeteringEvents.occurredAt), desc(runtimeUsageMeteringEvents.id))
      .limit(filters.limit ?? 2_147_483_647);
    return rows.map((row) => meteringEvent(row.event));
  }

  async findPricingSnapshots(input: Parameters<UsageRepository["findPricingSnapshots"]>[0]) {
    const rows = await this.database()
      .select({ snapshot: runtimePricingSnapshots.snapshot })
      .from(runtimePricingSnapshots)
      .where(
        and(
          eq(runtimePricingSnapshots.workspaceId, input.workspaceId),
          eq(runtimePricingSnapshots.source, "workspace_override"),
          eq(runtimePricingSnapshots.provider, input.provider),
          eq(runtimePricingSnapshots.providerOperation, input.providerOperation),
          eq(runtimePricingSnapshots.model, input.model),
        ),
      )
      .orderBy(
        desc(runtimePricingSnapshots.effectiveFrom),
        desc(runtimePricingSnapshots.recordedAt),
        desc(runtimePricingSnapshots.id),
      );
    return rows.map((row) => snapshot(row.snapshot)).filter((value) =>
      value.effectiveFrom <= input.at && (!value.effectiveTo || value.effectiveTo > input.at));
  }

  async getSettlementRecords(workspaceId: string, settlementId: string) {
    const rows = await this.database()
      .select({ record: runtimeUsageRecords.record })
      .from(runtimeUsageRecords)
      .where(and(eq(runtimeUsageRecords.workspaceId, workspaceId), eq(runtimeUsageRecords.settlementId, settlementId)));
    return this.projectAttributions(rows.map((row) => usageRecord(row.record)));
  }

  async getSettlementValuations(workspaceId: string, settlementId: string) {
    const rows = await this.database()
      .select({ valuation: runtimeCostValuations.valuation })
      .from(runtimeCostValuations)
      .where(and(eq(runtimeCostValuations.workspaceId, workspaceId), eq(runtimeCostValuations.settlementId, settlementId)));
    return rows.map((row) => valuation(row.valuation));
  }
}
