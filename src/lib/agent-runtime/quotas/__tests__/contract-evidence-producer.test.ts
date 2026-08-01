import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it, vi } from "vitest";
import {
  appendContractEvidenceVersion,
  type ContractEvidenceTransaction,
} from "../../contract-evidence/postgres-repository";
import {
  projectQuotaReservationContractEvidence,
  projectQuotaWaitContractEvidence,
} from "../../contract-evidence/projectors";
import type { QuotaReservation, QuotaWait } from "../types";

const createdAt = new Date("2026-08-01T09:00:00.000Z");

function reservation(overrides: Partial<QuotaReservation> = {}): QuotaReservation {
  return {
    schema: "quota-reservation/v1",
    id: "quota_reservation_1",
    workspaceId: "workspace_1",
    admittedPrincipalId: "principal_1",
    principalId: "principal_1",
    runId: "run_1",
    transitionKey: "transition_1",
    boundary: "run_admission",
    subject: { kind: "run", id: "run_1" },
    policyId: "quota_policy_1",
    policyRevisionId: "quota_policy_revision_1",
    scope: "workspace",
    kind: "concurrency",
    dimension: "runs@1",
    unit: "count",
    window: { kind: "calendar_day", timezone: "UTC", startsAt: createdAt, endsAt: null },
    reservationRule: "release_on_terminal",
    reservedAmount: "1",
    heldAmount: "1",
    settledAmount: "0",
    releasedAmount: "0",
    overageAmount: "0",
    state: "held",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function wait(overrides: Partial<QuotaWait> = {}): QuotaWait {
  return {
    schema: "quota-wait/v1",
    id: "quota_wait_1",
    workspaceId: "workspace_1",
    admittedPrincipalId: "principal_1",
    runId: "run_1",
    transitionKey: "transition_1",
    boundary: "run_admission",
    subject: { kind: "run", id: "run_1" },
    claims: [{ dimension: "runs@1", unit: "count", amount: "1" }],
    reasonCode: "QUOTA_RENEWABLE_CAPACITY_EXHAUSTED",
    evidence: [],
    eligibleAt: null,
    state: "waiting",
    resumeReason: null,
    resumedBy: null,
    resumeIdempotencyKey: null,
    resolutionReservationIds: [],
    createdAt,
    resolvedAt: null,
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

describe("quota Contract Evidence producers", () => {
  it("projects closed reservation and Wait summaries from typed fields", () => {
    const poisonedSubject = {
      kind: "run",
      id: "run_1",
      prompt: "PROMPT_CANARY",
      authorization: "AUTHORIZATION_CANARY",
    } as QuotaReservation["subject"];
    const poisonedClaim = {
      dimension: "runs@1",
      unit: "count",
      amount: "1",
      providerBody: "PROVIDER_BODY_CANARY",
    } as QuotaWait["claims"][number];
    const projected = [
      projectQuotaReservationContractEvidence(reservation({ subject: poisonedSubject })),
      projectQuotaWaitContractEvidence(wait({
        subject: poisonedSubject,
        claims: [poisonedClaim],
        resumeReason: "PRIVATE_OPERATOR_NOTE",
        resumeIdempotencyKey: "PRIVATE_IDEMPOTENCY_KEY",
      })),
    ];

    const serialized = JSON.stringify(projected);
    for (const canary of [
      "PROMPT_CANARY",
      "AUTHORIZATION_CANARY",
      "PROVIDER_BODY_CANARY",
      "PRIVATE_OPERATOR_NOTE",
      "PRIVATE_IDEMPOTENCY_KEY",
    ]) expect(serialized).not.toContain(canary);
    expect(projected[0]).toMatchObject({ subject: { kind: "run", id: "run_1" } });
    expect(projected[1]).toMatchObject({
      claims: [{ dimension: "runs@1", unit: "count", amount: "1" }],
    });
  });

  it("persists stable, distinct, monotonically versioned reservation transitions", async () => {
    const v1Source = reservation();
    const v2Source = reservation({
      heldAmount: "0",
      releasedAmount: "1",
      state: "released",
      updatedAt: new Date("2026-08-01T09:01:00.000Z"),
    });
    const evidence = evidenceTransaction();
    const append = (source: QuotaReservation) => appendContractEvidenceVersion(evidence.tx, {
      workspaceId: source.workspaceId,
      resourceKind: "quota_reservation",
      resourceId: source.id,
      canonicalSource: source,
      projectionKind: "quota_reservation_summary",
      projection: projectQuotaReservationContractEvidence(source),
      createdAt: source.updatedAt,
    });

    const v1 = await append(v1Source);
    const v2 = await append(v2Source);
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v2.canonicalDigest).not.toBe(v1.canonicalDigest);
    expect(v2.projectionDigest).not.toBe(v1.projectionDigest);
    expect(canonicalDigest(v1.projection)).toBe(v1.projectionDigest);
    expect(evidence.inserted).toHaveLength(2);
  });
});
