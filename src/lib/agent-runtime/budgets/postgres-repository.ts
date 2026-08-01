import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { getDb } from "@/lib/db";
import { appendContractEvidenceVersion } from "../contract-evidence/postgres-repository";
import { projectBudgetReservationContractEvidence } from "../contract-evidence/projectors";
import {
  credentialSlots,
  credentialSpendEvents,
  credentialSpendGrants,
  runtimeBudgetAdminReceipts,
  runtimeBudgetAttemptAllocations,
  runtimeBudgetAttemptReservationAllocations,
  runtimeBudgetAdmissionGrants,
  runtimeBudgetAdmissions,
  runtimeBudgetPeriods,
  runtimeBudgetPolicies,
  runtimeBudgetPolicyRevisions,
  runtimeBudgetReservationEvents,
  runtimeBudgetReservations,
  runtimeBudgetSettlementReceipts,
  runtimeCostValuations,
  runtimeFxSnapshots,
  runtimeSpendControlEvents,
  runtimeSpendControls,
  runtimeWorkspacePricingOverrideRevisions,
  runtimeWorkspacePricingOverrides,
  workflowRuns,
} from "@/lib/db/schema";
import { addDecimals, canonicalDecimal, multiplyDecimals } from "../usage/decimal";
import type {
  BudgetAdmissionPlan,
  BudgetAttemptAllocationInput,
  BudgetPolicy,
  BudgetPolicyRevision,
  BudgetRepository,
  BudgetReservation,
  BudgetSettlementPlan,
  WorkspacePricingOverride,
} from "./types";
import type { FxRateReader } from "./service";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Result = "created" | "replayed" | "conflict" | "unavailable";

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function compareDecimals(left: string, right: string): number {
  const [aw, af = ""] = canonicalDecimal(left).split(".");
  const [bw, bf = ""] = canonicalDecimal(right).split(".");
  const scale = Math.max(af.length, bf.length);
  const a = BigInt(`${aw}${af.padEnd(scale, "0")}`);
  const b = BigInt(`${bw}${bf.padEnd(scale, "0")}`);
  return a < b ? -1 : a > b ? 1 : 0;
}

