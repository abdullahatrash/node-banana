import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { runtimeOperations } from "@/lib/agent-runtime/operation-status/db-schema";
import type { OperationStatusService } from "@/lib/agent-runtime/operation-status/service";
import type { OperationState } from "@/lib/agent-runtime/operation-status/types";
import { modelProviderEffectClaims } from "./db-schema";
import { PostgresModelRoutingRepository } from "./postgres-repository";
import type { ReplicatePredictionAdapter, ReplicateExecutionResult } from "./replicate-contract";
import type { DurableProviderCredentialRef } from "@/lib/byok/repository";
import { settleGenerationSpend } from "./generation-spend";
import { quoteTotalUsd } from "./pricing";

type Db = ReturnType<typeof getDb>;

export async function recoverReplicatePredictions(input: { database: Db; operations: OperationStatusService; adapterFor(workspaceId: string, credentialRef: DurableProviderCredentialRef): Promise<ReplicatePredictionAdapter>; now?: () => Date; limit?: number }) {
  const at = (input.now ?? (() => new Date()))(); const owner = randomUUID(); const leaseUntil = new Date(at.getTime() + 50_000);
  const claimed = await input.database.transaction(async (tx) => {
    const rows = await tx.select().from(modelProviderEffectClaims).where(and(or(and(eq(modelProviderEffectClaims.state, "claimed"), lte(modelProviderEffectClaims.claimExpiresAt, at)), and(inArray(modelProviderEffectClaims.state, ["submitted", "outcome_unknown"]), lte(modelProviderEffectClaims.nextPollAt, at))), or(isNull(modelProviderEffectClaims.leaseExpiresAt), lte(modelProviderEffectClaims.leaseExpiresAt, at)))).orderBy(asc(modelProviderEffectClaims.nextPollAt)).limit(input.limit ?? 20).for("update", { skipLocked: true });
    for (const row of rows) await tx.update(modelProviderEffectClaims).set({ leaseOwner: owner, leaseExpiresAt: leaseUntil, updatedAt: at }).where(and(eq(modelProviderEffectClaims.workspaceId, row.workspaceId), eq(modelProviderEffectClaims.intentId, row.intentId)));
    return rows;
  });
  const routing = new PostgresModelRoutingRepository(() => input.database);
  const summary = { claimed: claimed.length, waiting: 0, terminal: 0, unknown: 0, failed: 0 };
  for (const row of claimed) {
    try {
      const intent = await routing.getIntent(row.workspaceId, row.intentId); if (!intent) { summary.failed++; continue; }
      if (!row.predictionId) {
        summary.unknown++;
        await input.database.update(modelProviderEffectClaims).set({ state: "outcome_unknown", providerStatus: "submit_identity_lost", nextPollAt: new Date(at.getTime() + 24 * 60 * 60_000), leaseOwner: null, leaseExpiresAt: null, updatedAt: at }).where(and(eq(modelProviderEffectClaims.workspaceId, row.workspaceId), eq(modelProviderEffectClaims.intentId, row.intentId), eq(modelProviderEffectClaims.leaseOwner, owner)));
        await projectGenerationOperation(input.database, input.operations, { workspaceId: row.workspaceId, intentId: row.intentId, predictionId: null, pollAttempt: row.pollAttempts + 1 }, { state: "outcome_unknown", predictionId: null, code: "SUBMISSION_IDENTITY_LOST" });
        await settleGenerationSpend({ database: input.database, workspaceId: row.workspaceId, intentId: row.intentId, outcome: { kind: "cost_unknown" }, quotedAmountUsd: quoteTotalUsd(intent.quote), at });
        continue;
      }
      if (!row.credentialRef) throw new Error("DURABLE_PROVIDER_CREDENTIAL_REF_MISSING");
      const result = await (await input.adapterFor(row.workspaceId, row.credentialRef)).poll(intent, row.predictionId);
      await projectGenerationOperation(input.database, input.operations, { workspaceId: row.workspaceId, intentId: row.intentId, predictionId: row.predictionId, pollAttempt: row.pollAttempts + 1 }, result);
      if (result.state === "waiting_provider") {
        summary.waiting++;
        await input.database.update(modelProviderEffectClaims).set({ providerStatus: "processing", pollAttempts: row.pollAttempts + 1, nextPollAt: new Date(at.getTime() + Math.min(60_000, 2_000 * 2 ** Math.min(row.pollAttempts, 5))), leaseOwner: null, leaseExpiresAt: null, updatedAt: at }).where(and(eq(modelProviderEffectClaims.workspaceId, row.workspaceId), eq(modelProviderEffectClaims.intentId, row.intentId), eq(modelProviderEffectClaims.leaseOwner, owner)));
      } else {
        const disposition = recoveryDisposition(result); const terminal = disposition.operationState; summary.terminal++;
        await input.database.update(modelProviderEffectClaims).set({ state: disposition.effectState, providerStatus: result.state, pollAttempts: row.pollAttempts + 1, leaseOwner: null, leaseExpiresAt: null, updatedAt: at }).where(and(eq(modelProviderEffectClaims.workspaceId, row.workspaceId), eq(modelProviderEffectClaims.intentId, row.intentId), eq(modelProviderEffectClaims.leaseOwner, owner)));
        const outcome = terminal === "succeeded"
          ? { kind: "succeeded" as const, actualAmountUsd: quoteTotalUsd(intent.quote) }
          : result.state === "failed_known"
            ? { kind: "failed_known" as const }
            : result.state === "aborted_pre_start"
              ? { kind: "pre_start_cancelled" as const }
              : { kind: "cost_unknown" as const };
        await settleGenerationSpend({ database: input.database, workspaceId: row.workspaceId, intentId: row.intentId, outcome, quotedAmountUsd: quoteTotalUsd(intent.quote), at });
      }
    } catch { summary.failed++; await input.database.update(modelProviderEffectClaims).set({ state: "outcome_unknown", providerStatus: "transport_lost", nextPollAt: new Date(at.getTime() + 60_000), leaseOwner: null, leaseExpiresAt: null, updatedAt: at }).where(and(eq(modelProviderEffectClaims.workspaceId, row.workspaceId), eq(modelProviderEffectClaims.intentId, row.intentId), eq(modelProviderEffectClaims.leaseOwner, owner))); await settleGenerationSpend({ database: input.database, workspaceId: row.workspaceId, intentId: row.intentId, outcome: { kind: "cost_unknown" }, quotedAmountUsd: 0, at }); }
  }
  return summary;
}

