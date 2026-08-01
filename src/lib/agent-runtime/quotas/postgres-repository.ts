import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { getDb } from "@/lib/db";
import {
  runtimeQuotaAdminReceipts,
  runtimeQuotaClaimReceipts,
  runtimeQuotaPolicies,
  runtimeQuotaPolicyRevisions,
  runtimeQuotaReservationEvents,
  runtimeQuotaReservations,
  runtimeQuotaTransitionReceipts,
  runtimeQuotaUsageReconciliationReceipts,
  runtimeQuotaWaits,
  runtimeQuotaWindows,
  runtimeSpendControls,
} from "@/lib/db/schema";
import { appendContractEvidenceVersion } from "../contract-evidence/postgres-repository";
import {
  projectQuotaReservationContractEvidence,
  projectQuotaWaitContractEvidence,
} from "../contract-evidence/projectors";
import { addDecimals, canonicalDecimal } from "../usage/decimal";
import type {
  QuotaCapacityProjection,
  QuotaClaimBatchCommitResult,
  QuotaClaimCommitResult,
  QuotaClaimPlan,
  QuotaClaimPlanIdentity,
  QuotaEligibleWaitRef,
  QuotaExhaustionEvidence,
  QuotaPolicy,
  QuotaPolicyAppendInput,
  QuotaPolicyRevision,
  QuotaRepository,
  QuotaReservation,
  QuotaTransitionCommitResult,
  QuotaTransitionPlan,
  QuotaUsageReconciliationCommitResult,
  QuotaUsageReconciliationPlan,
  QuotaWait,
  QuotaWindow,
} from "./types";
import { quotaWindow } from "./window";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class QuotaClaimBatchBlocked extends Error {
  constructor(
    readonly blockedPlan: QuotaClaimPlanIdentity,
    readonly result: Exclude<QuotaClaimCommitResult, { kind: "created" | "replayed" }>,
  ) {
    super("Atomic quota claim batch was blocked.");
  }
}

function date(value: Date | string): Date { return value instanceof Date ? value : new Date(value); }

function compare(left: string, right: string): number {
  const [lw, lf = ""] = canonicalDecimal(left).split(".");
  const [rw, rf = ""] = canonicalDecimal(right).split(".");
  const scale = Math.max(lf.length, rf.length);
  const a = BigInt(`${lw}${lf.padEnd(scale, "0")}`);
  const b = BigInt(`${rw}${rf.padEnd(scale, "0")}`);
  return a < b ? -1 : a > b ? 1 : 0;
}

