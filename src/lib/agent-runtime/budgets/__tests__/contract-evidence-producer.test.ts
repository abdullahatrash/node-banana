import { describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  appendContractEvidenceVersion,
  type ContractEvidenceTransaction,
} from "../../contract-evidence/postgres-repository";
import { projectBudgetReservationContractEvidence } from "../../contract-evidence/projectors";
import type { BudgetReservation } from "../types";

const createdAt = new Date("2026-08-01T09:00:00.000Z");

function reservation(
  overrides: Partial<BudgetReservation> = {},
): BudgetReservation {
  return {
    schema: "budget-reservation/v1",
    id: "budget_reservation_1",
    workspaceId: "workspace_sensitive_1",
    admittedPrincipalId: "principal_sensitive_1",
    principalId: "principal_sensitive_1",
    runId: "run_1",
    policyId: "budget_policy_1",
    policyRevisionId: "budget_policy_revision_1",
    scope: "principal",
    period: {
      kind: "calendar_month",
      timezone: "UTC",
      startsAt: createdAt,
      endsAt: new Date("2026-09-01T09:00:00.000Z"),
    },
    currency: "USD",
    reservedAmount: "10",
    heldAmount: "10",
    settledAmount: "0",
    releasedAmount: "0",
    state: "held",
    pricingSnapshotIds: ["pricing_snapshot_1"],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function evidenceTransaction() {
  let latestVersion = 0;
  const inserted: Array<Record<string, unknown>> = [];
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => latestVersion ? [{ version: latestVersion }] : [],
          }),
        }),
      }),
    })),
    insert: vi.fn(() => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push(value);
          latestVersion = value.version as number;
          return [value];
        },
      }),
    })),
  } as unknown as ContractEvidenceTransaction;
  return { tx, inserted };
}

describe("budget reservation Contract Evidence producer", () => {
  it("projects stable v1 evidence and distinct v2 transition evidence", () => {
    const v1 = projectBudgetReservationContractEvidence(reservation());
    const v1Replay = projectBudgetReservationContractEvidence(reservation());
    const v2 = projectBudgetReservationContractEvidence(
      reservation({
        heldAmount: "0",
        settledAmount: "7",
        releasedAmount: "3",
        state: "settled",
        updatedAt: new Date("2026-08-01T09:01:00.000Z"),
      }),
    );

    expect(v1Replay).toEqual(v1);
    expect(canonicalDigest(v1Replay)).toBe(canonicalDigest(v1));
    expect(canonicalDigest(v2)).not.toBe(canonicalDigest(v1));
    expect(v2).toMatchObject({
      schema: "support-budget-summary/v1",
      state: "settled",
      settledAmount: "7",
      updatedAt: "2026-08-01T09:01:00.000Z",
    });
  });

  it("excludes sensitive and high-cardinality principal fields", () => {
    const source = {
      ...reservation(),
      prompt: "TOP_SECRET_PROMPT_CANARY",
      content: "TOP_SECRET_CONTENT_CANARY",
      authorization: "Bearer TOP_SECRET_TOKEN_CANARY",
      providerBody: { output: "TOP_SECRET_PROVIDER_BODY_CANARY" },
    } as BudgetReservation;
    const serialized = JSON.stringify(
      projectBudgetReservationContractEvidence(source),
    );

    expect(serialized).not.toContain("workspace_sensitive_1");
    expect(serialized).not.toContain("principal_sensitive_1");
    expect(serialized).not.toContain("TOP_SECRET");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("providerBody");
  });

  it("persists stable, distinct, monotonically versioned transition evidence", async () => {
    const firstSource = {
      ...reservation(),
      prompt: "TOP_SECRET_PROMPT_CANARY",
      authorization: "Bearer TOP_SECRET_TOKEN_CANARY",
    } as BudgetReservation;
    const secondSource = reservation({
      heldAmount: "0",
      settledAmount: "7",
      releasedAmount: "3",
      state: "settled",
      updatedAt: new Date("2026-08-01T09:01:00.000Z"),
    });
    const evidence = evidenceTransaction();
    const append = (source: BudgetReservation) => appendContractEvidenceVersion(
      evidence.tx,
      {
        workspaceId: source.workspaceId,
        resourceKind: "budget_reservation",
        resourceId: source.id,
        canonicalSource: source,
        projectionKind: "budget_summary",
        projection: projectBudgetReservationContractEvidence(source),
        createdAt: source.updatedAt,
      },
    );

    const v1 = await append(firstSource);
    const v2 = await append(secondSource);
    const replay = evidenceTransaction();
    const stableV1 = await appendContractEvidenceVersion(replay.tx, {
      workspaceId: firstSource.workspaceId,
      resourceKind: "budget_reservation",
      resourceId: firstSource.id,
      canonicalSource: firstSource,
      projectionKind: "budget_summary",
      projection: projectBudgetReservationContractEvidence(firstSource),
      createdAt: firstSource.updatedAt,
    });

    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v2.canonicalDigest).not.toBe(v1.canonicalDigest);
    expect(v2.projectionDigest).not.toBe(v1.projectionDigest);
    expect(stableV1.canonicalDigest).toBe(v1.canonicalDigest);
    expect(stableV1.projectionDigest).toBe(v1.projectionDigest);
    expect(JSON.stringify(evidence.inserted)).not.toContain("TOP_SECRET");
    expect(evidence.inserted).toHaveLength(2);
  });
});
