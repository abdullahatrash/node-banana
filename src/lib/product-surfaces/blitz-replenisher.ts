import type { BlitzReplenishmentPolicy, BlitzReplenishmentSource } from "./blitz-replenishment-policy";
import { planBlitzReplenishment } from "./blitz-replenishment-policy";

export interface BlitzReplenishmentContext {
  policy: BlitzReplenishmentPolicy;
  sources: BlitzReplenishmentSource[];
  queuedCount: number;
  queuedRemixCount: number;
  existingSourceIds: Set<string>;
  prospectiveCommittedCents: number;
}

export interface ClaimedBlitzReplenishment {
  workspaceId: string;
  runId: string;
  leaseToken: string;
  sourceKey: string;
  invocation: "daily" | "manual";
  context: BlitzReplenishmentContext;
}

export interface BlitzReplenishmentRepository {
  claim(input: { workspaceId: string; campaignId: string; invocation: "daily" | "manual"; sourceKey: string; actorUserId: string; now: Date; leaseUntil: Date }): Promise<{ kind: "claimed"; run: ClaimedBlitzReplenishment } | { kind: "replayed"; created: number; stopReason: string } | { kind: "busy" }>;
  append(input: { run: ClaimedBlitzReplenishment; selected: BlitzReplenishmentSource[]; now: Date }): Promise<{ created: number; replayed: number }>;
  complete(input: { run: ClaimedBlitzReplenishment; created: number; stopReason: string; now: Date }): Promise<void>;
  fail(input: { run: ClaimedBlitzReplenishment; code: string; now: Date }): Promise<void>;
}

/** Queue replenishment is metadata-only and must never call a generation provider. */
export class BlitzReplenisher {
  constructor(private readonly repository: BlitzReplenishmentRepository, private readonly clock = () => new Date()) {}

  async replenish(input: { workspaceId: string; campaignId: string; invocation: "daily" | "manual"; actorUserId: string; sourceKey: string }) {
    const now = this.clock();
    const claim = await this.repository.claim({ ...input, now, leaseUntil: new Date(now.getTime() + 120_000) });
    if (claim.kind === "replayed") return { kind: "replayed" as const, created: claim.created, stopReason: claim.stopReason };
    if (claim.kind === "busy") return { kind: "busy" as const };
    try {
      const plan = planBlitzReplenishment({ ...claim.run.context, invocation: input.invocation, now });
      const inserted = await this.repository.append({ run: claim.run, selected: plan.selected, now: this.clock() });
      await this.repository.complete({ run: claim.run, created: inserted.created, stopReason: plan.stopReason, now: this.clock() });
      return { kind: "completed" as const, created: inserted.created, replayed: inserted.replayed, stopReason: plan.stopReason };
    } catch (error) {
      await this.repository.fail({ run: claim.run, code: error instanceof Error ? error.message : "BLITZ_REPLENISHMENT_FAILED", now: this.clock() });
      throw error;
    }
  }
}