function subtract(left: string, right: string): string {
  if (compare(left, right) <= 0) return "0";
  const [lw, lf = ""] = canonicalDecimal(left).split(".");
  const [rw, rf = ""] = canonicalDecimal(right).split(".");
  const scale = Math.max(lf.length, rf.length);
  const result = BigInt(`${lw}${lf.padEnd(scale, "0")}`) - BigInt(`${rw}${rf.padEnd(scale, "0")}`);
  if (!scale) return result.toString();
  const digits = result.toString().padStart(scale + 1, "0");
  return canonicalDecimal(`${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
}

function policyFrom(row: typeof runtimeQuotaPolicies.$inferSelect): QuotaPolicy {
  return {
    schema: "quota-policy/v1",
    id: row.id,
    workspaceId: row.workspaceId,
    principalId: row.principalId,
    scope: row.scope as QuotaPolicy["scope"],
    kind: row.kind as QuotaPolicy["kind"],
    boundary: row.boundary as QuotaPolicy["boundary"],
    dimension: row.dimension,
    unit: row.unit as QuotaPolicy["unit"],
    window: row.window as QuotaPolicy["window"],
    timezone: row.timezone,
    reservationRule: row.reservationRule as QuotaPolicy["reservationRule"],
    status: row.status as QuotaPolicy["status"],
    currentRevisionId: row.currentRevisionId,
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
  };
}

function revisionFrom(row: typeof runtimeQuotaPolicyRevisions.$inferSelect): QuotaPolicyRevision {
  return {
    schema: "quota-policy-revision/v1",
    id: row.id,
    policyId: row.policyId,
    workspaceId: row.workspaceId,
    principalId: row.principalId,
    revision: row.revision,
    warningThreshold: row.warningThreshold,
    hardLimit: row.hardLimit,
    exhaustionBehavior: row.exhaustionBehavior as QuotaPolicyRevision["exhaustionBehavior"],
    createdByUserId: row.createdByUserId,
    createdAt: date(row.createdAt),
  };
}

function windowFrom(value: QuotaWindow): QuotaWindow {
  return { ...structuredClone(value), startsAt: date(value.startsAt), endsAt: value.endsAt ? date(value.endsAt) : null };
}

function reservationFrom(row: typeof runtimeQuotaReservations.$inferSelect): QuotaReservation {
  return {
    schema: "quota-reservation/v1",
    id: row.id,
    workspaceId: row.workspaceId,
    admittedPrincipalId: row.admittedPrincipalId,
    principalId: row.principalId,
    runId: row.runId,
    transitionKey: row.transitionKey,
    boundary: row.boundary as QuotaReservation["boundary"],
    subject: {
      kind: row.subjectKind as QuotaReservation["subject"]["kind"],
      id: row.subjectId,
    },
    policyId: row.policyId,
    policyRevisionId: row.policyRevisionId,
    scope: row.scope as QuotaReservation["scope"],
    kind: row.kind as QuotaReservation["kind"],
    dimension: row.dimension,
    unit: row.unit as QuotaReservation["unit"],
    window: windowFrom(row.reservation.window),
    reservationRule: row.reservationRule as QuotaReservation["reservationRule"],
    reservedAmount: row.reservedAmount,
    heldAmount: row.heldAmount,
    settledAmount: row.settledAmount,
    releasedAmount: row.releasedAmount,
    overageAmount: row.overageAmount,
    state: row.state as QuotaReservation["state"],
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
  };
}

function evidenceFrom(value: QuotaExhaustionEvidence): QuotaExhaustionEvidence {
  const window = windowFrom(value.window);
  const eligibleAt = value.eligibleAt ? date(value.eligibleAt) : null;
  return {
    ...structuredClone(value),
    window,
    evaluatedAt: date(value.evaluatedAt),
    eligibleAt,
    eligibility: value.eligibility.kind === "window_renewal"
      ? { kind: "window_renewal", eligibleAt: date(value.eligibility.eligibleAt) }
      : structuredClone(value.eligibility),
  };
}

function waitFrom(row: typeof runtimeQuotaWaits.$inferSelect): QuotaWait {
  return {
    ...structuredClone(row.wait),
    schema: "quota-wait/v1",
    id: row.id,
    workspaceId: row.workspaceId,
    admittedPrincipalId: row.admittedPrincipalId,
    runId: row.runId,
    transitionKey: row.transitionKey,
    evidence: row.wait.evidence.map(evidenceFrom),
    eligibleAt: row.eligibleAt ? date(row.eligibleAt) : null,
    state: row.state as QuotaWait["state"],
    reasonCode: row.reasonCode as QuotaWait["reasonCode"],
    createdAt: date(row.createdAt),
    resolvedAt: row.resolvedAt ? date(row.resolvedAt) : null,
  };
}

function windowId(workspaceId: string, policyId: string, window: QuotaWindow): string {
  return `quota_window_${canonicalDigest({
    workspaceId,
    policyId,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt?.toISOString() ?? null,
  }).slice(7, 39)}`;
}

function sameWindow(left: QuotaWindow, right: QuotaWindow): boolean {
  return left.kind === right.kind && left.timezone === right.timezone &&
    left.startsAt.getTime() === right.startsAt.getTime() &&
    (left.endsAt?.getTime() ?? null) === (right.endsAt?.getTime() ?? null);
}

function sameWaitIntent(wait: QuotaWait, plan: QuotaClaimPlan): boolean {
  return wait.workspaceId === plan.workspaceId &&
    wait.admittedPrincipalId === plan.principalId &&
    wait.runId === plan.runId &&
    wait.transitionKey === plan.transitionKey &&
    wait.boundary === plan.boundary &&
    canonicalDigest(wait.subject) === canonicalDigest(plan.subject) &&
    canonicalDigest(wait.claims) === canonicalDigest(plan.claims);
}

function planIdentity(plan: QuotaClaimPlan): QuotaClaimPlanIdentity {
  return Object.freeze({
    transitionKey: plan.transitionKey,
    boundary: plan.boundary,
    subject: Object.freeze(structuredClone(plan.subject)),
  });
}

function eventId(kind: string, value: unknown): string {
  return `quota_event_${canonicalDigest({ kind, value }).slice(7, 39)}`;
}

async function lockQuotaGate(tx: Db | Tx, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-quota:${workspaceId}`}, 0))`);
}

async function lockWorkspaceSpendGate(tx: Db | Tx, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runtime-budget-spend:${workspaceId}`}, 0))`);
}

async function projectionForWindow(
  tx: Db | Tx,
  workspaceId: string,
  windowIdValue: string,
): Promise<QuotaCapacityProjection> {
  const rows = await tx.select({
    id: runtimeQuotaReservations.id,
    committed: sql<string>`greatest(case
      when ${runtimeQuotaReservations.reservationRule} = 'release_on_terminal'
        then ${runtimeQuotaReservations.heldAmount}::numeric
      when ${runtimeQuotaReservations.reservationRule} = 'release_on_transition'
        then ${runtimeQuotaReservations.heldAmount}::numeric + ${runtimeQuotaReservations.settledAmount}::numeric - ${runtimeQuotaReservations.releasedAmount}::numeric
      else ${runtimeQuotaReservations.heldAmount}::numeric + ${runtimeQuotaReservations.settledAmount}::numeric + ${runtimeQuotaReservations.overageAmount}::numeric
    end, 0)::text`,
  }).from(runtimeQuotaReservations).where(and(
    eq(runtimeQuotaReservations.workspaceId, workspaceId),
    eq(runtimeQuotaReservations.windowId, windowIdValue),
  ));
  return {
    committed: rows.reduce((total, row) => addDecimals(total, row.committed), "0"),
    reservationIds: rows.filter((row) => compare(row.committed, "0") > 0).map((row) => row.id).sort(),
  };
}

async function waitIsEligible(tx: Db | Tx, wait: QuotaWait, at: Date): Promise<boolean> {
  if (!wait.evidence.length) return false;
  for (const evidence of wait.evidence) {
    const [current] = await tx.select({ policy: runtimeQuotaPolicies, revision: runtimeQuotaPolicyRevisions })
      .from(runtimeQuotaPolicies).innerJoin(runtimeQuotaPolicyRevisions, and(
        eq(runtimeQuotaPolicyRevisions.workspaceId, runtimeQuotaPolicies.workspaceId),
        eq(runtimeQuotaPolicyRevisions.id, runtimeQuotaPolicies.currentRevisionId),
      )).where(and(
        eq(runtimeQuotaPolicies.workspaceId, wait.workspaceId),
        eq(runtimeQuotaPolicies.id, evidence.policyId),
        eq(runtimeQuotaPolicies.status, "active"),
      )).limit(1);
    if (!current) return false;
    const policy = policyFrom(current.policy);
    const revision = revisionFrom(current.revision);
    const currentWindow = quotaWindow(policy.window, policy.timezone, at);
    const projection = await projectionForWindow(
      tx,
      wait.workspaceId,
      windowId(wait.workspaceId, evidence.policyId, currentWindow),
    );
    if (compare(addDecimals(projection.committed, evidence.requested), revision.hardLimit) > 0) return false;
  }
  return true;
}

export async function collectEligibleQuotaWaits<Row extends { id: string; createdAt: Date }>(input: {
  limit: number;
  loadPage: (
    cursor: { createdAt: Date; id: string } | null,
    pageSize: number,
  ) => Promise<Row[]>;
  isEligible: (row: Row) => Promise<boolean>;
}): Promise<Row[]> {
  const values: Row[] = [];
  let cursor: { createdAt: Date; id: string } | null = null;
  while (values.length < input.limit) {
    const candidates = await input.loadPage(cursor, input.limit);
    if (!candidates.length) break;
    for (const row of candidates) {
      if (await input.isEligible(row)) values.push(row);
      if (values.length >= input.limit) break;
    }
    const last = candidates.at(-1)!;
    cursor = { createdAt: last.createdAt, id: last.id };
    if (candidates.length < input.limit) break;
  }
  return values;
}

async function eligibleWaits(
  tx: Db | Tx,
  input: { workspaceId: string; at: Date; limit: number },
): Promise<QuotaEligibleWaitRef[]> {
  const candidates = await collectEligibleQuotaWaits({
    limit: input.limit,
    loadPage: (cursor, pageSize) => tx.select().from(runtimeQuotaWaits).where(and(
      eq(runtimeQuotaWaits.workspaceId, input.workspaceId),
      eq(runtimeQuotaWaits.state, "waiting"),
      or(isNull(runtimeQuotaWaits.eligibleAt), lte(runtimeQuotaWaits.eligibleAt, input.at)),
      ...(cursor ? [or(
        gt(runtimeQuotaWaits.createdAt, cursor.createdAt),
        and(
          eq(runtimeQuotaWaits.createdAt, cursor.createdAt),
          gt(runtimeQuotaWaits.id, cursor.id),
        ),
      )] : []),
    )).orderBy(asc(runtimeQuotaWaits.createdAt), asc(runtimeQuotaWaits.id)).limit(pageSize),
    isEligible: async (row) => waitIsEligible(tx, waitFrom(row), input.at),
  });
  return candidates.map((row) => {
    const wait = waitFrom(row);
    return {
      waitId: wait.id,
      workspaceId: wait.workspaceId,
      runId: wait.runId,
      eligibleAt: wait.eligibleAt,
    };
  });
}

export class DrizzleQuotaRepository implements QuotaRepository<Tx> {
  constructor(private readonly database: () => Db) {}

  async getAdminReceipt(input: { workspaceId: string; idempotencyKey: string }) {
    const [row] = await this.database().select().from(runtimeQuotaAdminReceipts).where(and(
      eq(runtimeQuotaAdminReceipts.workspaceId, input.workspaceId),
      eq(runtimeQuotaAdminReceipts.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    return row ? { requestDigest: row.requestDigest, resourceId: row.resourceId } : null;
  }

  async getPolicyRevision(input: { workspaceId: string; revisionId: string }) {
    const [row] = await this.database().select({ policy: runtimeQuotaPolicies, revision: runtimeQuotaPolicyRevisions })
      .from(runtimeQuotaPolicyRevisions).innerJoin(runtimeQuotaPolicies, and(
        eq(runtimeQuotaPolicies.workspaceId, runtimeQuotaPolicyRevisions.workspaceId),
        eq(runtimeQuotaPolicies.id, runtimeQuotaPolicyRevisions.policyId),
      )).where(and(
        eq(runtimeQuotaPolicyRevisions.workspaceId, input.workspaceId),
        eq(runtimeQuotaPolicyRevisions.id, input.revisionId),
      )).limit(1);
    return row ? { policy: policyFrom(row.policy), revision: revisionFrom(row.revision) } : null;
  }

  async listPolicies(workspaceId: string) {
    const rows = await this.database().select({ policy: runtimeQuotaPolicies, revision: runtimeQuotaPolicyRevisions })
      .from(runtimeQuotaPolicies).innerJoin(runtimeQuotaPolicyRevisions, and(
        eq(runtimeQuotaPolicyRevisions.workspaceId, runtimeQuotaPolicies.workspaceId),
        eq(runtimeQuotaPolicyRevisions.id, runtimeQuotaPolicies.currentRevisionId),
      )).where(eq(runtimeQuotaPolicies.workspaceId, workspaceId)).orderBy(
        asc(runtimeQuotaPolicies.scope), asc(runtimeQuotaPolicies.kind), asc(runtimeQuotaPolicies.dimension), asc(runtimeQuotaPolicies.id),
      );
    return rows.map((row) => ({ policy: policyFrom(row.policy), revision: revisionFrom(row.revision) }));
  }

  async appendPolicyRevision(input: QuotaPolicyAppendInput) {
    return this.database().transaction(async (tx) => {
      await lockQuotaGate(tx, input.policy.workspaceId);
      const [receipt] = await tx.select().from(runtimeQuotaAdminReceipts).where(and(
        eq(runtimeQuotaAdminReceipts.workspaceId, input.policy.workspaceId),
        eq(runtimeQuotaAdminReceipts.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (receipt) return receipt.requestDigest === input.requestDigest ? "replayed" as const : "conflict" as const;
      const [existing] = await tx.select().from(runtimeQuotaPolicies).where(and(
        eq(runtimeQuotaPolicies.workspaceId, input.policy.workspaceId),
        eq(runtimeQuotaPolicies.id, input.policy.id),
      )).for("update").limit(1);
      if (
        input.revision.policyId !== input.policy.id || input.revision.workspaceId !== input.policy.workspaceId ||
        input.revision.principalId !== input.policy.principalId || input.policy.currentRevisionId !== input.revision.id
      ) return "conflict" as const;
      if (["concurrency", "rate"].includes(input.policy.kind) && input.revision.exhaustionBehavior !== "wait") {
        return "conflict" as const;
      }
      if (existing) {
        const current = await tx.select().from(runtimeQuotaPolicyRevisions).where(and(
          eq(runtimeQuotaPolicyRevisions.workspaceId, input.policy.workspaceId),
          eq(runtimeQuotaPolicyRevisions.id, existing.currentRevisionId),
        )).limit(1);
        if (!current[0] || input.revision.revision !== current[0].revision + 1) return "conflict" as const;
      }
      const related = await tx.select({ policy: runtimeQuotaPolicies, revision: runtimeQuotaPolicyRevisions })
        .from(runtimeQuotaPolicies).innerJoin(runtimeQuotaPolicyRevisions, and(
          eq(runtimeQuotaPolicyRevisions.workspaceId, runtimeQuotaPolicies.workspaceId),
          eq(runtimeQuotaPolicyRevisions.id, runtimeQuotaPolicies.currentRevisionId),
        )).where(and(
          eq(runtimeQuotaPolicies.workspaceId, input.policy.workspaceId),
          eq(runtimeQuotaPolicies.status, "active"),
          eq(runtimeQuotaPolicies.kind, input.policy.kind),
          eq(runtimeQuotaPolicies.boundary, input.policy.boundary),
          eq(runtimeQuotaPolicies.dimension, input.policy.dimension),
          eq(runtimeQuotaPolicies.unit, input.policy.unit),
          eq(runtimeQuotaPolicies.window, input.policy.window),
          eq(runtimeQuotaPolicies.timezone, input.policy.timezone),
          eq(runtimeQuotaPolicies.reservationRule, input.policy.reservationRule),
        )).orderBy(asc(runtimeQuotaPolicies.id)).for("update");
      if (input.policy.principalId) {
        const parent = related.find(({ policy }) => policy.principalId === null);
        if (!parent || compare(input.revision.hardLimit, parent.revision.hardLimit) > 0 ||
          compare(input.revision.warningThreshold, parent.revision.warningThreshold) > 0 ||
          (parent.revision.exhaustionBehavior === "deny" && input.revision.exhaustionBehavior === "wait")) {
          return "conflict" as const;
        }
      } else {
        const invalidChild = related.some(({ policy, revision }) => policy.principalId !== null && (
          compare(revision.hardLimit, input.revision.hardLimit) > 0 ||
          compare(revision.warningThreshold, input.revision.warningThreshold) > 0 ||
          (input.revision.exhaustionBehavior === "deny" && revision.exhaustionBehavior === "wait")
        ));
        if (invalidChild) return "conflict" as const;
      }
      if (!existing) {
        await tx.insert(runtimeQuotaPolicies).values({
          id: input.policy.id, workspaceId: input.policy.workspaceId, principalId: input.policy.principalId,
          scope: input.policy.scope, kind: input.policy.kind, boundary: input.policy.boundary,
          dimension: input.policy.dimension, unit: input.policy.unit, window: input.policy.window,
          timezone: input.policy.timezone, reservationRule: input.policy.reservationRule, status: input.policy.status,
          currentRevisionId: input.revision.id, policy: input.policy, createdAt: input.policy.createdAt, updatedAt: input.policy.updatedAt,
        });
      } else {
        await tx.update(runtimeQuotaPolicies).set({
          currentRevisionId: input.revision.id, policy: input.policy, updatedAt: input.policy.updatedAt,
        }).where(and(eq(runtimeQuotaPolicies.workspaceId, input.policy.workspaceId), eq(runtimeQuotaPolicies.id, input.policy.id)));
      }
      await tx.insert(runtimeQuotaPolicyRevisions).values({
        id: input.revision.id, workspaceId: input.revision.workspaceId, policyId: input.revision.policyId,
        principalId: input.revision.principalId, revision: input.revision.revision,
        warningThreshold: input.revision.warningThreshold, hardLimit: input.revision.hardLimit,
        exhaustionBehavior: input.revision.exhaustionBehavior, createdByUserId: input.revision.createdByUserId,
        revisionRecord: input.revision, createdAt: input.revision.createdAt,
      });
      await tx.insert(runtimeQuotaAdminReceipts).values({
        workspaceId: input.policy.workspaceId, idempotencyKey: input.idempotencyKey,
        requestDigest: input.requestDigest, resourceId: input.revision.id, createdAt: input.revision.createdAt,
      });
      return "created" as const;
    }).catch(() => "unavailable" as const);
  }

  async isSpendSuspended(workspaceId: string) {
    const [row] = await this.database().select({ suspended: runtimeSpendControls.suspended })
      .from(runtimeSpendControls).where(eq(runtimeSpendControls.workspaceId, workspaceId)).limit(1);
    return row?.suspended ?? false;
  }

  async getCapacityProjection(input: { workspaceId: string; policyRevisionId: string; window: QuotaWindow }) {
    const [revision] = await this.database().select({ policyId: runtimeQuotaPolicyRevisions.policyId })
      .from(runtimeQuotaPolicyRevisions).where(and(
        eq(runtimeQuotaPolicyRevisions.workspaceId, input.workspaceId),
        eq(runtimeQuotaPolicyRevisions.id, input.policyRevisionId),
      )).limit(1);
    if (!revision) return { committed: "0", reservationIds: [] };
    return projectionForWindow(this.database(), input.workspaceId, windowId(input.workspaceId, revision.policyId, input.window));
  }

  async getReservations(input: {
    workspaceId: string;
    subject?: QuotaReservation["subject"];
    runId?: string | null;
    admittedPrincipalId?: string;
    limit?: number;
  }) {
    const predicates = [eq(runtimeQuotaReservations.workspaceId, input.workspaceId)];
    if (input.runId === null) predicates.push(isNull(runtimeQuotaReservations.runId));
    else if (input.runId !== undefined) predicates.push(eq(runtimeQuotaReservations.runId, input.runId));
    if (input.admittedPrincipalId) {
      predicates.push(eq(runtimeQuotaReservations.admittedPrincipalId, input.admittedPrincipalId));
    }
    if (input.subject) {
      predicates.push(eq(runtimeQuotaReservations.subjectKind, input.subject.kind));
      predicates.push(eq(runtimeQuotaReservations.subjectId, input.subject.id));
    }
    const query = this.database().select().from(runtimeQuotaReservations).where(and(...predicates)).orderBy(
      asc(runtimeQuotaReservations.createdAt), asc(runtimeQuotaReservations.id),
    );
    const rows = input.limit === undefined ? await query : await query.limit(input.limit);
    return rows.map(reservationFrom);
  }

  async getWait(input: { workspaceId: string; waitId: string }, transaction?: Tx) {
    const predicate = and(
      eq(runtimeQuotaWaits.workspaceId, input.workspaceId),
      eq(runtimeQuotaWaits.id, input.waitId),
    );
    const [row] = transaction
      ? await transaction.select().from(runtimeQuotaWaits).where(predicate).limit(1).for("update")
      : await this.database().select().from(runtimeQuotaWaits).where(predicate).limit(1);
    return row ? waitFrom(row) : null;
  }

  async listWaits(input: {
    workspaceId: string;
    runId?: string;
    state?: QuotaWait["state"];
    admittedPrincipalId?: string;
    limit?: number;
  }) {
    const predicates = [eq(runtimeQuotaWaits.workspaceId, input.workspaceId)];
    if (input.runId) predicates.push(eq(runtimeQuotaWaits.runId, input.runId));
    if (input.state) predicates.push(eq(runtimeQuotaWaits.state, input.state));
    if (input.admittedPrincipalId) {
      predicates.push(eq(runtimeQuotaWaits.admittedPrincipalId, input.admittedPrincipalId));
    }
    const query = this.database().select().from(runtimeQuotaWaits).where(and(...predicates)).orderBy(
      asc(runtimeQuotaWaits.createdAt), asc(runtimeQuotaWaits.id),
    );
    const rows = input.limit === undefined ? await query : await query.limit(input.limit);
    return rows.map(waitFrom);
  }

  listEligibleWaits(input: { workspaceId: string; at: Date; limit: number }) {
    return eligibleWaits(this.database(), input);
  }

  async commitClaim(plan: QuotaClaimPlan, transaction?: Tx): Promise<QuotaClaimCommitResult> {
    const execute = async (tx: Tx): Promise<QuotaClaimCommitResult> => {
      await lockQuotaGate(tx, plan.workspaceId);
      const [receipt] = await tx.select().from(runtimeQuotaClaimReceipts).where(and(
        eq(runtimeQuotaClaimReceipts.workspaceId, plan.workspaceId),
        eq(runtimeQuotaClaimReceipts.transitionKey, plan.transitionKey),
      )).limit(1);
      if (receipt) {
        if (receipt.requestDigest !== plan.requestDigest) return { kind: "conflict" };
        if (receipt.result.kind !== "created" && receipt.result.kind !== "replayed") return { kind: "conflict" };
        const ids = receipt.result.reservations.map((item) => item.id);
        const rows = ids.length ? await tx.select().from(runtimeQuotaReservations).where(and(
          eq(runtimeQuotaReservations.workspaceId, plan.workspaceId), inArray(runtimeQuotaReservations.id, ids),
        )) : [];
        return { kind: "replayed", reservations: rows.map(reservationFrom) };
      }
      if (plan.boundary === "provider_effect") {
        // Serialize with the budget authority's emergency-spend toggle. A row
        // lock cannot protect the initially-absent control row.
        await lockWorkspaceSpendGate(tx, plan.workspaceId);
        const [control] = await tx.select({ suspended: runtimeSpendControls.suspended }).from(runtimeSpendControls)
          .where(eq(runtimeSpendControls.workspaceId, plan.workspaceId)).for("update").limit(1);
        if (control?.suspended) return { kind: "denied", reasonCodes: ["EMERGENCY_SPEND_SUSPENDED"], evidence: [] };
      }
      const resumedWait = plan.resumesWaitId
        ? (await tx.select().from(runtimeQuotaWaits).where(and(
            eq(runtimeQuotaWaits.workspaceId, plan.workspaceId), eq(runtimeQuotaWaits.id, plan.resumesWaitId),
          )).for("update").limit(1))[0]
        : null;
      if (plan.resumesWaitId && (
        !resumedWait || resumedWait.state !== "waiting" || resumedWait.runId !== plan.runId ||
        resumedWait.transitionKey !== plan.transitionKey || resumedWait.admittedPrincipalId !== plan.principalId
      )) return { kind: "unavailable" };
      const policyIds = [...new Set(plan.reservations.map((item) => item.policyId))].sort();
      if (policyIds.length !== plan.reservations.length) return { kind: "unavailable" };
      const policies = await tx.select({
        policy: runtimeQuotaPolicies,
        revision: runtimeQuotaPolicyRevisions,
        databaseNow: sql<unknown>`statement_timestamp()`,
      })
        .from(runtimeQuotaPolicies).innerJoin(runtimeQuotaPolicyRevisions, and(
          eq(runtimeQuotaPolicyRevisions.workspaceId, runtimeQuotaPolicies.workspaceId),
          eq(runtimeQuotaPolicyRevisions.id, runtimeQuotaPolicies.currentRevisionId),
        )).where(and(
          eq(runtimeQuotaPolicies.workspaceId, plan.workspaceId),
          eq(runtimeQuotaPolicies.status, "active"),
          or(isNull(runtimeQuotaPolicies.principalId), eq(runtimeQuotaPolicies.principalId, plan.principalId)),
        )).orderBy(asc(runtimeQuotaPolicies.id)).for("update");
      for (const claim of plan.claims) {
        const effective = policies.filter(({ policy }) =>
          policy.boundary === plan.boundary && policy.dimension === claim.dimension && policy.unit === claim.unit);
        if (!effective.some(({ policy }) => policy.scope === "workspace")) {
          return { kind: "denied", reasonCodes: ["QUOTA_POLICY_UNAVAILABLE"], evidence: [] };
        }
        if (effective.some(({ revision }) => !plan.reservations.some((reservation) =>
          reservation.policyRevisionId === revision.id && reservation.dimension === claim.dimension &&
          reservation.unit === claim.unit && reservation.reservedAmount === claim.amount))) return { kind: "unavailable" };
      }
      if (policies.filter(({ policy }) => policyIds.includes(policy.id)).length !== policyIds.length) return { kind: "unavailable" };
      if (!policies.length) return { kind: "unavailable" };
      const databaseNow = date(policies[0]!.databaseNow as Date | string);
      const windows = plan.reservations.map((reservation) => ({
        reservation,
        id: windowId(plan.workspaceId, reservation.policyId, reservation.window),
      })).sort((left, right) => left.id.localeCompare(right.id));
      for (const item of windows) {
        const current = policies.find(({ policy }) => policy.id === item.reservation.policyId);
        const currentPolicy = current ? policyFrom(current.policy) : null;
        const expectedWindow = currentPolicy
          ? quotaWindow(currentPolicy.window, currentPolicy.timezone, databaseNow)
          : null;
        const matchingClaim = plan.claims.find((claim) =>
          claim.dimension === item.reservation.dimension && claim.unit === item.reservation.unit);
        if (
          !current || !currentPolicy || !expectedWindow || current.policy.status !== "active" ||
          current.revision.id !== item.reservation.policyRevisionId || !matchingClaim ||
          item.reservation.workspaceId !== plan.workspaceId || item.reservation.runId !== plan.runId ||
          item.reservation.admittedPrincipalId !== plan.principalId ||
          item.reservation.principalId !== current.policy.principalId ||
          item.reservation.scope !== current.policy.scope || item.reservation.kind !== current.policy.kind ||
          item.reservation.boundary !== plan.boundary || item.reservation.boundary !== current.policy.boundary ||
          item.reservation.dimension !== current.policy.dimension || item.reservation.unit !== current.policy.unit ||
          item.reservation.reservationRule !== current.policy.reservationRule ||
          item.reservation.reservedAmount !== matchingClaim.amount ||
          item.reservation.transitionKey !== plan.transitionKey ||
          item.reservation.subject.kind !== plan.subject.kind || item.reservation.subject.id !== plan.subject.id ||
          !sameWindow(item.reservation.window, expectedWindow)
        ) return { kind: "unavailable" };
        await tx.insert(runtimeQuotaWindows).values({
          id: item.id, workspaceId: plan.workspaceId, policyId: item.reservation.policyId,
          kind: item.reservation.window.kind, timezone: item.reservation.window.timezone,
          startsAt: item.reservation.window.startsAt, endsAt: item.reservation.window.endsAt,
          createdAt: databaseNow,
        }).onConflictDoNothing();
      }
      await tx.select({ id: runtimeQuotaWindows.id }).from(runtimeQuotaWindows).where(and(
        eq(runtimeQuotaWindows.workspaceId, plan.workspaceId), inArray(runtimeQuotaWindows.id, windows.map((item) => item.id)),
      )).orderBy(asc(runtimeQuotaWindows.id)).for("update");
      const exhausted: Array<{ evidence: QuotaExhaustionEvidence; behavior: QuotaPolicyRevision["exhaustionBehavior"] }> = [];
      for (const item of windows) {
        const current = policies.find(({ policy }) => policy.id === item.reservation.policyId)!;
        const projection = await projectionForWindow(tx, plan.workspaceId, item.id);
        if (compare(addDecimals(projection.committed, item.reservation.reservedAmount), current.revision.hardLimit) > 0) {
          const eligibleAt = item.reservation.window.endsAt;
          exhausted.push({
            behavior: current.revision.exhaustionBehavior as QuotaPolicyRevision["exhaustionBehavior"],
            evidence: {
              schema: "quota-exhaustion-evidence/v1", policyId: current.policy.id,
              policyRevisionId: current.revision.id, scope: current.policy.scope as "workspace" | "principal",
              dimension: current.policy.dimension, unit: current.policy.unit as QuotaReservation["unit"],
              window: windowFrom(item.reservation.window), hardLimit: current.revision.hardLimit,
              committed: projection.committed, requested: item.reservation.reservedAmount,
              available: subtract(current.revision.hardLimit, projection.committed),
              blockingReservationIds: projection.reservationIds, evaluatedAt: databaseNow, eligibleAt,
              eligibility: eligibleAt ? { kind: "window_renewal", eligibleAt } : { kind: "capacity_release", requiredAvailable: item.reservation.reservedAmount },
              evidenceRef: `quota-evidence:${canonicalDigest({ revisionId: current.revision.id, waitId: plan.waitId, committed: projection.committed }).slice(7)}`,
              evidenceVersion: 1,
            },
          });
        }
      }
      if (exhausted.length) {
        if (exhausted.some((item) => item.behavior === "deny")) {
          return { kind: "denied", reasonCodes: ["QUOTA_CAPACITY_EXHAUSTED"], evidence: exhausted.map((item) => item.evidence) };
        }
        if (plan.runId === null) return { kind: "unavailable" };
        const existing = await tx.select().from(runtimeQuotaWaits).where(and(
          eq(runtimeQuotaWaits.workspaceId, plan.workspaceId), eq(runtimeQuotaWaits.transitionKey, plan.transitionKey),
        )).limit(1);
        if (existing[0]) {
          const existingWait = waitFrom(existing[0]);
          return sameWaitIntent(existingWait, plan)
            ? { kind: "replayed_wait", wait: existingWait }
            : { kind: "conflict" };
        }
        const evidence = exhausted.map((item) => item.evidence);
        const dates = evidence.map((item) => item.eligibleAt).filter((item): item is Date => item !== null);
        const wait: QuotaWait = {
          schema: "quota-wait/v1", id: plan.waitId, workspaceId: plan.workspaceId,
          admittedPrincipalId: plan.principalId, runId: plan.runId, transitionKey: plan.transitionKey,
          boundary: plan.boundary, subject: structuredClone(plan.subject), claims: structuredClone(plan.claims),
          reasonCode: "QUOTA_RENEWABLE_CAPACITY_EXHAUSTED", evidence,
          eligibleAt: dates.length === evidence.length ? new Date(Math.max(...dates.map((item) => item.getTime()))) : null,
          state: "waiting", resumeReason: null, resumedBy: null, resumeIdempotencyKey: null, resolutionReservationIds: [],
          createdAt: databaseNow, resolvedAt: null,
        };
        await tx.insert(runtimeQuotaWaits).values({
          id: wait.id, workspaceId: wait.workspaceId, admittedPrincipalId: wait.admittedPrincipalId,
          runId: wait.runId, transitionKey: wait.transitionKey, state: wait.state, eligibleAt: wait.eligibleAt,
          reasonCode: wait.reasonCode, wait, createdAt: wait.createdAt, resolvedAt: null,
        });
        await appendContractEvidenceVersion(tx, {
          workspaceId: wait.workspaceId,
          resourceKind: "quota_wait",
          resourceId: wait.id,
          canonicalSource: wait,
          projectionKind: "quota_wait_summary",
          projection: projectQuotaWaitContractEvidence(wait),
          createdAt: wait.createdAt,
        });
        return { kind: "wait", wait };
      }
      const persistedReservations: QuotaReservation[] = [];
      for (const item of windows) {
        const reservation: QuotaReservation = {
          ...item.reservation,
          createdAt: databaseNow,
          updatedAt: databaseNow,
        };
        persistedReservations.push(reservation);
        await tx.insert(runtimeQuotaReservations).values({
          id: reservation.id, workspaceId: reservation.workspaceId, admittedPrincipalId: reservation.admittedPrincipalId,
          principalId: reservation.principalId, runId: reservation.runId, transitionKey: reservation.transitionKey,
          boundary: reservation.boundary, subjectKind: reservation.subject.kind, subjectId: reservation.subject.id,
          policyId: reservation.policyId, policyRevisionId: reservation.policyRevisionId, windowId: item.id,
          scope: reservation.scope, kind: reservation.kind, dimension: reservation.dimension, unit: reservation.unit,
          reservationRule: reservation.reservationRule, reservedAmount: reservation.reservedAmount,
          heldAmount: reservation.heldAmount, settledAmount: reservation.settledAmount,
          releasedAmount: reservation.releasedAmount, state: reservation.state, reservation,
          overageAmount: reservation.overageAmount,
          createdAt: reservation.createdAt, updatedAt: reservation.updatedAt,
        });
        await appendContractEvidenceVersion(tx, {
          workspaceId: reservation.workspaceId,
          resourceKind: "quota_reservation",
          resourceId: reservation.id,
          canonicalSource: reservation,
          projectionKind: "quota_reservation_summary",
          projection: projectQuotaReservationContractEvidence(reservation),
          createdAt: reservation.updatedAt,
        });
        await tx.insert(runtimeQuotaReservationEvents).values({
          id: eventId("held", reservation.id), workspaceId: reservation.workspaceId,
          reservationId: reservation.id, transitionId: reservation.transitionKey, eventType: "held",
          amount: reservation.reservedAmount, evidenceRef: plan.requestDigest,
          event: { schema: "quota-reservation-event/v1", requestDigest: plan.requestDigest }, occurredAt: databaseNow,
        });
      }
      const created: QuotaClaimCommitResult = { kind: "created", reservations: persistedReservations };
      await tx.insert(runtimeQuotaClaimReceipts).values({
        workspaceId: plan.workspaceId, transitionKey: plan.transitionKey,
        requestDigest: plan.requestDigest, result: created, createdAt: databaseNow,
      });
      if (resumedWait) {
        const updated: QuotaWait = {
          ...waitFrom(resumedWait), state: "resumed", resumeReason: plan.resumeReason,
          resumedBy: plan.resumeActor, resumeIdempotencyKey: plan.resumeIdempotencyKey,
          resolutionReservationIds: plan.reservations.map((item) => item.id),
          resolvedAt: databaseNow,
        };
        await tx.update(runtimeQuotaWaits).set({ state: updated.state, wait: updated, resolvedAt: updated.resolvedAt })
          .where(and(eq(runtimeQuotaWaits.workspaceId, plan.workspaceId), eq(runtimeQuotaWaits.id, updated.id)));
        await appendContractEvidenceVersion(tx, {
          workspaceId: updated.workspaceId,
          resourceKind: "quota_wait",
          resourceId: updated.id,
          canonicalSource: updated,
          projectionKind: "quota_wait_summary",
          projection: projectQuotaWaitContractEvidence(updated),
          createdAt: updated.resolvedAt ?? databaseNow,
        });
      }
      return created;
    };
    return transaction ? execute(transaction) : this.database().transaction(execute);
  }

  async commitClaimsAtomically(
    plans: QuotaClaimPlan[],
    transaction?: Tx,
  ): Promise<QuotaClaimBatchCommitResult> {
    const execute = async (tx: Tx): Promise<QuotaClaimBatchCommitResult> => {
      const results: Array<Extract<QuotaClaimCommitResult, { kind: "created" | "replayed" }>> = [];
      for (const plan of plans) {
        const result = await this.commitClaim(plan, tx);
        if (result.kind !== "created" && result.kind !== "replayed") {
          throw new QuotaClaimBatchBlocked(
            planIdentity(plan),
            result as Exclude<QuotaClaimCommitResult, { kind: "created" | "replayed" }>,
          );
        }
        results.push(result);
      }
      return { kind: "committed", results };
    };
    try {
      return transaction
        ? await transaction.transaction(execute)
        : await this.database().transaction(execute);
    } catch (error) {
      if (error instanceof QuotaClaimBatchBlocked) {
        return { kind: "blocked", blockedPlan: error.blockedPlan, result: error.result };
      }
      throw error;
    }
  }

  async commitUsageReconciliation(
    plan: QuotaUsageReconciliationPlan,
    transaction?: Tx,
  ): Promise<QuotaUsageReconciliationCommitResult> {
    const execute = async (tx: Tx): Promise<QuotaUsageReconciliationCommitResult> => {
      await lockQuotaGate(tx, plan.workspaceId);
      const [receipt] = await tx.select().from(runtimeQuotaUsageReconciliationReceipts).where(and(
        eq(runtimeQuotaUsageReconciliationReceipts.workspaceId, plan.workspaceId),
        eq(runtimeQuotaUsageReconciliationReceipts.reconciliationId, plan.reconciliationId),
      )).limit(1);
      if (receipt) {
        if (receipt.requestDigest !== plan.requestDigest) return { kind: "conflict" };
        if (receipt.result.kind !== "created" && receipt.result.kind !== "replayed") {
          return { kind: "conflict" };
        }
        const ids = receipt.result.reservations.map((reservation) => reservation.id);
        const rows = ids.length ? await tx.select().from(runtimeQuotaReservations).where(and(
          eq(runtimeQuotaReservations.workspaceId, plan.workspaceId),
          inArray(runtimeQuotaReservations.id, ids),
        )).orderBy(asc(runtimeQuotaReservations.id)) : [];
        return rows.length === ids.length
          ? { kind: "replayed", reservations: rows.map(reservationFrom) }
          : { kind: "unavailable" };
      }
      const rows = await tx.select().from(runtimeQuotaReservations).where(and(
        eq(runtimeQuotaReservations.workspaceId, plan.workspaceId),
        eq(runtimeQuotaReservations.subjectKind, "usage_settlement"),
        eq(runtimeQuotaReservations.subjectId, plan.subject.id),
      )).orderBy(asc(runtimeQuotaReservations.id)).for("update");
      const expectedIds = rows.map((row) => row.id);
      const requestedIds = [...plan.reservationIds].sort();
      if (
        !rows.length ||
        canonicalDigest(expectedIds) !== canonicalDigest(requestedIds)
      ) return { kind: "unavailable" };
      const reservations = rows.map(reservationFrom);
      const ownership = reservations[0];
      if (reservations.some((reservation) =>
        reservation.subject.kind !== "usage_settlement" ||
        reservation.subject.id !== plan.subject.id ||
        reservation.boundary !== "usage_settlement" ||
        reservation.kind !== "usage" ||
        reservation.dimension !== plan.dimension ||
        reservation.unit !== plan.unit ||
        reservation.reservationRule !== "consume" ||
        reservation.runId === null ||
        reservation.runId !== ownership?.runId ||
        reservation.admittedPrincipalId !== ownership?.admittedPrincipalId ||
        reservation.transitionKey !== ownership?.transitionKey ||
        (plan.actualAmount !== null && reservation.state !== "held"))) {
        return { kind: "unavailable" };
      }
      const updated: QuotaReservation[] = [];
      for (const reservation of reservations) {
        if (plan.actualAmount === null) {
          updated.push(reservation);
          continue;
        }
        const settledAmount = compare(plan.actualAmount, reservation.reservedAmount) >= 0
          ? reservation.reservedAmount
          : plan.actualAmount;
        const next: QuotaReservation = {
          ...reservation,
          heldAmount: "0",
          settledAmount,
          releasedAmount: subtract(reservation.reservedAmount, settledAmount),
          overageAmount: subtract(plan.actualAmount, reservation.reservedAmount),
          state: compare(plan.actualAmount, "0") === 0 ? "released" : "settled",
          updatedAt: plan.recordedAt,
        };
        await tx.update(runtimeQuotaReservations).set({
          heldAmount: next.heldAmount,
          settledAmount: next.settledAmount,
          releasedAmount: next.releasedAmount,
          overageAmount: next.overageAmount,
          state: next.state,
          reservation: next,
          updatedAt: next.updatedAt,
        }).where(and(
          eq(runtimeQuotaReservations.workspaceId, plan.workspaceId),
          eq(runtimeQuotaReservations.id, next.id),
        ));
        await appendContractEvidenceVersion(tx as Tx, {
          workspaceId: next.workspaceId,
          resourceKind: "quota_reservation",
          resourceId: next.id,
          canonicalSource: next,
          projectionKind: "quota_reservation_summary",
          projection: projectQuotaReservationContractEvidence(next),
          createdAt: next.updatedAt,
        });
        await tx.insert(runtimeQuotaReservationEvents).values({
          id: eventId("usage_reconciled", { reconciliationId: plan.reconciliationId, reservationId: next.id }),
          workspaceId: plan.workspaceId,
          reservationId: next.id,
          transitionId: plan.reconciliationId,
          eventType: next.state === "released" ? "released" : "settled",
          amount: plan.actualAmount,
          evidenceRef: plan.evidenceRef,
          event: {
            schema: "quota-usage-reconciliation-event/v1",
            requestDigest: plan.requestDigest,
            releasedUnusedAmount: next.releasedAmount,
            overageAmount: next.overageAmount,
          },
          occurredAt: plan.recordedAt,
        });
        updated.push(next);
      }
      const result: QuotaUsageReconciliationCommitResult = {
        kind: "created",
        reservations: updated,
      };
      await tx.insert(runtimeQuotaUsageReconciliationReceipts).values({
        workspaceId: plan.workspaceId,
        reconciliationId: plan.reconciliationId,
        requestDigest: plan.requestDigest,
        result,
        createdAt: plan.recordedAt,
      });
      return result;
    };
    return transaction ? execute(transaction) : this.database().transaction(execute);
  }

  async commitTransition(plan: QuotaTransitionPlan, transaction?: Tx): Promise<QuotaTransitionCommitResult> {
    const execute = async (tx: Tx): Promise<QuotaTransitionCommitResult> => {
      await lockQuotaGate(tx, plan.workspaceId);
      if (plan.subject.kind === "usage_settlement") return { kind: "unavailable" };
      const [receipt] = await tx.select().from(runtimeQuotaTransitionReceipts).where(and(
        eq(runtimeQuotaTransitionReceipts.workspaceId, plan.workspaceId),
        eq(runtimeQuotaTransitionReceipts.transitionId, plan.transitionId),
      )).limit(1);
      if (receipt) {
        if (receipt.requestDigest !== plan.requestDigest) return { kind: "conflict" };
        if (receipt.result.kind !== "created" && receipt.result.kind !== "replayed") return { kind: "conflict" };
        return {
          kind: "replayed",
          newlyEligibleWaits: receipt.result.newlyEligibleWaits.map((item) => ({
            ...structuredClone(item),
            eligibleAt: item.eligibleAt ? date(item.eligibleAt) : null,
          })),
        };
      }
      const rows = plan.reservationIds.length
        ? await tx.select().from(runtimeQuotaReservations).where(and(
            eq(runtimeQuotaReservations.workspaceId, plan.workspaceId),
            inArray(runtimeQuotaReservations.id, plan.reservationIds),
          )).orderBy(asc(runtimeQuotaReservations.id)).for("update")
        : [];
      if (rows.length !== plan.reservationIds.length) return { kind: "unavailable" };
      if (plan.outcome === "release" && plan.amount !== null) return { kind: "unavailable" };
      const before = new Set((await eligibleWaits(tx, { workspaceId: plan.workspaceId, at: plan.recordedAt, limit: 10_000 })).map((item) => item.waitId));
      for (const row of rows) {
        const current = reservationFrom(row);
        if (current.subject.kind === "usage_settlement") return { kind: "unavailable" };
        if (current.subject.kind !== plan.subject.kind || current.subject.id !== plan.subject.id) return { kind: "unavailable" };
        if (plan.outcome === "release" && current.reservationRule === "consume") return { kind: "unavailable" };
        if (plan.outcome === "settle" && current.reservationRule === "release_on_terminal") return { kind: "unavailable" };
        const committed = current.reservationRule === "release_on_terminal"
          ? current.heldAmount
          : subtract(addDecimals(current.heldAmount, current.settledAmount), current.releasedAmount);
        const transitionAmount = plan.amount ?? (plan.outcome === "settle" ? current.heldAmount : committed);
        if (compare(transitionAmount, plan.outcome === "settle" ? current.heldAmount : committed) > 0) {
          return { kind: "unavailable" };
        }
        const settledAmount = plan.outcome === "settle"
          ? addDecimals(current.settledAmount, transitionAmount)
          : current.settledAmount;
        const releaseFromHeld = plan.outcome === "release" && compare(current.heldAmount, transitionAmount) < 0
          ? current.heldAmount
          : plan.outcome === "release" ? transitionAmount : "0";
        const heldAmount = plan.outcome === "settle"
          ? subtract(current.heldAmount, transitionAmount)
          : subtract(current.heldAmount, releaseFromHeld);
        const releasedAmount = plan.outcome === "release"
          ? addDecimals(
              current.releasedAmount,
              current.reservationRule === "release_on_terminal"
                ? transitionAmount
                : subtract(transitionAmount, releaseFromHeld),
            )
          : current.releasedAmount;
        const remaining = current.reservationRule === "release_on_terminal"
          ? heldAmount
          : subtract(addDecimals(heldAmount, settledAmount), releasedAmount);
        const updated: QuotaReservation = {
          ...current, heldAmount, settledAmount, releasedAmount,
          state: compare(remaining, "0") === 0 ? "released" : compare(heldAmount, "0") > 0 ? "held" : "settled",
          updatedAt: plan.recordedAt,
        };
        await tx.update(runtimeQuotaReservations).set({
          heldAmount, settledAmount, releasedAmount, state: updated.state,
          reservation: updated, updatedAt: plan.recordedAt,
        }).where(and(eq(runtimeQuotaReservations.workspaceId, plan.workspaceId), eq(runtimeQuotaReservations.id, current.id)));
        await appendContractEvidenceVersion(tx as Tx, {
          workspaceId: updated.workspaceId,
          resourceKind: "quota_reservation",
          resourceId: updated.id,
          canonicalSource: updated,
          projectionKind: "quota_reservation_summary",
          projection: projectQuotaReservationContractEvidence(updated),
          createdAt: updated.updatedAt,
        });
        await tx.insert(runtimeQuotaReservationEvents).values({
          id: eventId(plan.outcome, { transitionId: plan.transitionId, reservationId: current.id }),
          workspaceId: plan.workspaceId, reservationId: current.id, transitionId: plan.transitionId,
          eventType: plan.outcome === "settle" ? "settled" : "released",
          amount: transitionAmount, evidenceRef: plan.evidenceRef,
          event: { schema: "quota-reservation-event/v1", requestDigest: plan.requestDigest }, occurredAt: plan.recordedAt,
        });
      }
      const newlyEligibleWaits = (await eligibleWaits(tx, { workspaceId: plan.workspaceId, at: plan.recordedAt, limit: 10_000 }))
        .filter((item) => !before.has(item.waitId));
      const result: QuotaTransitionCommitResult = { kind: "created", newlyEligibleWaits };
      await tx.insert(runtimeQuotaTransitionReceipts).values({
        workspaceId: plan.workspaceId, transitionId: plan.transitionId,
        requestDigest: plan.requestDigest, result, createdAt: plan.recordedAt,
      });
      return result;
    };
    return transaction ? execute(transaction) : this.database().transaction(execute);
  }
}
