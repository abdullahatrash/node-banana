import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/agent-runtime/budgets/postgres-repository.ts",
  ),
  "utf8",
);

describe("Postgres Budget repository contract", () => {
  it("serializes admission capacity on stable period rows in deterministic order", () => {
    const admission = source.slice(
      source.indexOf("async commitAdmission("),
      source.indexOf("async commitSettlement("),
    );

    expect(admission).toContain("periodId(reservation)");
    expect(admission).toContain(".sort((a, b) => a.id.localeCompare(b.id))");
    expect(admission).toContain("tx.insert(runtimeBudgetPeriods)");
    expect(admission).toContain(".orderBy(asc(runtimeBudgetPeriods.id)).for(\"update\")");
    expect(admission).toContain("current.revision.id !== item.reservation.policyRevisionId");
    expect(admission).toContain("current.policy.status !== \"active\"");
    expect(admission).toContain("control?.suspended");
    expect(admission).toContain("current.revision.hardLimit");
    expect(admission).toContain("runtimeWorkspacePricingOverrides");
    expect(admission).toContain("current_timestamp");
    expect(admission).toContain("runtimeFxSnapshots");
    expect(admission).toContain("actualIds");
    expect(admission).toContain("expectedOverrideIds");
    expect(admission.indexOf(".for(\"update\")")).toBeLessThan(
      admission.indexOf("tx.insert(runtimeBudgetAdmissions)"),
    );
  });

  it("locks reservations in order and keeps uncertain cost held", () => {
    const settlement = source.slice(
      source.indexOf("async commitSettlement("),
      source.indexOf("async listReservations("),
    );

    expect(settlement).toContain(".orderBy(asc(runtimeBudgetReservations.id)).for(\"update\")");
    expect(settlement).toContain("const periodIds = [...new Set(periodRows.map((row) => row.id))].sort()");
    expect(settlement).toContain(".orderBy(asc(runtimeBudgetPeriods.id))");
    expect(settlement.indexOf(".orderBy(asc(runtimeBudgetPeriods.id))")).toBeLessThan(
      settlement.indexOf(".orderBy(asc(runtimeBudgetReservations.id)).for(\"update\")"),
    );
    expect(settlement).toContain('plan.outcome === "outcome_unknown"');
    expect(settlement).toContain('"held_unknown_cost"');
    expect(settlement).toContain("runtimeBudgetSettlementReceipts");
    expect(settlement).toContain("runtimeBudgetReservationEvents");
    expect(settlement).toContain("plan.fxSnapshotId");
    expect(settlement).toContain("supersedesCostValuationId");
    expect(settlement).toContain("withoutPrior");
    expect(settlement).toContain("currencylessKnownZero");
    expect(settlement).toContain("settledContribution");
    expect(settlement).toContain("releasedContribution");
    expect(settlement).toContain("resolvedHoldContribution");
    expect(settlement).toContain("heldWithoutPrior");
    expect(settlement).toContain("const settled = heldUnknown || plan.amount === null");
    expect(settlement).toContain("addDecimals(settled, held)");
    expect(settlement).toContain("const releasedContribution = released");
    expect(settlement).not.toContain("releasedWithoutPrior");
  });

  it("rechecks provider-boundary suspension, grant state, and retry envelope", () => {
    const allocation = source.slice(
      source.indexOf("async commitAttemptAllocation("),
      source.indexOf("async commitSettlement("),
    );
    expect(allocation).toContain("control?.suspended");
    expect(allocation).toContain("input.attempt > exposure.automaticAttempts");
    expect(allocation).toContain('exposure.currency !== "USD"');
    expect(allocation).toContain("?.reservedCents");
    expect(allocation).toContain("runtimeBudgetAttemptReservationAllocations");
    expect(allocation).toContain("admission.admission.reservationAllocations");
    expect(allocation).toContain('.for("update")');
  });

  it("serializes every spend gate with first-time emergency suspension", () => {
    const suspension = source.slice(
      source.indexOf("async setSpendSuspended("),
      source.indexOf("async commitAdmission("),
    );
    const admission = source.slice(
      source.indexOf("async commitAdmission("),
      source.indexOf("async commitAttemptAllocation("),
    );
    const allocation = source.slice(
      source.indexOf("async commitAttemptAllocation("),
      source.indexOf("async commitSettlement("),
    );
    for (const operation of [suspension, admission, allocation]) {
      expect(operation).toContain("lockWorkspaceSpendGate");
      expect(operation.indexOf("lockWorkspaceSpendGate")).toBeLessThan(
        operation.indexOf("runtimeSpendControls"),
      );
    }
    expect(suspension).toContain("current?.suspended === input.suspended");
    expect(suspension).toContain("current.reason === input.reason");
    expect(suspension).toContain("current.updatedByUserId === input.actorUserId");
    expect(suspension.indexOf("current?.suspended === input.suspended")).toBeLessThan(
      suspension.indexOf("const revision = (current?.revision ?? 0) + 1"),
    );
  });

  it("uses one global bounded-grant projection and excludes runtime-backed legacy receipts", () => {
    const projection = source.slice(
      source.indexOf("async function boundedGrantCommittedCents("),
      source.indexOf("function pricingIdentity("),
    );
    const allocation = source.slice(
      source.indexOf("async commitAttemptAllocation("),
      source.indexOf("async commitSettlement("),
    );
    const evidence = source.slice(
      source.indexOf("async getCredentialGrantEvidence("),
      source.indexOf("async isSpendSuspended("),
    );
    expect(projection).toContain("runtimeHeldCents");
    expect(projection).toContain("externalLegacyCents");
    expect(projection).toContain("runtimeBudgetAdmissionGrants");
    expect(projection).toContain("credentialSpendEvents");
    expect(projection).toContain("runtimeBudgetAttemptAllocations");
    expect(projection).toContain("credentialEffectRef");
    expect(projection).toContain("not exists");
    expect(evidence).toContain("boundedGrantCommittedCents");
    expect(evidence).not.toContain("sum(case when");
    expect(allocation).toContain("boundedGrantCommittedCents");
    expect(allocation).not.toContain("+ grantAmountCents > grant.limitCents");
  });

  it("uses append-only revisions for cockpit policy, pricing, and emergency control changes", () => {
    expect(source).toContain("runtimeBudgetPolicyRevisions");
    expect(source).toContain("runtimeWorkspacePricingOverrideRevisions");
    expect(source).toContain("runtimeSpendControlEvents");
    expect(source).toContain("current?.revision ?? 0");
  });
});
