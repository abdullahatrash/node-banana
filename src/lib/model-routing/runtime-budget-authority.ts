import { and, eq, isNull, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { runtimeBudgetPeriods, runtimeBudgetPolicies, runtimeBudgetPolicyRevisions, runtimeBudgetReservations, runtimeSpendControls } from "@/lib/db/schema";
import { budgetPeriodWindow } from "@/lib/agent-runtime/budgets/period";
import { runtimeCommittedAmountSql } from "@/lib/agent-runtime/budgets/committed-spend";
import { modelGenerationBudgetReservations } from "./db-schema";
import type { GenerationBudgetAuthority } from "./budget-authority";
import { quoteTotalUsd } from "./pricing";

type Db = ReturnType<typeof getDb>;

/**
 * Generation-specific admission on the Workspace budget mutex. Workflow budget
 * rows cannot be reused because their FK deliberately requires a workflow run.
 */
export class RuntimeGenerationBudgetAuthority implements GenerationBudgetAuthority {
  constructor(private readonly database: () => Db) {}
  async reserve(input: Parameters<GenerationBudgetAuthority["reserve"]>[0]) {
    try {
      return await this.database().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-budget-spend:${input.workspaceId}`}, 0))`);
        const [existing] = await tx.select().from(modelGenerationBudgetReservations).where(and(eq(modelGenerationBudgetReservations.workspaceId, input.workspaceId), eq(modelGenerationBudgetReservations.intentId, input.intentId))).limit(1);
        if (existing) return Number(existing.quotedAmountUsd) === quoteTotalUsd(input.quote) && existing.status !== "released" ? { kind: "reserved" as const, reservationIds: [`generation-budget:${input.workspaceId}:${input.intentId}`], disposition: "replayed" as const } : { kind: "unavailable" as const, code: "BUDGET_RESERVATION_CONFLICT" };
        const [spendControl] = await tx.select({ suspended: runtimeSpendControls.suspended }).from(runtimeSpendControls).where(eq(runtimeSpendControls.workspaceId, input.workspaceId)).limit(1);
        if (spendControl?.suspended) return { kind: "denied" as const, code: "EMERGENCY_SPEND_SUSPENDED" };
        const [policy] = await tx.select({ id: runtimeBudgetPolicies.id, revisionId: runtimeBudgetPolicies.currentRevisionId, currency: runtimeBudgetPolicies.currency, period: runtimeBudgetPolicies.period, timezone: runtimeBudgetPolicies.timezone, hardLimit: runtimeBudgetPolicyRevisions.hardLimit }).from(runtimeBudgetPolicies).innerJoin(runtimeBudgetPolicyRevisions, and(eq(runtimeBudgetPolicyRevisions.workspaceId, runtimeBudgetPolicies.workspaceId), eq(runtimeBudgetPolicyRevisions.id, runtimeBudgetPolicies.currentRevisionId))).where(and(eq(runtimeBudgetPolicies.workspaceId, input.workspaceId), eq(runtimeBudgetPolicies.status, "active"), eq(runtimeBudgetPolicies.scope, "workspace"), isNull(runtimeBudgetPolicies.principalId))).limit(1);
        if (!policy || policy.currency !== "USD") return { kind: "unavailable" as const, code: "WORKSPACE_USD_BUDGET_POLICY_UNAVAILABLE" };
        const period = budgetPeriodWindow(policy.period as "calendar_day" | "calendar_week" | "calendar_month" | "lifetime", policy.timezone, input.at);
        const endMatches = period.endsAt === null ? isNull(runtimeBudgetPeriods.endsAt) : eq(runtimeBudgetPeriods.endsAt, period.endsAt);
        const [runtime] = await tx.select({ total: runtimeCommittedAmountSql() }).from(runtimeBudgetReservations).innerJoin(runtimeBudgetPeriods, and(eq(runtimeBudgetPeriods.workspaceId, runtimeBudgetReservations.workspaceId), eq(runtimeBudgetPeriods.id, runtimeBudgetReservations.periodId))).where(and(eq(runtimeBudgetReservations.workspaceId, input.workspaceId), eq(runtimeBudgetReservations.policyId, policy.id), eq(runtimeBudgetPeriods.startsAt, period.startsAt), endMatches));
        const modelEndMatches = period.endsAt === null ? isNull(modelGenerationBudgetReservations.periodEndsAt) : eq(modelGenerationBudgetReservations.periodEndsAt, period.endsAt);
        const [generation] = await tx.select({ total: sql<string>`coalesce(sum(case when ${modelGenerationBudgetReservations.status} = 'settled' then coalesce(${modelGenerationBudgetReservations.actualAmountUsd}, ${modelGenerationBudgetReservations.quotedAmountUsd}) when ${modelGenerationBudgetReservations.status} in ('held','outcome_unknown') then ${modelGenerationBudgetReservations.quotedAmountUsd} else 0 end), 0)::text` }).from(modelGenerationBudgetReservations).where(and(eq(modelGenerationBudgetReservations.workspaceId, input.workspaceId), eq(modelGenerationBudgetReservations.policyId, policy.id), eq(modelGenerationBudgetReservations.periodStartsAt, period.startsAt), modelEndMatches));
        const amount = quoteTotalUsd(input.quote);
        if (Number(runtime?.total ?? 0) + Number(generation?.total ?? 0) + amount > Number(policy.hardLimit) + Number.EPSILON) return { kind: "denied" as const, code: "BUDGET_LIMIT_EXCEEDED" };
        await tx.insert(modelGenerationBudgetReservations).values({ workspaceId: input.workspaceId, intentId: input.intentId, policyId: policy.id, policyRevisionId: policy.revisionId, periodStartsAt: period.startsAt, periodEndsAt: period.endsAt, amountUsd: amount.toFixed(6), quotedAmountUsd: amount.toFixed(6), actualAmountUsd: null, releasedAmountUsd: "0", status: "held", createdAt: input.at, updatedAt: input.at });
        return { kind: "reserved" as const, reservationIds: [`generation-budget:${input.workspaceId}:${input.intentId}`], disposition: "created" as const };
      });
    } catch { return { kind: "unavailable" as const, code: "BUDGET_UNAVAILABLE" }; }
  }
  async release(input: { workspaceId: string; intentId: string; at: Date }) {
    await this.database().update(modelGenerationBudgetReservations).set({ status: "released", actualAmountUsd: "0", releasedAmountUsd: sql`${modelGenerationBudgetReservations.quotedAmountUsd}`, updatedAt: input.at }).where(and(eq(modelGenerationBudgetReservations.workspaceId, input.workspaceId), eq(modelGenerationBudgetReservations.intentId, input.intentId), eq(modelGenerationBudgetReservations.status, "held")));
  }
}
