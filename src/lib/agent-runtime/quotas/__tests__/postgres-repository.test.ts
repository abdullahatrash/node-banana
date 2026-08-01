import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectEligibleQuotaWaits } from "../postgres-repository";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/agent-runtime/quotas/postgres-repository.ts"),
  "utf8",
);

describe("Postgres Quota repository contract", () => {
  it("pages past a blocked prefix larger than four times the requested limit", async () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `blocked_${String(index).padStart(2, "0")}`,
        createdAt: new Date("2026-08-01T12:00:00.000Z"),
        eligible: false,
      })),
      { id: "eligible_01", createdAt: new Date("2026-08-01T12:00:00.000Z"), eligible: true },
      { id: "eligible_02", createdAt: new Date("2026-08-01T12:00:00.000Z"), eligible: true },
    ];
    let pages = 0;
    const eligible = await collectEligibleQuotaWaits({
      limit: 2,
      loadPage: async (cursor, pageSize) => {
        pages += 1;
        return rows.filter((row) => !cursor ||
          row.createdAt > cursor.createdAt ||
          (row.createdAt.getTime() === cursor.createdAt.getTime() && row.id > cursor.id))
          .slice(0, pageSize);
      },
      isEligible: async (row) => row.eligible,
    });

    expect(eligible.map((row) => row.id)).toEqual(["eligible_01", "eligible_02"]);
    expect(pages).toBeGreaterThan(4);
  });

  it("serializes every quota mutation behind one workspace gate", () => {
    const claim = source.slice(source.indexOf("async commitClaim("), source.indexOf("async commitTransition("));
    const transition = source.slice(source.indexOf("async commitTransition("));
    for (const operation of [claim, transition]) {
      expect(operation).toContain("lockQuotaGate(tx, plan.workspaceId)");
      expect(operation.indexOf("lockQuotaGate(tx, plan.workspaceId)")).toBeLessThan(operation.indexOf("runtimeQuotaReservations"));
    }
  });

  it("does not collapse a transient policy transaction failure into a conflict", () => {
    const append = source.slice(
      source.indexOf("async appendPolicyRevision("),
      source.indexOf("async isSpendSuspended("),
    );
    expect(append).toContain('.catch(() => "unavailable" as const)');
    expect(append).not.toContain('.catch(() => "conflict" as const)');
  });

  it("rechecks current Workspace and Agent revisions under lock before capacity", () => {
    const claim = source.slice(source.indexOf("async commitClaim("), source.indexOf("async commitTransition("));
    expect(claim).toContain('eq(runtimeQuotaPolicies.status, "active")');
    expect(claim).toContain("or(isNull(runtimeQuotaPolicies.principalId), eq(runtimeQuotaPolicies.principalId, plan.principalId))");
    expect(claim).toContain('policy.scope === "workspace"');
    expect(claim).toContain('reasonCodes: ["QUOTA_POLICY_UNAVAILABLE"]');
    expect(claim).toContain("lockWorkspaceSpendGate(tx, plan.workspaceId)");
    expect(claim).toContain("statement_timestamp()");
    expect(claim).toContain("quotaWindow(currentPolicy.window, currentPolicy.timezone, databaseNow)");
    expect(claim).toContain("!sameWindow(item.reservation.window, expectedWindow)");
    expect(claim).toContain("current.revision.id !== item.reservation.policyRevisionId");
    expect(claim).toContain('.orderBy(asc(runtimeQuotaWindows.id)).for("update")');
    expect(claim.indexOf('.orderBy(asc(runtimeQuotaWindows.id)).for("update")')).toBeLessThan(
      claim.indexOf("projectionForWindow(tx"),
    );
  });

  it("persists exact wait evidence and exposes both timed and release-driven wakeups", () => {
    expect(source).toContain('kind: "window_renewal", eligibleAt');
    expect(source).toContain('kind: "capacity_release", requiredAvailable');
    expect(source).toContain("blockingReservationIds: projection.reservationIds");
    expect(source).toContain("listEligibleWaits(input:");
    expect(source).toContain("newlyEligibleWaits");
    expect(source).toContain("resumeIdempotencyKey: plan.resumeIdempotencyKey");
    expect(source).toContain("runtimeQuotaPolicies.currentRevisionId");
    expect(source).toContain("quotaWindow(policy.window, policy.timezone, at)");
  });

  it("rolls back a chained claim batch when either reservation cannot be committed", () => {
    const batch = source.slice(
      source.indexOf("async commitClaimsAtomically("),
      source.indexOf("async commitTransition("),
    );
    expect(batch).toContain("await transaction.transaction(execute)");
    expect(batch).toContain("throw new QuotaClaimBatchBlocked(");
    expect(batch).toContain("planIdentity(plan)");
    expect(batch).toContain('return { kind: "blocked", blockedPlan: error.blockedPlan, result: error.result }');
  });

  it("bounds release and settlement against rule-aware outstanding capacity", () => {
    const transition = source.slice(source.indexOf("async commitTransition("));
    expect(transition).toContain('current.reservationRule === "release_on_terminal"');
    expect(transition).toContain('current.reservationRule === "consume"');
    expect(transition).toContain("compare(transitionAmount");
    expect(transition).toContain("releaseFromHeld");
    expect(transition).toContain('return { kind: "unavailable" }');
  });

  it("hydrates replayed wake timestamps from JSONB", () => {
    const transition = source.slice(source.indexOf("async commitTransition("));
    expect(transition).toContain("item.eligibleAt ? date(item.eligibleAt) : null");
  });

  it("hydrates constrained quota identity and lifecycle fields from scalar columns", () => {
    const policy = source.slice(source.indexOf("function policyFrom("), source.indexOf("function revisionFrom("));
    const revision = source.slice(source.indexOf("function revisionFrom("), source.indexOf("function windowFrom("));
    const reservation = source.slice(source.indexOf("function reservationFrom("), source.indexOf("function evidenceFrom("));
    const wait = source.slice(source.indexOf("function waitFrom("), source.indexOf("function windowId("));

    for (const field of ["id", "workspaceId", "principalId", "scope", "kind", "boundary", "status", "currentRevisionId"]) {
      expect(policy).toContain(`${field}: row.${field}`);
    }
    for (const field of ["id", "workspaceId", "policyId", "principalId", "revision", "hardLimit", "exhaustionBehavior"]) {
      expect(revision).toContain(`${field}: row.${field}`);
    }
    for (const field of ["id", "workspaceId", "admittedPrincipalId", "runId", "transitionKey", "boundary", "subjectKind", "subjectId", "reservedAmount", "state"]) {
      expect(reservation).toContain(field === "subjectKind" || field === "subjectId"
        ? `${field === "subjectKind" ? "kind" : "id"}: row.${field}`
        : `${field}: row.${field}`);
    }
    for (const field of ["id", "workspaceId", "admittedPrincipalId", "runId", "transitionKey", "state", "reasonCode"]) {
      expect(wait).toContain(`${field}: row.${field}`);
    }
  });

  it("checks exact immutable intent before replaying an exhausted Wait", () => {
    const claim = source.slice(source.indexOf("async commitClaim("), source.indexOf("async commitClaimsAtomically("));
    expect(claim).toContain("sameWaitIntent(existingWait, plan)");
    expect(claim).toContain('kind: "conflict"');
  });

  it("filters standalone reservations explicitly and hydrates nullable ownership", () => {
    const reservations = source.slice(
      source.indexOf("async getReservations("),
      source.indexOf("async getWait("),
    );
    expect(reservations).toContain("input.runId === null");
    expect(reservations).toContain("isNull(runtimeQuotaReservations.runId)");
    expect(reservations).toContain("runtimeQuotaReservations.admittedPrincipalId");
    expect(reservations).toContain("query.limit(input.limit)");
    const hydrate = source.slice(
      source.indexOf("function reservationFrom("),
      source.indexOf("function evidenceFrom("),
    );
    expect(hydrate).toContain("runId: row.runId");
    expect(hydrate).toContain("overageAmount: row.overageAmount");
    const waits = source.slice(
      source.indexOf("async listWaits("),
      source.indexOf("listEligibleWaits("),
    );
    expect(waits).toContain("runtimeQuotaWaits.admittedPrincipalId");
    expect(waits).toContain("query.limit(input.limit)");
  });

  it("reconciles typed usage under the quota gate with immutable replay evidence", () => {
    const reconciliation = source.slice(
      source.indexOf("async commitUsageReconciliation("),
      source.indexOf("async commitTransition("),
    );
    expect(reconciliation).toContain("lockQuotaGate(tx, plan.workspaceId)");
    expect(reconciliation).toContain("runtimeQuotaUsageReconciliationReceipts");
    expect(reconciliation).toContain('.orderBy(asc(runtimeQuotaReservations.id)).for("update")');
    expect(reconciliation).toContain('eq(runtimeQuotaReservations.subjectKind, "usage_settlement")');
    expect(reconciliation).toContain("canonicalDigest(expectedIds) !== canonicalDigest(requestedIds)");
    expect(reconciliation).toContain('reservation.subject.kind !== "usage_settlement"');
    expect(reconciliation).toContain("overageAmount: subtract(plan.actualAmount, reservation.reservedAmount)");
    expect(reconciliation).toContain('plan.actualAmount === null');
    expect(source).toContain("runtimeQuotaReservations.overageAmount");
  });

  it("fails closed when a generic transition is tampered to target Usage Settlement", () => {
    const transition = source.slice(source.indexOf("async commitTransition("));
    expect(transition).toContain('plan.subject.kind === "usage_settlement"');
    expect(transition).toContain('current.subject.kind === "usage_settlement"');
  });
});