function subtractDecimals(left: string, right: string): string {
  if (compareDecimals(left, right) <= 0) return "0";
  const [aw, af = ""] = canonicalDecimal(left).split(".");
  const [bw, bf = ""] = canonicalDecimal(right).split(".");
  const scale = Math.max(af.length, bf.length);
  const value = BigInt(`${aw}${af.padEnd(scale, "0")}`) - BigInt(`${bw}${bf.padEnd(scale, "0")}`);
  if (!scale) return value.toString();
  const digits = value.toString().padStart(scale + 1, "0");
  return canonicalDecimal(`${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
}

function usdCents(amount: string): number | null {
  const [whole, fraction = ""] = canonicalDecimal(amount).split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  const rounded = fraction.slice(2).replace(/0/g, "") ? cents + BigInt(1) : cents;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}

async function lockWorkspaceSpendGate(tx: Db | Tx, workspaceId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-budget-spend:${workspaceId}`}, 0))`,
  );
}

async function boundedGrantCommittedCents(tx: Db | Tx, grantId: string) {
  const [projection] = await tx.select({
    runtimeHeldCents: sql<number>`coalesce((
      select sum(${runtimeBudgetAdmissionGrants.reservedCents})
      from ${runtimeBudgetAdmissionGrants}
      inner join ${workflowRuns}
        on ${workflowRuns.workspaceId} = ${runtimeBudgetAdmissionGrants.workspaceId}
        and ${workflowRuns.id} = ${runtimeBudgetAdmissionGrants.runId}
      where ${runtimeBudgetAdmissionGrants.grantId} = ${grantId}
        and ${workflowRuns.state} in ('accepted', 'running', 'waiting', 'outcome_unknown')
    ), 0)::integer`,
    externalLegacyCents: sql<number>`coalesce((
      select sum(${credentialSpendEvents.priceCeilingCents})
      from ${credentialSpendEvents}
      where ${credentialSpendEvents.spendGrantId} = ${grantId}
        and ${credentialSpendEvents.status} in ('pending', 'completed', 'unknown')
        and not exists (
          select 1
          from ${runtimeBudgetAttemptAllocations}
          inner join ${workflowRuns}
            on ${workflowRuns.workspaceId} = ${runtimeBudgetAttemptAllocations.workspaceId}
            and ${workflowRuns.id} = ${runtimeBudgetAttemptAllocations.runId}
          inner join ${runtimeBudgetAdmissionGrants}
            on ${runtimeBudgetAdmissionGrants.workspaceId} = ${runtimeBudgetAttemptAllocations.workspaceId}
            and ${runtimeBudgetAdmissionGrants.runId} = ${runtimeBudgetAttemptAllocations.runId}
            and ${runtimeBudgetAdmissionGrants.grantId} = ${runtimeBudgetAttemptAllocations.grantId}
          where ${runtimeBudgetAttemptAllocations.workspaceId} = ${credentialSpendEvents.workspaceId}
            and ${runtimeBudgetAttemptAllocations.grantId} = ${credentialSpendEvents.spendGrantId}
            and ${runtimeBudgetAttemptAllocations.credentialEffectRef} = ${credentialSpendEvents.effectRef}
            and ${workflowRuns.state} in ('accepted', 'running', 'waiting', 'outcome_unknown')
        )
    ), 0)::integer`,
  }).from(credentialSpendGrants)
    .where(eq(credentialSpendGrants.id, grantId))
    .limit(1);
  return Number(projection?.runtimeHeldCents ?? 0) +
    Number(projection?.externalLegacyCents ?? 0);
}

function policyFrom(row: typeof runtimeBudgetPolicies.$inferSelect): BudgetPolicy {
  return {
    ...structuredClone(row.policy),
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
  };
}

function revisionFrom(row: typeof runtimeBudgetPolicyRevisions.$inferSelect): BudgetPolicyRevision {
  return { ...structuredClone(row.revisionRecord), createdAt: date(row.createdAt) };
}

function overrideFrom(row: typeof runtimeWorkspacePricingOverrides.$inferSelect): WorkspacePricingOverride {
  return {
    ...structuredClone(row.override),
    effectiveFrom: date(row.effectiveFrom),
    createdAt: date(row.createdAt),
    revokedAt: row.revokedAt ? date(row.revokedAt) : null,
  };
}

function reservationFrom(row: typeof runtimeBudgetReservations.$inferSelect): BudgetReservation {
  return {
    ...structuredClone(row.reservation),
    heldAmount: row.heldAmount,
    settledAmount: row.settledAmount,
    releasedAmount: row.releasedAmount,
    state: row.state as BudgetReservation["state"],
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
    period: {
      ...row.reservation.period,
      startsAt: date(row.reservation.period.startsAt),
      endsAt: row.reservation.period.endsAt ? date(row.reservation.period.endsAt) : null,
    },
  };
}

function periodId(reservation: BudgetReservation): string {
  return `budget_period_${canonicalDigest({
    policyId: reservation.policyId,
    startsAt: reservation.period.startsAt.toISOString(),
    endsAt: reservation.period.endsAt?.toISOString() ?? null,
  }).slice(7, 39)}`;
}

function eventId(kind: string, value: unknown): string {
  return `budget_event_${canonicalDigest({ kind, value }).slice(7, 39)}`;
}

async function appendBudgetReservationEvidence(
  tx: Tx,
  reservation: BudgetReservation,
): Promise<void> {
  await appendContractEvidenceVersion(tx, {
    workspaceId: reservation.workspaceId,
    resourceKind: "budget_reservation",
    resourceId: reservation.id,
    canonicalSource: reservation,
    projectionKind: "budget_summary",
    projection: projectBudgetReservationContractEvidence(reservation),
    createdAt: reservation.updatedAt,
  });
}

function pricingIdentity(item: Pick<WorkspacePricingOverride,
  "workspaceId" | "provider" | "providerOperation" | "model" | "serviceTier" | "dimension"
>): string {
  return [item.workspaceId, item.provider, item.providerOperation, item.model, item.serviceTier, item.dimension]
    .join("\u0000");
}

function selectedOverrides(items: WorkspacePricingOverride[]): WorkspacePricingOverride[] {
  const selected = new Map<string, WorkspacePricingOverride>();
  for (const item of [...items].sort((left, right) =>
    right.effectiveFrom.getTime() - left.effectiveFrom.getTime() ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    right.id.localeCompare(left.id))) {
    const key = pricingIdentity(item);
    if (!selected.has(key)) selected.set(key, item);
  }
  return [...selected.values()];
}

export class DrizzleBudgetRepository implements BudgetRepository<Tx> {
  constructor(private readonly database: () => Db) {}

  async getAdminReceipt(input: {
    workspaceId: string;
    kind: "policy_revision" | "pricing_override";
    idempotencyKey: string;
  }) {
    const [row] = await this.database()
      .select({
        requestDigest: runtimeBudgetAdminReceipts.requestDigest,
        resourceId: runtimeBudgetAdminReceipts.resourceId,
      })
      .from(runtimeBudgetAdminReceipts)
      .where(and(
        eq(runtimeBudgetAdminReceipts.workspaceId, input.workspaceId),
        eq(runtimeBudgetAdminReceipts.kind, input.kind),
        eq(runtimeBudgetAdminReceipts.idempotencyKey, input.idempotencyKey),
      ))
      .limit(1);
    return row ?? null;
  }

  async getPolicyRevision(input: { workspaceId: string; revisionId: string }) {
    const [row] = await this.database()
      .select({ policy: runtimeBudgetPolicies, revision: runtimeBudgetPolicyRevisions })
      .from(runtimeBudgetPolicyRevisions)
      .innerJoin(runtimeBudgetPolicies, and(
        eq(runtimeBudgetPolicies.workspaceId, runtimeBudgetPolicyRevisions.workspaceId),
        eq(runtimeBudgetPolicies.id, runtimeBudgetPolicyRevisions.policyId),
      ))
      .where(and(
        eq(runtimeBudgetPolicyRevisions.workspaceId, input.workspaceId),
        eq(runtimeBudgetPolicyRevisions.id, input.revisionId),
      ))
      .limit(1);
    if (!row) return null;
    const revision = revisionFrom(row.revision);
    return {
      policy: {
        ...policyFrom(row.policy),
        status: "active" as const,
        currentRevisionId: revision.id,
        updatedAt: revision.createdAt,
      },
      revision,
    };
  }

  async getPricingOverride(input: { workspaceId: string; overrideId: string }) {
    const [row] = await this.database()
      .select()
      .from(runtimeWorkspacePricingOverrides)
      .where(and(
        eq(runtimeWorkspacePricingOverrides.workspaceId, input.workspaceId),
        eq(runtimeWorkspacePricingOverrides.id, input.overrideId),
      ))
      .limit(1);
    return row
      ? {
          ...overrideFrom(row),
          status: "active" as const,
          revokedAt: null,
          revokedByUserId: null,
        }
      : null;
  }

  async getEffectivePolicies(input: { workspaceId: string; principalId: string }) {
    const rows = await this.database().select({ policy: runtimeBudgetPolicies, revision: runtimeBudgetPolicyRevisions })
      .from(runtimeBudgetPolicies)
      .innerJoin(runtimeBudgetPolicyRevisions, and(
        eq(runtimeBudgetPolicyRevisions.workspaceId, runtimeBudgetPolicies.workspaceId),
        eq(runtimeBudgetPolicyRevisions.id, runtimeBudgetPolicies.currentRevisionId),
      ))
      .where(and(
        eq(runtimeBudgetPolicies.workspaceId, input.workspaceId),
        eq(runtimeBudgetPolicies.status, "active"),
        or(isNull(runtimeBudgetPolicies.principalId), eq(runtimeBudgetPolicies.principalId, input.principalId)),
      ));
    return rows.map((row) => ({ policy: policyFrom(row.policy), revision: revisionFrom(row.revision) }))
      .sort((a, b) => a.policy.scope.localeCompare(b.policy.scope));
  }

  async listPolicies(workspaceId: string) {
    const rows = await this.database().select({ policy: runtimeBudgetPolicies, revision: runtimeBudgetPolicyRevisions })
      .from(runtimeBudgetPolicies)
      .innerJoin(runtimeBudgetPolicyRevisions, and(
        eq(runtimeBudgetPolicyRevisions.workspaceId, runtimeBudgetPolicies.workspaceId),
        eq(runtimeBudgetPolicyRevisions.id, runtimeBudgetPolicies.currentRevisionId),
      ))
      .where(eq(runtimeBudgetPolicies.workspaceId, workspaceId));
    return rows.map((row) => ({ policy: policyFrom(row.policy), revision: revisionFrom(row.revision) }));
  }

  async appendPolicyRevision(input: { policy: BudgetPolicy; revision: BudgetPolicyRevision; requestDigest: string; idempotencyKey: string }) {
    return this.database().transaction(async (tx) => {
      const claimed = await tx.insert(runtimeBudgetAdminReceipts).values({
        workspaceId: input.policy.workspaceId, kind: "policy_revision", idempotencyKey: input.idempotencyKey,
        requestDigest: input.requestDigest, resourceId: input.revision.id, createdAt: input.revision.createdAt,
      }).onConflictDoNothing().returning({ resourceId: runtimeBudgetAdminReceipts.resourceId });
      if (!claimed[0]) {
        const [receipt] = await tx.select().from(runtimeBudgetAdminReceipts).where(and(
          eq(runtimeBudgetAdminReceipts.workspaceId, input.policy.workspaceId), eq(runtimeBudgetAdminReceipts.kind, "policy_revision"), eq(runtimeBudgetAdminReceipts.idempotencyKey, input.idempotencyKey),
        )).limit(1);
        return receipt?.requestDigest === input.requestDigest && receipt.resourceId === input.revision.id ? "replayed" as const : "conflict" as const;
      }
      const [existing] = await tx.select().from(runtimeBudgetPolicies)
        .where(and(eq(runtimeBudgetPolicies.workspaceId, input.policy.workspaceId), eq(runtimeBudgetPolicies.id, input.policy.id)))
        .for("update").limit(1);
      if (existing) {
        const [current] = await tx.select().from(runtimeBudgetPolicyRevisions).where(eq(runtimeBudgetPolicyRevisions.id, existing.currentRevisionId)).limit(1);
        if (!current || input.revision.revision !== current.revision + 1 || existing.principalId !== input.policy.principalId || existing.currency !== input.policy.currency || existing.period !== input.policy.period || existing.timezone !== input.policy.timezone) {
          tx.rollback();
        }
      } else if (input.revision.revision !== 1) {
        tx.rollback();
      }
      if (
        input.revision.policyId !== input.policy.id ||
        input.revision.workspaceId !== input.policy.workspaceId ||
        input.revision.principalId !== input.policy.principalId ||
        input.policy.currentRevisionId !== input.revision.id
      ) {
        tx.rollback();
      }
      if (input.policy.scope === "principal") {
        const [parent] = await tx.select({ policy: runtimeBudgetPolicies, revision: runtimeBudgetPolicyRevisions })
          .from(runtimeBudgetPolicies)
          .innerJoin(runtimeBudgetPolicyRevisions, and(
            eq(runtimeBudgetPolicyRevisions.workspaceId, runtimeBudgetPolicies.workspaceId),
            eq(runtimeBudgetPolicyRevisions.id, runtimeBudgetPolicies.currentRevisionId),
          ))
          .where(and(
            eq(runtimeBudgetPolicies.workspaceId, input.policy.workspaceId),
            isNull(runtimeBudgetPolicies.principalId),
            eq(runtimeBudgetPolicies.status, "active"),
          )).limit(1);
        const allowanceNarrows = input.revision.unknownPriceTreatment === "deny" || (
          parent?.revision.unknownPriceTreatment === "fixed_allowance" &&
          input.revision.unknownPriceAllowance !== null &&
          parent.revision.unknownPriceAllowance !== null &&
          compareDecimals(input.revision.unknownPriceAllowance, parent.revision.unknownPriceAllowance) <= 0
        );
        if (
          !parent || parent.policy.currency !== input.policy.currency || parent.policy.period !== input.policy.period ||
          parent.policy.timezone !== input.policy.timezone ||
          compareDecimals(input.revision.warningThreshold, parent.revision.warningThreshold) > 0 ||
          compareDecimals(input.revision.hardLimit, parent.revision.hardLimit) > 0 || !allowanceNarrows
        ) {
          tx.rollback();
        }
      }
      if (!existing) {
        await tx.insert(runtimeBudgetPolicies).values({
          id: input.policy.id, workspaceId: input.policy.workspaceId, principalId: input.policy.principalId, scope: input.policy.scope,
          currency: input.policy.currency, period: input.policy.period, timezone: input.policy.timezone, status: input.policy.status,
          currentRevisionId: input.policy.currentRevisionId, policy: input.policy, createdAt: input.policy.createdAt, updatedAt: input.policy.updatedAt,
        });
      }
      await tx.insert(runtimeBudgetPolicyRevisions).values({
        id: input.revision.id, workspaceId: input.revision.workspaceId, policyId: input.revision.policyId, principalId: input.revision.principalId,
        revision: input.revision.revision, warningThreshold: input.revision.warningThreshold, hardLimit: input.revision.hardLimit,
        unknownPriceTreatment: input.revision.unknownPriceTreatment, unknownPriceAllowance: input.revision.unknownPriceAllowance,
        createdByUserId: input.revision.createdByUserId, revisionRecord: input.revision, createdAt: input.revision.createdAt,
      });
      if (existing) {
        await tx.update(runtimeBudgetPolicies).set({ currentRevisionId: input.revision.id, status: input.policy.status, policy: input.policy, updatedAt: input.policy.updatedAt })
          .where(and(eq(runtimeBudgetPolicies.workspaceId, input.policy.workspaceId), eq(runtimeBudgetPolicies.id, input.policy.id)));
      }
      return "created" as const;
    }).catch(() => "conflict" as const);
  }

  async getCommittedAmount(input: { workspaceId: string; policyRevisionId: string; periodStartsAt: Date; periodEndsAt: Date | null }) {
    const [revision] = await this.database().select({ policyId: runtimeBudgetPolicyRevisions.policyId }).from(runtimeBudgetPolicyRevisions)
      .where(and(eq(runtimeBudgetPolicyRevisions.workspaceId, input.workspaceId), eq(runtimeBudgetPolicyRevisions.id, input.policyRevisionId))).limit(1);
    if (!revision) return "0";
    const endPredicate = input.periodEndsAt === null ? isNull(runtimeBudgetPeriods.endsAt) : eq(runtimeBudgetPeriods.endsAt, input.periodEndsAt);
    const [row] = await this.database().select({ committed: sql<string>`coalesce(sum(case when ${runtimeBudgetReservations.state} in ('held', 'outcome_unknown', 'held_unknown_cost') then ${runtimeBudgetReservations.settledAmount}::numeric + ${runtimeBudgetReservations.heldAmount}::numeric else ${runtimeBudgetReservations.settledAmount}::numeric end), 0)::text` })
      .from(runtimeBudgetReservations).innerJoin(runtimeBudgetPeriods, and(eq(runtimeBudgetPeriods.workspaceId, runtimeBudgetReservations.workspaceId), eq(runtimeBudgetPeriods.id, runtimeBudgetReservations.periodId)))
      .where(and(eq(runtimeBudgetReservations.workspaceId, input.workspaceId), eq(runtimeBudgetPeriods.policyId, revision.policyId), eq(runtimeBudgetPeriods.startsAt, input.periodStartsAt), endPredicate));
    return canonicalDecimal(row?.committed ?? "0");
  }

  async listActivePricingOverrides(input: { workspaceId: string; at: Date }) {
    const rows = await this.database().select().from(runtimeWorkspacePricingOverrides).where(and(eq(runtimeWorkspacePricingOverrides.workspaceId, input.workspaceId), eq(runtimeWorkspacePricingOverrides.status, "active"), sql`${runtimeWorkspacePricingOverrides.effectiveFrom} <= ${input.at}`));
    return selectedOverrides(rows.map(overrideFrom));
  }

  async listPricingOverrides(workspaceId: string) {
    return (await this.database().select().from(runtimeWorkspacePricingOverrides).where(eq(runtimeWorkspacePricingOverrides.workspaceId, workspaceId))).map(overrideFrom);
  }

  async appendPricingOverride(input: { override: WorkspacePricingOverride; requestDigest: string; idempotencyKey: string }) {
    return this.database().transaction(async (tx) => {
      const claimed = await tx.insert(runtimeBudgetAdminReceipts).values({ workspaceId: input.override.workspaceId, kind: "pricing_override", idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest, resourceId: input.override.id, createdAt: input.override.createdAt }).onConflictDoNothing().returning({ id: runtimeBudgetAdminReceipts.resourceId });
      if (!claimed[0]) {
        const [receipt] = await tx.select().from(runtimeBudgetAdminReceipts).where(and(eq(runtimeBudgetAdminReceipts.workspaceId, input.override.workspaceId), eq(runtimeBudgetAdminReceipts.kind, "pricing_override"), eq(runtimeBudgetAdminReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
        return receipt?.requestDigest === input.requestDigest && receipt.resourceId === input.override.id ? "replayed" as const : "conflict" as const;
      }
      await tx.insert(runtimeWorkspacePricingOverrides).values({ ...input.override, override: input.override });
      await tx.insert(runtimeWorkspacePricingOverrideRevisions).values({ id: eventId("pricing-created", input.override.id), workspaceId: input.override.workspaceId, overrideId: input.override.id, revision: 1, eventType: "created", override: input.override, actorUserId: input.override.createdByUserId, recordedAt: input.override.createdAt });
      return "created" as const;
    }).catch(() => "conflict" as const);
  }

  async revokePricingOverride(input: { workspaceId: string; overrideId: string; actorUserId: string; recordedAt: Date }) {
    return this.database().transaction(async (tx) => {
      const [row] = await tx.select().from(runtimeWorkspacePricingOverrides).where(and(eq(runtimeWorkspacePricingOverrides.workspaceId, input.workspaceId), eq(runtimeWorkspacePricingOverrides.id, input.overrideId))).for("update").limit(1);
      if (!row) return false;
      if (row.status === "revoked") return true;
      const value: WorkspacePricingOverride = { ...overrideFrom(row), status: "revoked", revokedAt: input.recordedAt, revokedByUserId: input.actorUserId };
      await tx.update(runtimeWorkspacePricingOverrides).set({ status: "revoked", revokedAt: input.recordedAt, revokedByUserId: input.actorUserId, override: value }).where(eq(runtimeWorkspacePricingOverrides.id, input.overrideId));
      await tx.insert(runtimeWorkspacePricingOverrideRevisions).values({ id: eventId("pricing-revoked", { id: input.overrideId, at: input.recordedAt.toISOString() }), workspaceId: input.workspaceId, overrideId: input.overrideId, revision: 2, eventType: "revoked", override: value, actorUserId: input.actorUserId, recordedAt: input.recordedAt });
      return true;
    });
  }

  async getCredentialGrantEvidence(input: { workspaceId: string; principalId: string; credentialProfileIds: string[]; credentialSlotIds: string[] }) {
    if (!input.credentialProfileIds.length && !input.credentialSlotIds.length) return [];
    const requestedCredential = or(
      ...(input.credentialProfileIds.length
        ? [inArray(credentialSpendGrants.profileId, input.credentialProfileIds)]
        : []),
      ...(input.credentialSlotIds.length
        ? [inArray(credentialSlots.id, input.credentialSlotIds)]
        : []),
    );
    const database = this.database();
    const rows = await database.select({ grant: credentialSpendGrants, slotId: credentialSlots.id })
      .from(credentialSpendGrants)
      .innerJoin(credentialSlots, and(eq(credentialSlots.workspaceId, credentialSpendGrants.workspaceId), eq(credentialSlots.profileId, credentialSpendGrants.profileId)))
      .where(and(eq(credentialSpendGrants.workspaceId, input.workspaceId), eq(credentialSpendGrants.principalId, input.principalId), eq(credentialSpendGrants.status, "active"), requestedCredential));
    return Promise.all(rows.map(async ({ grant, slotId }) => {
      const committed = String(await boundedGrantCommittedCents(database, grant.id));
      return {
        grantId: grant.id,
        credentialProfileId: grant.profileId,
        credentialSlotId: slotId,
        mode: grant.mode as "bounded" | "audited_unbounded",
        limit: grant.limitCents === null ? null : String(grant.limitCents),
        committed,
        available: grant.limitCents === null
          ? null
          : subtractDecimals(String(grant.limitCents), committed),
      };
    }));
  }

  async isSpendSuspended(workspaceId: string) {
    const [row] = await this.database().select({ suspended: runtimeSpendControls.suspended }).from(runtimeSpendControls).where(eq(runtimeSpendControls.workspaceId, workspaceId)).limit(1);
    return row?.suspended ?? false;
  }

  async setSpendSuspended(input: { workspaceId: string; suspended: boolean; reason: string; actorUserId: string; recordedAt: Date }) {
    await this.database().transaction(async (tx) => {
      await lockWorkspaceSpendGate(tx, input.workspaceId);
      const [current] = await tx.select().from(runtimeSpendControls).where(eq(runtimeSpendControls.workspaceId, input.workspaceId)).for("update").limit(1);
      if (
        current?.suspended === input.suspended &&
        current.reason === input.reason &&
        current.updatedByUserId === input.actorUserId
      ) return;
      const revision = (current?.revision ?? 0) + 1;
      await tx.insert(runtimeSpendControls).values({ workspaceId: input.workspaceId, suspended: input.suspended, revision, reason: input.reason, updatedByUserId: input.actorUserId, updatedAt: input.recordedAt }).onConflictDoUpdate({ target: runtimeSpendControls.workspaceId, set: { suspended: input.suspended, revision, reason: input.reason, updatedByUserId: input.actorUserId, updatedAt: input.recordedAt } });
      await tx.insert(runtimeSpendControlEvents).values({ id: eventId("spend-control", { workspaceId: input.workspaceId, revision }), workspaceId: input.workspaceId, revision, suspended: input.suspended, reason: input.reason, actorUserId: input.actorUserId, recordedAt: input.recordedAt });
    });
  }

  async commitAdmission(plan: BudgetAdmissionPlan, transaction?: Tx): Promise<Result> {
    const execute = async (tx: Tx): Promise<Result> => {
      await lockWorkspaceSpendGate(tx, plan.workspaceId);
      const [receipt] = await tx.select().from(runtimeBudgetAdmissions).where(and(eq(runtimeBudgetAdmissions.workspaceId, plan.workspaceId), eq(runtimeBudgetAdmissions.runId, plan.runId))).limit(1);
      if (receipt) return receipt.requestDigest === plan.requestDigest ? "replayed" : "conflict";
      const [control] = await tx.select().from(runtimeSpendControls).where(eq(runtimeSpendControls.workspaceId, plan.workspaceId)).for("update").limit(1);
      if (
        control?.suspended || !plan.reservations.length ||
        new Set(plan.reservations.map((item) => item.id)).size !== plan.reservations.length ||
        new Set(plan.reservations.map((item) => item.policyId)).size !== plan.reservations.length
      ) return "unavailable";
      const activeOverrideRows = await tx.select().from(runtimeWorkspacePricingOverrides)
        .where(and(
          eq(runtimeWorkspacePricingOverrides.workspaceId, plan.workspaceId),
          eq(runtimeWorkspacePricingOverrides.status, "active"),
          sql`${runtimeWorkspacePricingOverrides.effectiveFrom} <= current_timestamp`,
        ))
        .orderBy(
          asc(runtimeWorkspacePricingOverrides.provider),
          asc(runtimeWorkspacePricingOverrides.providerOperation),
          asc(runtimeWorkspacePricingOverrides.model),
          asc(runtimeWorkspacePricingOverrides.serviceTier),
          asc(runtimeWorkspacePricingOverrides.dimension),
        )
        .for("update");
      const activeOverrides = selectedOverrides(activeOverrideRows.map(overrideFrom));
      const pinnedIds = [...new Set(plan.stepExposures.flatMap((item) => item.pricingSnapshotIds))];
      const knownOverrideIds = pinnedIds.length
        ? new Set((await tx.select({ id: runtimeWorkspacePricingOverrides.id })
          .from(runtimeWorkspacePricingOverrides)
          .where(and(
            eq(runtimeWorkspacePricingOverrides.workspaceId, plan.workspaceId),
            inArray(runtimeWorkspacePricingOverrides.id, pinnedIds),
          ))).map((item) => item.id))
        : new Set<string>();
      for (const exposure of plan.stepExposures) {
        const applicable = selectedOverrides(activeOverrides.filter((item) =>
          item.provider === exposure.provider &&
          item.providerOperation === exposure.providerOperation &&
          item.model === exposure.model &&
          item.serviceTier === exposure.serviceTier));
        const expectedOverrideIds = exposure.pricingSnapshotIds
          .filter((id) => knownOverrideIds.has(id))
          .sort();
        if (
          applicable.length > 0 ||
          expectedOverrideIds.length > 0 ||
          exposure.pricingSource === "workspace_override"
        ) {
          const actualIds = applicable.map((item) => item.id).sort();
          if (canonicalDigest(actualIds) !== canonicalDigest(expectedOverrideIds)) {
            return "unavailable";
          }
        }
      }
      if (plan.fxSnapshotIds.length) {
        const fxRows = await tx.select({ id: runtimeFxSnapshots.id })
          .from(runtimeFxSnapshots)
          .where(inArray(runtimeFxSnapshots.id, [...new Set(plan.fxSnapshotIds)]));
        if (new Set(fxRows.map((item) => item.id)).size !== new Set(plan.fxSnapshotIds).size) {
          return "unavailable";
        }
      }
      const periods = plan.reservations.map((reservation) => ({ reservation, id: periodId(reservation) })).sort((a, b) => a.id.localeCompare(b.id));
      for (const item of periods) {
        await tx.insert(runtimeBudgetPeriods).values({ id: item.id, workspaceId: plan.workspaceId, policyId: item.reservation.policyId, kind: item.reservation.period.kind, timezone: item.reservation.period.timezone, startsAt: item.reservation.period.startsAt, endsAt: item.reservation.period.endsAt, createdAt: plan.createdAt }).onConflictDoNothing();
      }
      await tx.select({ id: runtimeBudgetPeriods.id }).from(runtimeBudgetPeriods).where(and(eq(runtimeBudgetPeriods.workspaceId, plan.workspaceId), inArray(runtimeBudgetPeriods.id, periods.map((item) => item.id)))).orderBy(asc(runtimeBudgetPeriods.id)).for("update");
      const policyIds = periods.map((item) => item.reservation.policyId).sort();
      const policies = await tx.select({ policy: runtimeBudgetPolicies, revision: runtimeBudgetPolicyRevisions }).from(runtimeBudgetPolicies).innerJoin(runtimeBudgetPolicyRevisions, and(eq(runtimeBudgetPolicyRevisions.workspaceId, runtimeBudgetPolicies.workspaceId), eq(runtimeBudgetPolicyRevisions.id, runtimeBudgetPolicies.currentRevisionId))).where(and(eq(runtimeBudgetPolicies.workspaceId, plan.workspaceId), inArray(runtimeBudgetPolicies.id, policyIds))).orderBy(asc(runtimeBudgetPolicies.id));
      for (const item of periods) {
        const current = policies.find((row) => row.policy.id === item.reservation.policyId);
        if (!current || current.policy.status !== "active" || current.revision.id !== item.reservation.policyRevisionId || current.policy.currency !== item.reservation.currency || item.reservation.workspaceId !== plan.workspaceId || item.reservation.runId !== plan.runId) return "unavailable";
        const [usage] = await tx.select({ amount: sql<string>`coalesce(sum(case when ${runtimeBudgetReservations.state} in ('held', 'outcome_unknown', 'held_unknown_cost') then ${runtimeBudgetReservations.settledAmount}::numeric + ${runtimeBudgetReservations.heldAmount}::numeric else ${runtimeBudgetReservations.settledAmount}::numeric end), 0)::text` }).from(runtimeBudgetReservations).where(and(eq(runtimeBudgetReservations.workspaceId, plan.workspaceId), eq(runtimeBudgetReservations.periodId, item.id)));
        if (compareDecimals(addDecimals(usage?.amount ?? "0", item.reservation.reservedAmount), current.revision.hardLimit) > 0) return "unavailable";
      }
      const grantReservations: Array<{ grantId: string; reservedCents: number | null; currency: string | null; exposureDigest: string }> = [];
      if (plan.grantIds.length) {
        const grantIds = [...new Set(plan.grantIds)].sort();
        const grants = await tx.select().from(credentialSpendGrants).where(and(
          eq(credentialSpendGrants.workspaceId, plan.workspaceId),
          eq(credentialSpendGrants.principalId, plan.principalId),
          eq(credentialSpendGrants.status, "active"),
          inArray(credentialSpendGrants.id, grantIds),
        )).orderBy(asc(credentialSpendGrants.id)).for("update");
        if (grants.length !== grantIds.length) return "unavailable";
        const slotRows = await tx.select({ id: credentialSlots.id, profileId: credentialSlots.profileId })
          .from(credentialSlots)
          .where(and(eq(credentialSlots.workspaceId, plan.workspaceId), inArray(credentialSlots.profileId, grants.map((grant) => grant.profileId))));
        for (const grant of grants) {
          const slotIds = new Set(slotRows.filter((slot) => slot.profileId === grant.profileId).map((slot) => slot.id));
          const exposures = plan.stepExposures.filter((exposure) =>
            exposure.credentialProfileId === grant.profileId ||
            (exposure.credentialSlotId !== null && slotIds.has(exposure.credentialSlotId)));
          let reservedCents: number | null = null;
          if (grant.mode === "bounded") {
            const amounts = exposures.map((exposure) =>
              exposure.amountPerAttempt !== null && exposure.currency === "USD"
                ? usdCents(multiplyDecimals(exposure.amountPerAttempt, String(exposure.automaticAttempts)))
                : null);
            if (!amounts.length || amounts.some((amount) => amount === null) || grant.limitCents === null) return "unavailable";
            reservedCents = amounts.reduce<number>((total, amount) => total + amount!, 0);
            const globallyCommitted = await boundedGrantCommittedCents(tx, grant.id);
            if (globallyCommitted + reservedCents > grant.limitCents) return "unavailable";
          }
          grantReservations.push({
            grantId: grant.id,
            reservedCents,
            currency: reservedCents === null ? null : "USD",
            exposureDigest: canonicalDigest(exposures),
          });
        }
      }
      await tx.insert(runtimeBudgetAdmissions).values({ workspaceId: plan.workspaceId, runId: plan.runId, principalId: plan.principalId, requestDigest: plan.requestDigest, grantIds: [...plan.grantIds].sort(), stepExposures: plan.stepExposures, admission: plan, createdAt: plan.createdAt });
      if (grantReservations.length) await tx.insert(runtimeBudgetAdmissionGrants).values(grantReservations.map((item) => ({ workspaceId: plan.workspaceId, runId: plan.runId, ...item })));
      for (const item of periods) {
        await tx.insert(runtimeBudgetReservations).values({ id: item.reservation.id, workspaceId: plan.workspaceId, admittedPrincipalId: item.reservation.admittedPrincipalId, principalId: item.reservation.principalId, runId: plan.runId, policyId: item.reservation.policyId, policyRevisionId: item.reservation.policyRevisionId, periodId: item.id, scope: item.reservation.scope, currency: item.reservation.currency, reservedAmount: item.reservation.reservedAmount, heldAmount: item.reservation.heldAmount, settledAmount: item.reservation.settledAmount, releasedAmount: item.reservation.releasedAmount, state: item.reservation.state, pricingSnapshotIds: item.reservation.pricingSnapshotIds, reservation: item.reservation, createdAt: item.reservation.createdAt, updatedAt: item.reservation.updatedAt });
        await appendBudgetReservationEvidence(tx, item.reservation);
        await tx.insert(runtimeBudgetReservationEvents).values({ id: eventId("held", item.reservation.id), workspaceId: plan.workspaceId, reservationId: item.reservation.id, runId: plan.runId, settlementId: null, costValuationId: null, eventType: "held", amount: item.reservation.reservedAmount, currency: item.reservation.currency, event: { schema: "budget-reservation-event/v1", type: "held", reservationId: item.reservation.id, requestDigest: plan.requestDigest }, occurredAt: plan.createdAt });
      }
      return "created";
    };
    return transaction ? execute(transaction) : this.database().transaction(execute);
  }

  async commitAttemptAllocation(input: BudgetAttemptAllocationInput, transaction?: Tx): Promise<Result> {
    const execute = async (tx: Db | Tx): Promise<Result> => {
      await lockWorkspaceSpendGate(tx, input.workspaceId);
      const requestDigest = canonicalDigest({ ...input, recordedAt: input.recordedAt.toISOString() });
      const [prior] = await tx.select({ requestDigest: runtimeBudgetAttemptAllocations.requestDigest })
        .from(runtimeBudgetAttemptAllocations)
        .where(and(eq(runtimeBudgetAttemptAllocations.workspaceId, input.workspaceId), eq(runtimeBudgetAttemptAllocations.id, input.id)))
        .limit(1);
      if (prior) return prior.requestDigest === requestDigest ? "replayed" : "conflict";
      const [control] = await tx.select().from(runtimeSpendControls)
        .where(eq(runtimeSpendControls.workspaceId, input.workspaceId)).for("update").limit(1);
      if (control?.suspended) return "unavailable";
      const [admission] = await tx.select().from(runtimeBudgetAdmissions).where(and(
        eq(runtimeBudgetAdmissions.workspaceId, input.workspaceId),
        eq(runtimeBudgetAdmissions.runId, input.runId),
        eq(runtimeBudgetAdmissions.principalId, input.principalId),
      )).limit(1);
      if (!admission) return "unavailable";
      const exposure = admission.stepExposures.find((item) => item.stepId === input.stepId);
      if (
        !exposure || input.attempt < 1 || input.attempt > exposure.automaticAttempts ||
        exposure.provider !== input.provider || exposure.providerOperation !== input.providerOperation ||
        exposure.model !== input.model
      ) return "unavailable";
      const reservations = await tx.select().from(runtimeBudgetReservations).where(and(
        eq(runtimeBudgetReservations.workspaceId, input.workspaceId),
        eq(runtimeBudgetReservations.runId, input.runId),
      )).orderBy(asc(runtimeBudgetReservations.id)).for("update");
      if (!reservations.length || reservations.some((row) => !["held", "outcome_unknown", "held_unknown_cost"].includes(row.state))) return "unavailable";

      const admittedGrants = await tx.select().from(runtimeBudgetAdmissionGrants).where(and(
        eq(runtimeBudgetAdmissionGrants.workspaceId, input.workspaceId),
        eq(runtimeBudgetAdmissionGrants.runId, input.runId),
      )).orderBy(asc(runtimeBudgetAdmissionGrants.grantId));
      const grantIds = admittedGrants.map((row) => row.grantId);
      const grants = grantIds.length
        ? await tx.select().from(credentialSpendGrants).where(and(
            eq(credentialSpendGrants.workspaceId, input.workspaceId),
            eq(credentialSpendGrants.principalId, input.principalId),
            inArray(credentialSpendGrants.id, grantIds),
          )).orderBy(asc(credentialSpendGrants.id)).for("update")
        : [];
      const slots = grants.length
        ? await tx.select({ id: credentialSlots.id, profileId: credentialSlots.profileId }).from(credentialSlots)
            .where(and(eq(credentialSlots.workspaceId, input.workspaceId), inArray(credentialSlots.profileId, grants.map((grant) => grant.profileId))))
        : [];
      const grant = exposure.credentialSlotId || exposure.credentialProfileId
        ? grants.find((candidate) =>
            candidate.profileId === exposure.credentialProfileId ||
            slots.some((slot) => slot.profileId === candidate.profileId && slot.id === exposure.credentialSlotId))
        : null;
      if ((exposure.credentialSlotId || exposure.credentialProfileId) && (!grant || grant.status !== "active")) return "unavailable";
      let grantAmountCents: number | null = null;
      if (grant?.mode === "bounded") {
        if (exposure.amountPerAttempt === null || exposure.currency !== "USD") return "unavailable";
        grantAmountCents = usdCents(exposure.amountPerAttempt);
        const envelope = admittedGrants.find((row) => row.grantId === grant.id)?.reservedCents;
        if (grantAmountCents === null || envelope === null || envelope === undefined) return "unavailable";
        const [allocated] = await tx.select({ amount: sql<number>`coalesce(sum(${runtimeBudgetAttemptAllocations.grantAmountCents}), 0)::integer` })
          .from(runtimeBudgetAttemptAllocations)
          .where(and(
            eq(runtimeBudgetAttemptAllocations.workspaceId, input.workspaceId),
            eq(runtimeBudgetAttemptAllocations.runId, input.runId),
            eq(runtimeBudgetAttemptAllocations.grantId, grant.id),
          ));
        if ((allocated?.amount ?? 0) + grantAmountCents > envelope) return "unavailable";
        const grantLimitCents = grant.limitCents;
        if (grantLimitCents === null) return "unavailable";
        const globallyCommitted = await boundedGrantCommittedCents(tx, grant.id);
        if (globallyCommitted > grantLimitCents) return "unavailable";
      }
      await tx.insert(runtimeBudgetAttemptAllocations).values({
        id: input.id,
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        runId: input.runId,
        stepAttemptId: input.stepAttemptId,
        stepId: input.stepId,
        attempt: input.attempt,
        effectKey: input.effectKey,
        credentialEffectRef: input.credentialEffectRef,
        provider: input.provider,
        providerOperation: input.providerOperation,
        model: input.model,
        sourceAmount: exposure.amountPerAttempt,
        sourceCurrency: exposure.currency,
        grantId: grant?.id ?? null,
        grantAmountCents,
        requestDigest,
        allocation: input,
        createdAt: input.recordedAt,
      });
      await tx.insert(runtimeBudgetAttemptReservationAllocations).values(reservations.map((reservation) => ({
        workspaceId: input.workspaceId,
        allocationId: input.id,
        reservationId: reservation.id,
        amount: admission.admission.reservationAllocations.find((allocation) =>
          allocation.policyRevisionId === reservation.policyRevisionId &&
          allocation.stepId === input.stepId &&
          allocation.currency === reservation.currency)?.amountPerAttempt ?? null,
        currency: reservation.currency,
        basis: admission.admission.reservationAllocations.some((allocation) =>
          allocation.policyRevisionId === reservation.policyRevisionId &&
          allocation.stepId === input.stepId &&
          allocation.currency === reservation.currency) ? "exact" : "envelope_bound",
        createdAt: input.recordedAt,
      })));
      return "created";
    };
    return transaction ? execute(transaction) : this.database().transaction(execute);
  }

  async commitSettlement(plan: BudgetSettlementPlan, transaction?: Tx): Promise<Result> {
    const execute = async (tx: Tx): Promise<Result> => {
      const digest = canonicalDigest({ ...plan, recordedAt: plan.recordedAt.toISOString() });
      const [receipt] = await tx.select().from(runtimeBudgetSettlementReceipts).where(and(eq(runtimeBudgetSettlementReceipts.workspaceId, plan.workspaceId), eq(runtimeBudgetSettlementReceipts.costValuationId, plan.costValuationId))).limit(1);
      if (receipt) return receipt.requestDigest === digest ? "replayed" : "conflict";
      const periodRows = await tx.select({ id: runtimeBudgetReservations.periodId })
        .from(runtimeBudgetReservations)
        .where(and(
          eq(runtimeBudgetReservations.workspaceId, plan.workspaceId),
          eq(runtimeBudgetReservations.runId, plan.runId),
        ));
      const periodIds = [...new Set(periodRows.map((row) => row.id))].sort();
      if (!periodIds.length) return "unavailable";
      await tx.select({ id: runtimeBudgetPeriods.id })
        .from(runtimeBudgetPeriods)
        .where(and(
          eq(runtimeBudgetPeriods.workspaceId, plan.workspaceId),
          inArray(runtimeBudgetPeriods.id, periodIds),
        ))
        .orderBy(asc(runtimeBudgetPeriods.id))
        .for("update");
      const rows = await tx.select().from(runtimeBudgetReservations).where(and(eq(runtimeBudgetReservations.workspaceId, plan.workspaceId), eq(runtimeBudgetReservations.runId, plan.runId))).orderBy(asc(runtimeBudgetReservations.id)).for("update");
      const currencylessKnownZero = plan.amount !== null &&
        compareDecimals(plan.amount, "0") === 0 &&
        plan.currency === null;
      if (
        !rows.length ||
        (
          plan.outcome !== "outcome_unknown" &&
          plan.amount !== null &&
          plan.currency === null &&
          !currencylessKnownZero
        )
      ) return "unavailable";
      if (plan.currency !== null && rows.some((row) => row.currency !== plan.currency)) return "unavailable";
      const [valuation] = await tx.select({
        id: runtimeCostValuations.id,
        supersedesCostValuationId: runtimeCostValuations.supersedesCostValuationId,
      }).from(runtimeCostValuations).where(and(
        eq(runtimeCostValuations.workspaceId, plan.workspaceId),
        eq(runtimeCostValuations.runId, plan.runId),
        eq(runtimeCostValuations.stepAttemptId, plan.stepAttemptId),
        eq(runtimeCostValuations.settlementId, plan.settlementId),
        eq(runtimeCostValuations.id, plan.costValuationId),
      )).limit(1);
      if (!valuation) return "unavailable";
      const priorEvents = await tx.select({
        reservationId: runtimeBudgetReservationEvents.reservationId,
        amount: runtimeBudgetReservationEvents.amount,
        currency: runtimeBudgetReservationEvents.currency,
        costValuationId: runtimeBudgetReservationEvents.costValuationId,
        event: runtimeBudgetReservationEvents.event,
      }).from(runtimeBudgetReservationEvents).where(and(
        eq(runtimeBudgetReservationEvents.workspaceId, plan.workspaceId),
        inArray(runtimeBudgetReservationEvents.reservationId, rows.map((row) => row.id)),
        eq(runtimeBudgetReservationEvents.settlementId, plan.settlementId),
      )).orderBy(
        asc(runtimeBudgetReservationEvents.reservationId),
        desc(runtimeBudgetReservationEvents.occurredAt),
        desc(runtimeBudgetReservationEvents.id),
      );
      const priorHeads = new Map<string, typeof priorEvents[number]>();
      for (const event of priorEvents) {
        if (!priorHeads.has(event.reservationId)) priorHeads.set(event.reservationId, event);
      }
      if ([...priorHeads.values()].some((prior) =>
        valuation.supersedesCostValuationId !== prior.costValuationId)) {
        return "conflict";
      }
      const allocationRows = await tx.select({
        reservationId: runtimeBudgetAttemptReservationAllocations.reservationId,
        amount: runtimeBudgetAttemptReservationAllocations.amount,
        basis: runtimeBudgetAttemptReservationAllocations.basis,
      }).from(runtimeBudgetAttemptReservationAllocations).innerJoin(
        runtimeBudgetAttemptAllocations,
        and(
          eq(runtimeBudgetAttemptAllocations.workspaceId, runtimeBudgetAttemptReservationAllocations.workspaceId),
          eq(runtimeBudgetAttemptAllocations.id, runtimeBudgetAttemptReservationAllocations.allocationId),
        ),
      ).where(and(
        eq(runtimeBudgetAttemptAllocations.workspaceId, plan.workspaceId),
        eq(runtimeBudgetAttemptAllocations.runId, plan.runId),
        eq(runtimeBudgetAttemptAllocations.stepAttemptId, plan.stepAttemptId),
      ));
      const allocationByReservation = new Map(
        allocationRows.map((allocation) => [allocation.reservationId, allocation]),
      );
      await tx.insert(runtimeBudgetSettlementReceipts).values({ workspaceId: plan.workspaceId, costValuationId: plan.costValuationId, runId: plan.runId, requestDigest: digest, createdAt: plan.recordedAt });
      for (const row of rows) {
        const current = reservationFrom(row);
        const priorHead = priorHeads.get(row.id);
        const outcomeUnknown = plan.outcome === "outcome_unknown";
        const costUnknown = !outcomeUnknown && plan.amount === null;
        const heldUnknown = outcomeUnknown || costUnknown;
        const priorSettledContribution = typeof priorHead?.event.settledContribution === "string"
          ? priorHead.event.settledContribution
          : "0";
        const priorResolvedHoldContribution = typeof priorHead?.event.resolvedHoldContribution === "string"
          ? priorHead.event.resolvedHoldContribution
          : "0";
        const withoutPrior = subtractDecimals(current.settledAmount, priorSettledContribution);
        const heldAmount = allocationByReservation.get(row.id)?.basis === "exact"
          ? allocationByReservation.get(row.id)?.amount ?? null
          : null;
        const heldWithoutPrior = addDecimals(current.heldAmount, priorResolvedHoldContribution);
        const settled = heldUnknown || plan.amount === null
          ? withoutPrior
          : addDecimals(withoutPrior, plan.amount);
        const held = !heldUnknown && plan.runTerminal
          ? "0"
          : !heldUnknown && heldAmount !== null
            ? subtractDecimals(heldWithoutPrior, heldAmount)
            : heldWithoutPrior;
        const released = subtractDecimals(
          current.reservedAmount,
          addDecimals(settled, held),
        );
        const settledContribution = !heldUnknown && plan.amount !== null ? plan.amount : "0";
        const releasedContribution = released;
        const resolvedHoldContribution = subtractDecimals(heldWithoutPrior, held);
        const state: BudgetReservation["state"] = outcomeUnknown
          ? "outcome_unknown"
          : costUnknown
            ? "held_unknown_cost"
            : plan.runTerminal
              ? "settled"
              : "held";
        const updated: BudgetReservation = { ...current, heldAmount: held, settledAmount: settled, releasedAmount: released, state, updatedAt: plan.recordedAt };
        await tx.update(runtimeBudgetReservations).set({ heldAmount: held, settledAmount: settled, releasedAmount: released, state, reservation: updated, updatedAt: plan.recordedAt }).where(and(eq(runtimeBudgetReservations.workspaceId, plan.workspaceId), eq(runtimeBudgetReservations.id, row.id)));
        await appendBudgetReservationEvidence(tx, updated);
        await tx.insert(runtimeBudgetReservationEvents).values({ id: eventId("settlement", { valuation: plan.costValuationId, reservation: row.id }), workspaceId: plan.workspaceId, reservationId: row.id, runId: plan.runId, settlementId: plan.settlementId, costValuationId: plan.costValuationId, eventType: costUnknown ? "held_unknown_cost" : outcomeUnknown ? "outcome_unknown" : compareDecimals(released, current.releasedAmount) > 0 ? "released" : "settled", amount: plan.amount, currency: currencylessKnownZero ? row.currency : plan.currency, event: { schema: "budget-reservation-event/v1", outcome: plan.outcome, stepAttemptId: plan.stepAttemptId, runTerminal: plan.runTerminal, fxSnapshotId: plan.fxSnapshotId, supersedesCostValuationId: valuation.supersedesCostValuationId, settledContribution, releasedContribution, resolvedHoldContribution }, occurredAt: plan.recordedAt });
      }
      return "created";
    };
    return transaction ? execute(transaction) : this.database().transaction(execute);
  }

  async listReservations(input: { workspaceId: string; runId?: string; principalId?: string }) {
    const predicates = [eq(runtimeBudgetReservations.workspaceId, input.workspaceId)];
    if (input.runId) predicates.push(eq(runtimeBudgetReservations.runId, input.runId));
    if (input.principalId) predicates.push(eq(runtimeBudgetReservations.admittedPrincipalId, input.principalId));
    return (await this.database().select().from(runtimeBudgetReservations).where(and(...predicates)).orderBy(asc(runtimeBudgetReservations.createdAt), asc(runtimeBudgetReservations.id))).map(reservationFrom);
  }
}

export class DrizzleBudgetFxRateReader implements FxRateReader {
  constructor(private readonly database: () => Db) {}

  async getRate(input: {
    workspaceId: string;
    baseCurrency: string;
    quoteCurrency: string;
    at: Date;
  }) {
    if (input.baseCurrency === input.quoteCurrency) {
      return { rate: "1", snapshotId: "fx_identity" };
    }
    const [snapshot] = await this.database()
      .select({ id: runtimeFxSnapshots.id, rate: runtimeFxSnapshots.rate })
      .from(runtimeFxSnapshots)
      .where(and(
        eq(runtimeFxSnapshots.baseCurrency, input.baseCurrency),
        eq(runtimeFxSnapshots.quoteCurrency, input.quoteCurrency),
        lte(runtimeFxSnapshots.observedAt, input.at),
      ))
      .orderBy(desc(runtimeFxSnapshots.observedAt), desc(runtimeFxSnapshots.id))
      .limit(1);
    return snapshot ? { rate: snapshot.rate, snapshotId: snapshot.id } : null;
  }
}
