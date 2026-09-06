import { and, eq } from "drizzle-orm";
import { creatorPersonas, creatorPersonaTrainingJobs } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import type { OperationControlAdapter } from "@/lib/agent-runtime/operation-status/controls";
import type { GenerationBudgetAuthority } from "@/lib/model-routing/budget-authority";

type Db = ReturnType<typeof getDb>;

export class PersonaTrainingOperationControl implements OperationControlAdapter {
  readonly supportsCancel = true;
  readonly supportsRetry = false;
  constructor(private readonly database: Db, private readonly budgets?: GenerationBudgetAuthority, private readonly now = () => new Date()) {}
  async cancel(operation: Parameters<OperationControlAdapter["cancel"]>[0]) {
    const result = await this.database.transaction(async (tx) => {
      const [job] = await tx.select().from(creatorPersonaTrainingJobs).where(and(eq(creatorPersonaTrainingJobs.workspaceId, operation.workspaceId), eq(creatorPersonaTrainingJobs.id, operation.resourceId))).limit(1);
      if (!job) return { kind: "unavailable" as const };
      if (job.state === "cancelled") return { kind: "confirmed_cancelled" as const, releasePreStart: !job.providerJobRef };
      if (["succeeded", "failed_known"].includes(job.state)) return { kind: "conflict" as const };
      if (job.providerJobRef || ["running", "waiting_provider", "outcome_unknown"].includes(job.state)) return { kind: "outcome_unknown" as const };
      const now = this.now();
      const updated = await tx.update(creatorPersonaTrainingJobs).set({ state: "cancelled", updatedAt: now }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, operation.workspaceId), eq(creatorPersonaTrainingJobs.id, operation.resourceId), eq(creatorPersonaTrainingJobs.state, job.state))).returning({ id: creatorPersonaTrainingJobs.id });
      if (!updated[0]) return { kind: "conflict" as const };
      await tx.update(creatorPersonas).set({ state: "ready_to_train", revision: job.personaRevision + 1, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, operation.workspaceId), eq(creatorPersonas.id, job.personaId), eq(creatorPersonas.state, "training"), eq(creatorPersonas.revision, job.personaRevision)));
      return { kind: "confirmed_cancelled" as const, releasePreStart: true };
    });
    if (result.kind === "confirmed_cancelled" && "releasePreStart" in result && result.releasePreStart) await this.budgets?.release({ workspaceId: operation.workspaceId, intentId: `persona-training:${operation.resourceId}`, at: this.now() });
    return result.kind === "confirmed_cancelled" ? { kind: result.kind } : result;
  }
  async retry() { return { kind: "unavailable" as const }; }
}
