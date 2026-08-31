import type {
  CostValuation,
  MeteringEventListFilters,
  PricingSnapshot,
  UsageListFilters,
  UsageMeteringEvent,
  UsageArtifactAttribution,
  UsageRecord,
  UsageRepository,
  ValuationListFilters,
} from "./types";
import {
  MEMORY_TRANSACTION_PARTICIPANT,
  MemoryTransactionCoordinator,
  type MemoryTransactionParticipant,
  type MemoryTransactionToken,
} from "../memory-transaction";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function inInterval(value: Date, from?: Date, to?: Date): boolean {
  return (!from || value >= from) && (!to || value < to);
}

function beforePosition(
  at: Date,
  id: string,
  before?: { recordedAt: Date; id: string },
): boolean {
  return !before || at < before.recordedAt ||
    (at.getTime() === before.recordedAt.getTime() && id < before.id);
}

export class InMemoryUsageRepository
  implements UsageRepository, MemoryTransactionParticipant
{
  readonly [MEMORY_TRANSACTION_PARTICIPANT] = true as const;
  private memoryCoordinator = new MemoryTransactionCoordinator();
  readonly usageRecords = new Map<string, UsageRecord>();
  readonly valuations = new Map<string, CostValuation>();
  readonly pricingSnapshots = new Map<string, PricingSnapshot>();
  readonly meteringEvents = new Map<string, UsageMeteringEvent>();
  readonly attributions = new Map<string, UsageArtifactAttribution>();
  readonly receipts = new Map<string, string>();

  attachMemoryTransactionCoordinator(coordinator: MemoryTransactionCoordinator): void {
    this.memoryCoordinator = coordinator;
  }

  checkpointMemoryState(token: MemoryTransactionToken): unknown {
    if (!this.memoryCoordinator.isActive(token)) throw new TypeError("Inactive memory transaction.");
    return structuredClone({
      usageRecords: this.usageRecords,
      valuations: this.valuations,
      pricingSnapshots: this.pricingSnapshots,
      meteringEvents: this.meteringEvents,
      attributions: this.attributions,
      receipts: this.receipts,
    });
  }

  restoreMemoryState(token: MemoryTransactionToken, state: unknown): void {
    if (!this.memoryCoordinator.isActive(token)) throw new TypeError("Inactive memory transaction.");
    const snapshot = state as ReturnType<InMemoryUsageRepository["memoryState"]>;
    for (const [target, source] of [
      [this.usageRecords, snapshot.usageRecords],
      [this.valuations, snapshot.valuations],
      [this.pricingSnapshots, snapshot.pricingSnapshots],
      [this.meteringEvents, snapshot.meteringEvents],
      [this.attributions, snapshot.attributions],
      [this.receipts, snapshot.receipts],
    ] as Array<[Map<unknown, unknown>, Map<unknown, unknown>]>) {
      target.clear();
      for (const [key, value] of source) target.set(key, value);
    }
  }

  private memoryState() {
    return {
      usageRecords: new Map(this.usageRecords), valuations: new Map(this.valuations),
      pricingSnapshots: new Map(this.pricingSnapshots), meteringEvents: new Map(this.meteringEvents),
      attributions: new Map(this.attributions), receipts: new Map(this.receipts),
    };
  }

  private withAuthority<T>(
    token: MemoryTransactionToken | undefined,
    operation: (activeToken: MemoryTransactionToken) => Promise<T> | T,
  ): Promise<T> {
    return this.memoryCoordinator.isActive(token)
      ? Promise.resolve(operation(token!))
      : this.memoryCoordinator.runExclusive((activeToken) =>
          Promise.resolve(operation(activeToken)));
  }

  private append(input: {
    receiptId: string;
    requestDigest: string;
    records: UsageRecord[];
    pricingSnapshots: PricingSnapshot[];
    valuation: CostValuation;
    events: UsageMeteringEvent[];
  }): "created" | "replayed" | "conflict" {
    const found = this.receipts.get(input.receiptId);
    if (found) return found === input.requestDigest ? "replayed" : "conflict";
    for (const record of input.records) {
      const existing = this.usageRecords.get(record.id);
      if (existing) return "conflict";
      if (record.supersedesUsageRecordId) {
        const prior = this.usageRecords.get(record.supersedesUsageRecordId);
        if (
          !prior ||
          prior.binding.workspaceId !== record.binding.workspaceId ||
          prior.settlementId !== record.settlementId ||
          prior.dimension !== record.dimension ||
          prior.unit !== record.unit ||
          [...this.usageRecords.values()].some(
            (candidate) => candidate.supersedesUsageRecordId === prior.id,
          )
        ) return "conflict";
      } else if ([...this.usageRecords.values()].some(
        (candidate) =>
          candidate.settlementId === record.settlementId &&
          candidate.dimension === record.dimension &&
          candidate.unit === record.unit &&
          candidate.supersedesUsageRecordId === null,
      )) return "conflict";
    }
    if (this.valuations.has(input.valuation.id)) return "conflict";
    if (input.pricingSnapshots.some((snapshot) => {
      const existing = this.pricingSnapshots.get(snapshot.id);
      return existing && JSON.stringify(existing) !== JSON.stringify(snapshot);
    })) {
      return "conflict";
    }
    if (input.events.some((event) => this.meteringEvents.has(event.id))) {
      return "conflict";
    }
    if (input.valuation.supersedesCostValuationId) {
      const prior = this.valuations.get(input.valuation.supersedesCostValuationId);
      if (
        !prior ||
        prior.workspaceId !== input.valuation.workspaceId ||
        prior.settlementId !== input.valuation.settlementId ||
        [...this.valuations.values()].some(
          (candidate) => candidate.supersedesCostValuationId === prior.id,
        )
      ) return "conflict";
    }
    input.records.forEach((record) => this.usageRecords.set(record.id, copy(record)));
    input.pricingSnapshots.forEach((snapshot) => this.pricingSnapshots.set(snapshot.id, copy(snapshot)));
    this.valuations.set(input.valuation.id, copy(input.valuation));
    input.events.forEach((event) => this.meteringEvents.set(event.id, copy(event)));
    this.receipts.set(input.receiptId, input.requestDigest);
    return "created";
  }

  async appendSettlement(input: Parameters<UsageRepository["appendSettlement"]>[0], token?: MemoryTransactionToken) {
    return this.withAuthority(token, () => this.append({ ...input, receiptId: input.settlementId }));
  }

  async appendPlan(input: Parameters<UsageRepository["appendPlan"]>[0], token?: MemoryTransactionToken) {
    return this.withAuthority(token, () => this.append({ ...input, receiptId: input.receiptId }));
  }

  async appendCorrection(input: Parameters<UsageRepository["appendCorrection"]>[0], token?: MemoryTransactionToken) {
    return this.withAuthority(token, () => this.append({ ...input, receiptId: input.correctionId }));
  }

  async appendAttribution(input: Parameters<UsageRepository["appendAttribution"]>[0], token?: MemoryTransactionToken) {
    return this.withAuthority(token, () => this.appendAttributionUnlocked(input));
  }

  private appendAttributionUnlocked(input: Parameters<UsageRepository["appendAttribution"]>[0]) {
    const found = this.receipts.get(input.attributionId);
    if (found) return found === input.requestDigest ? "replayed" as const : "conflict" as const;
    const records = [...this.usageRecords.values()].filter(
      (record) => record.settlementId === input.settlementId,
    );
    if (
      !records.length ||
      records.some((record) =>
        record.binding.workspaceId !== input.event.workspaceId ||
        record.binding.runId !== input.attribution.runId ||
        record.binding.stepAttemptId !== input.attribution.stepAttemptId ||
        record.binding.effectKey !== input.attribution.effectKey,
      )
    ) {
      return "unavailable" as const;
    }
    if ([...this.attributions.values()].some(
      (value) => value.workspaceId === input.event.workspaceId && value.settlementId === input.settlementId,
    )) return "conflict" as const;
    if (this.attributions.has(input.attribution.id) || this.meteringEvents.has(input.event.id)) {
      return "conflict" as const;
    }
    this.attributions.set(input.attribution.id, copy(input.attribution));
    this.meteringEvents.set(input.event.id, copy(input.event));
    this.receipts.set(input.attributionId, input.requestDigest);
    return "created" as const;
  }

  appendAttributionPlan(input: Parameters<UsageRepository["appendAttributionPlan"]>[0], token?: MemoryTransactionToken) {
    return this.appendAttribution({
      attributionId: input.receiptId,
      requestDigest: input.requestDigest,
      settlementId: input.settlementId,
      artifactId: input.artifactId,
      attribution: input.attribution,
      event: input.event,
    }, token);
  }

  async appendBundle(input: {
    usagePlan?: Parameters<UsageRepository["appendPlan"]>[0] | null;
    attributionPlan?: Parameters<UsageRepository["appendAttributionPlan"]>[0] | null;
  }, token?: MemoryTransactionToken) {
    return this.withAuthority(token, (activeToken) =>
      this.appendBundleUnlocked(input, activeToken));
  }

  private async appendBundleUnlocked(input: {
    usagePlan?: Parameters<UsageRepository["appendPlan"]>[0] | null;
    attributionPlan?: Parameters<UsageRepository["appendAttributionPlan"]>[0] | null;
  }, token?: MemoryTransactionToken) {
    const snapshot = {
      usageRecords: new Map(this.usageRecords),
      valuations: new Map(this.valuations),
      pricingSnapshots: new Map(this.pricingSnapshots),
      meteringEvents: new Map(this.meteringEvents),
      attributions: new Map(this.attributions),
      receipts: new Map(this.receipts),
    };
    const restore = () => {
      this.usageRecords.clear();
      snapshot.usageRecords.forEach((value, key) => this.usageRecords.set(key, value));
      this.valuations.clear();
      snapshot.valuations.forEach((value, key) => this.valuations.set(key, value));
      this.pricingSnapshots.clear();
      snapshot.pricingSnapshots.forEach((value, key) => this.pricingSnapshots.set(key, value));
      this.meteringEvents.clear();
      snapshot.meteringEvents.forEach((value, key) => this.meteringEvents.set(key, value));
      this.attributions.clear();
      snapshot.attributions.forEach((value, key) => this.attributions.set(key, value));
      this.receipts.clear();
      snapshot.receipts.forEach((value, key) => this.receipts.set(key, value));
    };
    let created = false;
    if (input.usagePlan) {
      const result = await this.appendPlan(input.usagePlan, token);
      if (result === "conflict") {
        restore();
        return result;
      }
      created ||= result === "created";
    }
    if (input.attributionPlan) {
      const result = await this.appendAttributionPlan(input.attributionPlan, token);
      if (result !== "created" && result !== "replayed") {
        restore();
        return result;
      }
      created ||= result === "created";
    }
    return created ? "created" as const : "replayed" as const;
  }

  async getUsageRecord(workspaceId: string, id: string) {
    return this.withAuthority(undefined, () => {
      const found = this.usageRecords.get(id);
      if (found?.binding.workspaceId !== workspaceId) return null;
      const attribution = [...this.attributions.values()].find(
        (value) => value.settlementId === found.settlementId,
      );
      return { ...copy(found), directArtifactId: attribution?.artifactId ?? null };
    });
  }

  async listUsageRecords(workspaceId: string, filters: UsageListFilters = {}) {
    return this.withAuthority(undefined, () => [...this.usageRecords.values()]
      .filter((record) =>
        record.binding.workspaceId === workspaceId &&
        (!filters.runId || record.binding.runId === filters.runId) &&
        (!filters.stepAttemptId || record.binding.stepAttemptId === filters.stepAttemptId) &&
        (!filters.principalId || record.binding.principalId === filters.principalId) &&
        (!filters.provider || record.binding.provider === filters.provider) &&
        (!filters.model || record.binding.model === filters.model) &&
        inInterval(record.recordedAt, filters.from, filters.to) &&
        beforePosition(record.recordedAt, record.id, filters.before))
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.id.localeCompare(a.id))
      .map((record) => {
        const attribution = [...this.attributions.values()].find(
          (value) => value.settlementId === record.settlementId,
        );
        return { ...copy(record), directArtifactId: attribution?.artifactId ?? null };
      })
      .filter((record) => !filters.artifactId || record.directArtifactId === filters.artifactId)
      .slice(0, filters.limit ?? Number.MAX_SAFE_INTEGER));
  }

  async getCostValuation(workspaceId: string, id: string) {
    return this.withAuthority(undefined, () => {
      const found = this.valuations.get(id);
      return found?.workspaceId === workspaceId ? copy(found) : null;
    });
  }

  async listCostValuations(workspaceId: string, filters: ValuationListFilters = {}) {
    return this.withAuthority(undefined, () => [...this.valuations.values()]
      .filter((value) =>
        value.workspaceId === workspaceId &&
        (!filters.usageRecordId || value.usageRecordIds.includes(filters.usageRecordId)) &&
        (!filters.runId || value.runId === filters.runId) &&
        (!filters.principalId || value.principalId === filters.principalId) &&
        (!filters.pricingSource || value.pricingSource === filters.pricingSource) &&
        (!filters.currency || value.currency === filters.currency) &&
        inInterval(value.recordedAt, filters.from, filters.to) &&
        beforePosition(value.recordedAt, value.id, filters.before))
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, filters.limit ?? Number.MAX_SAFE_INTEGER)
      .map(copy));
  }

  async listMeteringEvents(workspaceId: string, filters: MeteringEventListFilters = {}) {
    return this.withAuthority(undefined, () => [...this.meteringEvents.values()]
      .filter((event) => event.workspaceId === workspaceId &&
        (!filters.principalId || event.principalId === filters.principalId) &&
        (!filters.types?.length || filters.types.includes(event.type)) &&
        inInterval(event.occurredAt, filters.from, filters.to) &&
        beforePosition(event.occurredAt, event.id, filters.before))
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, filters.limit ?? Number.MAX_SAFE_INTEGER)
      .map(copy));
  }

  async findPricingSnapshots(input: Parameters<UsageRepository["findPricingSnapshots"]>[0]) {
    return this.withAuthority(undefined, () => [...this.pricingSnapshots.values()].filter((snapshot) =>
      snapshot.workspaceId === input.workspaceId &&
      snapshot.source === "workspace_override" &&
      snapshot.provider === input.provider &&
      snapshot.providerOperation === input.providerOperation &&
      snapshot.model === input.model &&
      snapshot.effectiveFrom <= input.at &&
      (!snapshot.effectiveTo || snapshot.effectiveTo > input.at))
      .sort((a, b) =>
        b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
        b.recordedAt.getTime() - a.recordedAt.getTime() ||
        b.id.localeCompare(a.id),
      )
      .map(copy));
  }

  async getSettlementRecords(workspaceId: string, settlementId: string) {
    return this.withAuthority(undefined, () => [...this.usageRecords.values()].filter((record) =>
      record.binding.workspaceId === workspaceId && record.settlementId === settlementId).map(copy));
  }

  async getSettlementValuations(workspaceId: string, settlementId: string) {
    return this.withAuthority(undefined, () => [...this.valuations.values()].filter((value) =>
      value.workspaceId === workspaceId && value.settlementId === settlementId).map(copy));
  }
}