async function projectGenerationOperation(database: Db, operations: OperationStatusService, identity: { workspaceId: string; intentId: string; predictionId: string | null; pollAttempt: number }, result: ReplicateExecutionResult) {
  const [operation] = await database.select().from(runtimeOperations).where(and(eq(runtimeOperations.workspaceId, identity.workspaceId), eq(runtimeOperations.kind, "generation"), eq(runtimeOperations.resourceId, identity.intentId))).limit(1);
  if (!operation || operation.state === "succeeded" || operation.state === "failed_known" || operation.state === "cancelled") return;
  const target = recoveryDisposition(result).operationState;
  await operations.transition({ workspaceId: identity.workspaceId, operationId: operation.id, expectedRevision: operation.revision, to: target, reasonCode: `generation.provider_reconciled_${target}`, actor: { type: "system", service: "replicate-recovery" }, metadata: { predictionId: identity.predictionId, providerState: result.state, nextAction: result.state === "waiting_provider" ? "poll_provider" : result.state === "outcome_unknown" ? "reconcile_provider" : "none", ...(result.state === "succeeded" ? { artifactIds: result.artifactIds, artifactCount: result.artifactIds.length, textOutputIds: result.textOutputIds, textOutputCount: result.textOutputIds.length } : {}) }, idempotencyKey: `replicate-recovery:${identity.intentId}:${identity.pollAttempt}:${target}` });
}

export function recoveryDisposition(result: ReplicateExecutionResult): { operationState: OperationState; effectState: "submitted" | "outcome_unknown" | "succeeded" | "failed_known" | "cancelled"; budgetState: "held" | "released" | "settled" | "outcome_unknown" } {
  if (result.state === "waiting_provider") return { operationState: "waiting_provider", effectState: "submitted", budgetState: "held" };
  if (result.state === "succeeded") return { operationState: "succeeded", effectState: "succeeded", budgetState: "settled" };
  if (result.state === "failed_known") return { operationState: "failed_known", effectState: "failed_known", budgetState: "outcome_unknown" };
  if (result.state === "aborted_pre_start") return { operationState: "cancelled", effectState: "cancelled", budgetState: "released" };
  if (result.state === "cancelled") return { operationState: "cancelled", effectState: "cancelled", budgetState: "outcome_unknown" };
  return { operationState: "outcome_unknown", effectState: "outcome_unknown", budgetState: "outcome_unknown" };
}
