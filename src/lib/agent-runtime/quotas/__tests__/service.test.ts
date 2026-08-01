import { describe, expect, it } from "vitest";
import { InMemoryQuotaRepository } from "../memory";
import { QuotaService } from "../service";
import { MemoryTransactionCoordinator } from "../../memory-transaction";
import type {
  CreateQuotaPolicyRevisionInput,
  QuotaClaimInput,
  QuotaPolicyAppendInput,
} from "../types";

const now = new Date("2026-08-01T12:00:00.000Z");

function policy(overrides: Partial<CreateQuotaPolicyRevisionInput> = {}): CreateQuotaPolicyRevisionInput {
  return {
    workspaceId: "workspace_1",
    principalId: null,
    kind: "concurrency",
    boundary: "run_concurrency",
    dimension: "runtime.concurrent_runs@1",
    unit: "count",
    window: "concurrent",
    timezone: "UTC",
    reservationRule: "release_on_terminal",
    warningThreshold: "1",
    hardLimit: "2",
    exhaustionBehavior: "wait",
    actorUserId: "user_1",
    idempotencyKey: "workspace_concurrency_v1",
    recordedAt: now,
    ...overrides,
  };
}

function claim(runId: string, recordedAt = now): QuotaClaimInput {
  return {
    workspaceId: "workspace_1",
    principalId: "principal_1",
    runId,
    transitionKey: `${runId}:concurrency`,
    boundary: "run_concurrency",
    subject: { kind: "run", id: runId },
    claims: [{ dimension: "runtime.concurrent_runs@1", unit: "count", amount: "1" }],
    recordedAt,
  };
}

function usagePolicy(overrides: Partial<CreateQuotaPolicyRevisionInput> = {}) {
  return policy({
    kind: "usage",
    boundary: "usage_settlement",
    dimension: "runtime.input_tokens@1",
    window: "calendar_day",
    reservationRule: "consume",
    exhaustionBehavior: "deny",
    warningThreshold: "80",
    hardLimit: "100",
    idempotencyKey: "workspace_input_tokens",
    ...overrides,
  });
}

function usageClaim(id: string, amount = "10"): QuotaClaimInput {
  return {
    workspaceId: "workspace_1",
    principalId: "principal_1",
    runId: "run_usage",
    transitionKey: `${id}:reserve`,
    boundary: "usage_settlement",
    subject: { kind: "usage_settlement", id },
    claims: [{ dimension: "runtime.input_tokens@1", unit: "count", amount }],
    recordedAt: now,
  };
}

describe("QuotaService", () => {
  it("returns the canonical persisted revision to concurrent idempotent replays", async () => {
    let releaseReceiptReads!: () => void;
    let releasePolicyReads!: () => void;
    const receiptReadsReady = new Promise<void>((resolve) => {
      releaseReceiptReads = resolve;
    });
    const policyReadsReady = new Promise<void>((resolve) => {
      releasePolicyReads = resolve;
    });
    class ConcurrentReplayRepository extends InMemoryQuotaRepository {
      private receiptReads = 0;
      private policyReads = 0;

      override async getAdminReceipt(
        input: Parameters<InMemoryQuotaRepository["getAdminReceipt"]>[0],
      ) {
        if (this.receiptReads < 2) {
          this.receiptReads += 1;
          if (this.receiptReads === 2) releaseReceiptReads();
          await receiptReadsReady;
          return null;
        }
        return super.getAdminReceipt(input);
      }

      override async listPolicies(workspaceId: string) {
        if (this.policyReads < 2) {
          this.policyReads += 1;
          if (this.policyReads === 2) releasePolicyReads();
          await policyReadsReady;
        }
        return super.listPolicies(workspaceId);
      }
    }

    const service = new QuotaService(new ConcurrentReplayRepository());
    const [first, replay] = await Promise.all([
      service.createPolicyRevision(policy()),
      service.createPolicyRevision(policy({
        recordedAt: new Date(now.getTime() + 5_000),
      })),
    ]);

    expect(replay).toEqual(first);
    expect(replay.revision.createdAt).toEqual(first.revision.createdAt);
    expect(replay.policy.updatedAt).toEqual(first.policy.updatedAt);
  });

  it("reports transient policy persistence failures separately from conflicts", async () => {
    class UnavailablePolicyRepository extends InMemoryQuotaRepository {
      override async appendPolicyRevision(_input: QuotaPolicyAppendInput) {
        return "unavailable" as const;
      }
    }

    const service = new QuotaService(new UnavailablePolicyRepository());
    await expect(service.createPolicyRevision(policy())).rejects.toMatchObject({
      code: "QUOTA_PERSISTENCE_UNAVAILABLE",
    });
  });

  it("denies a missing Workspace policy in both preview and transactional commit", async () => {
    const service = new QuotaService(new InMemoryQuotaRepository());
    const input = claim("run_without_policy");
    await expect(service.previewClaim(input)).resolves.toMatchObject({
      decision: "deny",
      denialReasons: ["QUOTA_POLICY_UNAVAILABLE"],
    });
    await expect(service.commitClaim(await service.planClaim(input))).resolves.toEqual({
      kind: "denied",
      reasonCodes: ["QUOTA_POLICY_UNAVAILABLE"],
      evidence: [],
    });
  });

  it("requires an Agent quota revision to narrow the matching Workspace identity", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy());

    await expect(service.createPolicyRevision(policy({
      principalId: "principal_1",
      hardLimit: "3",
      idempotencyKey: "principal_too_broad",
    }))).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
    const narrowed = await service.createPolicyRevision(policy({
      principalId: "principal_1",
      warningThreshold: "1",
      hardLimit: "1",
      idempotencyKey: "principal_narrowed",
    }));
    expect(narrowed).toMatchObject({
      policy: { scope: "principal", dimension: "runtime.concurrent_runs@1" },
      revision: { revision: 1, hardLimit: "1" },
    });
  });

  it("rejects a Workspace revision that would become narrower than an active Agent quota", async () => {
    const service = new QuotaService(new InMemoryQuotaRepository());
    await service.createPolicyRevision(policy({ warningThreshold: "4", hardLimit: "5" }));
    await service.createPolicyRevision(policy({
      principalId: "principal_1",
      warningThreshold: "3",
      hardLimit: "3",
      idempotencyKey: "principal_v1",
    }));
    await expect(service.createPolicyRevision(policy({
      warningThreshold: "2",
      hardLimit: "2",
      idempotencyKey: "workspace_v2_too_narrow",
      recordedAt: new Date(now.getTime() + 1_000),
    }))).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
  });

  it("atomically waits on exhausted concurrency and exposes release-driven wake evidence", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({ hardLimit: "1" }));
    const first = await service.planClaim(claim("run_1"));
    const second = await service.planClaim(claim("run_2"));

    await expect(service.commitClaim(first)).resolves.toMatchObject({ kind: "created" });
    const waiting = await service.commitClaim(second);
    expect(waiting).toMatchObject({
      kind: "wait",
      wait: {
        runId: "run_2",
        eligibleAt: null,
        evidence: [{
          eligibility: { kind: "capacity_release", requiredAvailable: "1" },
          committed: "1",
          requested: "1",
          available: "0",
        }],
      },
    });

    const releasePlan = await service.planTransition({
      workspaceId: "workspace_1",
      transitionId: "run_1_terminal",
      subject: { kind: "run", id: "run_1" },
      outcome: "release",
      amount: null,
      evidenceRef: "run_event_1",
      recordedAt: new Date(now.getTime() + 1_000),
    });
    await expect(service.commitTransition(releasePlan)).resolves.toMatchObject({
      kind: "created",
      newlyEligibleWaits: [{ runId: "run_2" }],
    });
    const resumePlan = await service.planResumeWait({
      workspaceId: "workspace_1",
      waitId: waiting.kind === "wait" ? waiting.wait.id : "unexpected",
      actor: { kind: "system" },
      resumeReason: "capacity_available",
      idempotencyKey: "resume_run_2",
      recordedAt: new Date(now.getTime() + 2_000),
    });
    await expect(service.commitClaim(resumePlan)).resolves.toMatchObject({ kind: "created" });
    await expect(service.getWait({ workspaceId: "workspace_1", waitId: resumePlan.resumesWaitId! }))
      .resolves.toMatchObject({
        state: "resumed",
        resumeReason: "capacity_available",
        resumedBy: { kind: "system" },
        resumeIdempotencyKey: "resume_run_2",
      });
  });

  it("rejects a transition-key replay whose exhausted Wait intent is not identical", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({ hardLimit: "1" }));
    await service.commitClaim(await service.planClaim(claim("run_blocker")));
    const originalInput = claim("run_waiting");
    const original = await service.commitClaim(await service.planClaim(originalInput));
    expect(original).toMatchObject({ kind: "wait" });

    const mismatches: QuotaClaimInput[] = [
      { ...originalInput, principalId: "principal_other" },
      {
        ...originalInput,
        runId: "run_other",
        subject: { kind: "run", id: "run_other" },
      },
      { ...originalInput, subject: { kind: "run", id: "run_other_subject" } },
      {
        ...originalInput,
        claims: [{ dimension: "runtime.concurrent_runs@1", unit: "count", amount: "2" }],
      },
    ];
    for (const mismatch of mismatches) {
      await expect(service.commitClaim(await service.planClaim(mismatch)))
        .resolves.toEqual({ kind: "conflict" });
    }

    await expect(service.listWaits({ workspaceId: "workspace_1" })).resolves.toEqual([
      expect.objectContaining({
        runId: originalInput.runId,
        admittedPrincipalId: originalInput.principalId,
        subject: originalInput.subject,
        claims: originalInput.claims,
      }),
    ]);
  });

  it("records the exact renewal boundary for an exhausted calendar rate window", async () => {
    const repository = new InMemoryQuotaRepository(() => new Date(now));
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({
      kind: "rate",
      boundary: "provider_effect",
      dimension: "runtime.provider_calls@1",
      window: "calendar_minute",
      reservationRule: "consume",
      warningThreshold: "1",
      hardLimit: "1",
      idempotencyKey: "workspace_rate_v1",
    }));
    const rateClaim = (runId: string, recordedAt: Date): QuotaClaimInput => ({
      ...claim(runId, recordedAt),
      boundary: "provider_effect",
      claims: [{ dimension: "runtime.provider_calls@1", unit: "count", amount: "1" }],
    });
    await service.commitClaim(await service.planClaim(rateClaim("rate_1", now)));
    const waiting = await service.commitClaim(await service.planClaim(rateClaim(
      "rate_2",
      new Date("2026-08-01T12:00:30.000Z"),
    )));
    expect(waiting).toMatchObject({
      kind: "wait",
      wait: {
        eligibleAt: new Date("2026-08-01T12:01:00.000Z"),
        evidence: [{
          eligibleAt: new Date("2026-08-01T12:01:00.000Z"),
          eligibility: {
            kind: "window_renewal",
            eligibleAt: new Date("2026-08-01T12:01:00.000Z"),
          },
        }],
      },
    });
    await expect(repository.listEligibleWaits({
      workspaceId: "workspace_1",
      at: new Date("2026-08-01T12:00:59.999Z"),
      limit: 10,
    })).resolves.toEqual([]);
    await expect(repository.listEligibleWaits({
      workspaceId: "workspace_1",
      at: new Date("2026-08-01T12:01:00.000Z"),
      limit: 10,
    })).resolves.toEqual([expect.objectContaining({ runId: "rate_2" })]);
  });

  it("keeps settled storage capacity until the canonical deletion releases it", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({
      kind: "storage",
      boundary: "artifact_storage",
      dimension: "runtime.artifact_bytes@1",
      unit: "byte",
      window: "lifetime",
      reservationRule: "release_on_transition",
      exhaustionBehavior: "deny",
      warningThreshold: "100",
      hardLimit: "100",
      idempotencyKey: "workspace_storage_v1",
    }));
    const storageClaim: QuotaClaimInput = {
      workspaceId: "workspace_1",
      principalId: "principal_1",
      runId: "run_storage",
      transitionKey: "artifact_1:create",
      boundary: "artifact_storage",
      subject: { kind: "artifact", id: "artifact_1" },
      claims: [{ dimension: "runtime.artifact_bytes@1", unit: "byte", amount: "80" }],
      recordedAt: now,
    };
    await service.commitClaim(await service.planClaim(storageClaim));
    await service.commitTransition(await service.planTransition({
      workspaceId: "workspace_1",
      transitionId: "artifact_1_stored",
      subject: storageClaim.subject,
      outcome: "settle",
      amount: "80",
      evidenceRef: "artifact_event_stored",
      recordedAt: new Date(now.getTime() + 1_000),
    }));
    await expect(service.getEffectiveCapacity({ workspaceId: "workspace_1", principalId: "principal_1", at: now }))
      .resolves.toEqual([expect.objectContaining({ committed: "80", available: "20" })]);
    await service.commitTransition(await service.planTransition({
      workspaceId: "workspace_1",
      transitionId: "artifact_1_deleted",
      subject: storageClaim.subject,
      outcome: "release",
      amount: null,
      evidenceRef: "artifact_event_deleted",
      recordedAt: new Date(now.getTime() + 2_000),
    }));
    await expect(service.getEffectiveCapacity({ workspaceId: "workspace_1", principalId: "principal_1", at: now }))
      .resolves.toEqual([expect.objectContaining({ committed: "0", available: "100" })]);
  });

  it("admits standalone Artifact storage while requiring Run ownership for execution subjects", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({
      kind: "storage",
      boundary: "artifact_storage",
      dimension: "runtime.artifact_bytes@1",
      unit: "byte",
      window: "lifetime",
      reservationRule: "release_on_transition",
      exhaustionBehavior: "deny",
      warningThreshold: "100",
      hardLimit: "100",
      idempotencyKey: "standalone_artifact_storage",
    }));
    const standalone: QuotaClaimInput = {
      workspaceId: "workspace_1",
      principalId: "principal_1",
      runId: null,
      transitionKey: "artifact_standalone:create",
      boundary: "artifact_storage",
      subject: { kind: "artifact", id: "artifact_standalone" },
      claims: [{ dimension: "runtime.artifact_bytes@1", unit: "byte", amount: "25" }],
      recordedAt: now,
    };

    await expect(service.commitClaim(await service.planClaim(standalone)))
      .resolves.toMatchObject({
        kind: "created",
        reservations: [{ runId: null, subject: standalone.subject }],
      });
    await expect(service.listReservations({ workspaceId: "workspace_1", runId: null }))
      .resolves.toEqual([expect.objectContaining({ runId: null })]);

    await expect(service.planClaim({
      ...claim("run_required"),
      runId: null,
    })).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
    await expect(service.planClaim({
      ...standalone,
      transitionKey: "usage_requires_run",
      boundary: "usage_settlement",
      subject: { kind: "usage_settlement", id: "usage_without_run" },
      claims: [{ dimension: "runtime.input_tokens@1", unit: "count", amount: "1" }],
    })).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
  });

  it("releases run concurrency without erasing consumed admission capacity", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({
      kind: "admission",
      boundary: "run_admission",
      dimension: "runtime.run_admissions@1",
      window: "calendar_day",
      reservationRule: "consume",
      exhaustionBehavior: "deny",
      warningThreshold: "1",
      hardLimit: "1",
      idempotencyKey: "workspace_admission_v1",
    }));
    await service.createPolicyRevision(policy({ hardLimit: "1", idempotencyKey: "workspace_concurrency_v1" }));
    const admission: QuotaClaimInput = {
      ...claim("run_mixed"),
      transitionKey: "run_mixed:admission",
      boundary: "run_admission",
      claims: [{ dimension: "runtime.run_admissions@1", unit: "count", amount: "1" }],
    };
    await service.commitClaim(await service.planClaim(admission));
    await service.commitClaim(await service.planClaim(claim("run_mixed")));
    const terminal = await service.planTransition({
      workspaceId: "workspace_1",
      transitionId: "run_mixed:terminal",
      subject: { kind: "run", id: "run_mixed" },
      outcome: "release",
      amount: null,
      evidenceRef: "run_completed",
      recordedAt: new Date(now.getTime() + 1_000),
    });
    expect(terminal.reservationIds).toHaveLength(1);
    await service.commitTransition(terminal);
    const reservations = await service.listReservations({ workspaceId: "workspace_1", runId: "run_mixed" });
    expect(reservations.find((item) => item.kind === "admission")).toMatchObject({ state: "held", releasedAmount: "0" });
    expect(reservations.find((item) => item.kind === "concurrency")).toMatchObject({ state: "released", heldAmount: "0", releasedAmount: "1" });
  });

  it("reconciles known usage below its ceiling and releases the unused reservation", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({
      kind: "usage",
      boundary: "usage_settlement",
      dimension: "runtime.input_tokens@1",
      window: "calendar_day",
      reservationRule: "consume",
      exhaustionBehavior: "deny",
      warningThreshold: "80",
      hardLimit: "100",
      idempotencyKey: "workspace_input_tokens",
    }));
    const usageClaim: QuotaClaimInput = {
      workspaceId: "workspace_1",
      principalId: "principal_1",
      runId: "run_usage",
      transitionKey: "usage_attempt_1:reserve",
      boundary: "usage_settlement",
      subject: { kind: "usage_settlement", id: "usage_attempt_1" },
      claims: [{ dimension: "runtime.input_tokens@1", unit: "count", amount: "10" }],
      recordedAt: now,
    };
    await expect(service.commitClaim(await service.planClaim(usageClaim)))
      .resolves.toMatchObject({ kind: "created" });

    const plan = await service.planUsageReconciliation({
      workspaceId: "workspace_1",
      reconciliationId: "usage_attempt_1:actual:v1",
      subject: usageClaim.subject as { kind: "usage_settlement"; id: string },
      dimension: "runtime.input_tokens@1",
      unit: "count",
      actualAmount: "4",
      evidenceRef: "usage_record_1",
      recordedAt: new Date(now.getTime() + 1_000),
    });
    await expect(service.commitUsageReconciliation(plan)).resolves.toMatchObject({
      kind: "created",
      reservations: [{
        heldAmount: "0",
        settledAmount: "4",
        releasedAmount: "6",
        overageAmount: "0",
        state: "settled",
      }],
    });
    await expect(service.getEffectiveCapacity({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      at: now,
    })).resolves.toEqual([expect.objectContaining({ committed: "4", available: "96" })]);
  });

  it("settles exact-ceiling usage without release or overage", async () => {
    const service = new QuotaService(new InMemoryQuotaRepository());
    await service.createPolicyRevision(usagePolicy());
    const input = usageClaim("usage_exact");
    await service.commitClaim(await service.planClaim(input));
    const plan = await service.planUsageReconciliation({
      workspaceId: "workspace_1",
      reconciliationId: "usage_exact:actual:v1",
      subject: input.subject as { kind: "usage_settlement"; id: string },
      dimension: "runtime.input_tokens@1",
      unit: "count",
      actualAmount: "10",
      evidenceRef: "usage_record_exact",
      recordedAt: new Date(now.getTime() + 1_000),
    });
    await expect(service.commitUsageReconciliation(plan)).resolves.toMatchObject({
      kind: "created",
      reservations: [{
        heldAmount: "0", settledAmount: "10", releasedAmount: "0",
        overageAmount: "0", state: "settled",
      }],
    });
  });

  it("returns the exact blocked plan identity when an atomic claim batch rolls back", async () => {
    const repository = new InMemoryQuotaRepository(() => new Date(now));
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({
      kind: "rate",
      boundary: "provider_effect",
      dimension: "runtime.provider_calls@1",
      window: "calendar_minute",
      reservationRule: "consume",
      warningThreshold: "0",
      hardLimit: "1",
      idempotencyKey: "workspace_rate_batch_identity_v1",
    }));
    const rateClaim = (runId: string): QuotaClaimInput => ({
      ...claim(runId),
      boundary: "provider_effect",
      subject: { kind: "step_attempt", id: `${runId}_attempt` },
      claims: [{ dimension: "runtime.provider_calls@1", unit: "count", amount: "1" }],
    });
    const first = await service.planClaim(rateClaim("batch_first"));
    const blocked = await service.planClaim(rateClaim("batch_blocked"));

    await expect(repository.commitClaimsAtomically([first, blocked])).resolves.toMatchObject({
      kind: "blocked",
      blockedPlan: {
        transitionKey: blocked.transitionKey,
        boundary: "provider_effect",
        subject: { kind: "step_attempt", id: "batch_blocked_attempt" },
      },
      result: {
        kind: "wait",
      },
    });
    await expect(service.listReservations({ workspaceId: "workspace_1" })).resolves.toEqual([]);
  });

  it("requires one exact claim at the Usage Settlement boundary", async () => {
    const service = new QuotaService(new InMemoryQuotaRepository());
    await expect(service.planClaim({
      ...usageClaim("usage_multiple"),
      claims: [
        { dimension: "runtime.input_tokens@1", unit: "count", amount: "10" },
        { dimension: "runtime.output_tokens@1", unit: "count", amount: "5" },
      ],
    })).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
    await expect(service.planClaim({
      ...claim("run_wrong_usage_boundary"),
      subject: { kind: "usage_settlement", id: "usage_wrong_boundary" },
    })).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
  });

  it("preserves usage overage as canonical capacity instead of rejecting evidence", async () => {
    const service = new QuotaService(new InMemoryQuotaRepository());
    await service.createPolicyRevision(usagePolicy());
    const input = usageClaim("usage_overage");
    await service.commitClaim(await service.planClaim(input));
    const plan = await service.planUsageReconciliation({
      workspaceId: "workspace_1",
      reconciliationId: "usage_overage:actual:v1",
      subject: input.subject as { kind: "usage_settlement"; id: string },
      dimension: "runtime.input_tokens@1",
      unit: "count",
      actualAmount: "12",
      evidenceRef: "usage_record_overage",
      recordedAt: new Date(now.getTime() + 1_000),
    });
    await expect(service.commitUsageReconciliation(plan)).resolves.toMatchObject({
      kind: "created",
      reservations: [{
        heldAmount: "0", settledAmount: "10", releasedAmount: "0",
        overageAmount: "2", state: "settled",
      }],
    });
    await expect(service.getEffectiveCapacity({
      workspaceId: "workspace_1", principalId: "principal_1", at: now,
    })).resolves.toEqual([expect.objectContaining({ committed: "12", available: "88" })]);
    await expect(service.commitClaim(await service.planClaim(usageClaim("usage_after_overage", "89"))))
      .resolves.toMatchObject({ kind: "denied", reasonCodes: ["QUOTA_CAPACITY_EXHAUSTED"] });
  });

  it("retains unknown usage holds and preserves reconciliation replay/conflict", async () => {
    const service = new QuotaService(new InMemoryQuotaRepository());
    await service.createPolicyRevision(usagePolicy());
    const input = usageClaim("usage_unknown");
    await service.commitClaim(await service.planClaim(input));
    const reconciliationInput = {
      workspaceId: "workspace_1",
      reconciliationId: "usage_unknown:actual:v1",
      subject: input.subject as { kind: "usage_settlement"; id: string },
      dimension: "runtime.input_tokens@1",
      unit: "count" as const,
      actualAmount: null,
      evidenceRef: "usage_record_unknown",
      recordedAt: new Date(now.getTime() + 1_000),
    };
    const plan = await service.planUsageReconciliation(reconciliationInput);
    await expect(service.commitUsageReconciliation(plan)).resolves.toMatchObject({
      kind: "created",
      reservations: [{
        heldAmount: "10", settledAmount: "0", releasedAmount: "0",
        overageAmount: "0", state: "held",
      }],
    });
    await expect(service.commitUsageReconciliation(plan)).resolves.toMatchObject({ kind: "replayed" });
    const conflict = await service.planUsageReconciliation({
      ...reconciliationInput,
      actualAmount: "5",
    });
    await expect(service.commitUsageReconciliation(conflict)).resolves.toEqual({ kind: "conflict" });
  });

  it("atomically reconciles the Workspace and Agent reservation pair", async () => {
    const service = new QuotaService(new InMemoryQuotaRepository());
    await service.createPolicyRevision(usagePolicy());
    await service.createPolicyRevision(usagePolicy({
      principalId: "principal_1",
      warningThreshold: "40",
      hardLimit: "50",
      idempotencyKey: "principal_input_tokens",
    }));
    const input = usageClaim("usage_pair", "20");
    await expect(service.commitClaim(await service.planClaim(input))).resolves.toMatchObject({
      kind: "created",
      reservations: [{ scope: "workspace" }, { scope: "principal" }],
    });
    const plan = await service.planUsageReconciliation({
      workspaceId: "workspace_1",
      reconciliationId: "usage_pair:actual:v1",
      subject: input.subject as { kind: "usage_settlement"; id: string },
      dimension: "runtime.input_tokens@1",
      unit: "count",
      actualAmount: "7",
      evidenceRef: "usage_record_pair",
      recordedAt: new Date(now.getTime() + 1_000),
    });
    await expect(service.commitUsageReconciliation({
      ...plan,
      reservationIds: [plan.reservationIds[0]!],
    })).resolves.toEqual({ kind: "unavailable" });
    await expect(service.listReservations({
      workspaceId: "workspace_1",
      subject: input.subject,
    })).resolves.toEqual([
      expect.objectContaining({ scope: "workspace", state: "held", heldAmount: "20" }),
      expect.objectContaining({ scope: "principal", state: "held", heldAmount: "20" }),
    ]);
    await expect(service.commitUsageReconciliation(plan)).resolves.toMatchObject({
      kind: "created",
      reservations: [
        { scope: "workspace", settledAmount: "7", releasedAmount: "13" },
        { scope: "principal", settledAmount: "7", releasedAmount: "13" },
      ],
    });
    await expect(service.getEffectiveCapacity({
      workspaceId: "workspace_1", principalId: "principal_1", at: now,
    })).resolves.toEqual([
      expect.objectContaining({ policy: expect.objectContaining({ scope: "workspace" }), committed: "7" }),
      expect.objectContaining({ policy: expect.objectContaining({ scope: "principal" }), committed: "7" }),
    ]);
  });

  it("reserves Usage Settlement mutation exclusively for typed reconciliation", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(usagePolicy());
    const input = usageClaim("usage_typed_only");
    await service.commitClaim(await service.planClaim(input));
    const transitionInput = {
      workspaceId: "workspace_1",
      transitionId: "usage_typed_only:generic-settle:v1",
      subject: input.subject,
      outcome: "settle" as const,
      amount: "5",
      evidenceRef: "usage_record_typed_only",
      recordedAt: new Date(now.getTime() + 1_000),
    };

    await expect(service.planTransition(transitionInput)).rejects.toMatchObject({
      code: "QUOTA_INVALID_INPUT",
    });
    await expect(repository.commitTransition({
      schema: "quota-transition-plan/v1",
      ...transitionInput,
      reservationIds: [...repository.reservations.values()].map((reservation) => reservation.id),
      requestDigest: `sha256:${"0".repeat(64)}`,
    })).resolves.toEqual({ kind: "unavailable" });
    await expect(service.listReservations({
      workspaceId: "workspace_1",
      subject: input.subject,
    })).resolves.toEqual([
      expect.objectContaining({
        heldAmount: "10",
        settledAmount: "0",
        releasedAmount: "0",
        overageAmount: "0",
        state: "held",
      }),
    ]);
  });

  it("rejects partial release plans instead of risking ambiguous capacity arithmetic", async () => {
    const service = new QuotaService(new InMemoryQuotaRepository());
    await service.createPolicyRevision(policy({ hardLimit: "1" }));
    await service.commitClaim(await service.planClaim(claim("run_oversettle")));
    await expect(service.planTransition({
      workspaceId: "workspace_1",
      transitionId: "run_oversettle:terminal",
      subject: { kind: "run", id: "run_oversettle" },
      outcome: "release",
      amount: "2",
      evidenceRef: "run_completed",
      recordedAt: new Date(now.getTime() + 1_000),
    })).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
  });

  it("rechecks a narrowed current revision before waking a capacity-release wait", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({ warningThreshold: "2", hardLimit: "2" }));
    await service.commitClaim(await service.planClaim(claim("narrow_1")));
    await service.commitClaim(await service.planClaim(claim("narrow_2")));
    const waiting = await service.commitClaim(await service.planClaim(claim("narrow_3")));
    expect(waiting.kind).toBe("wait");
    await service.createPolicyRevision(policy({
      warningThreshold: "1",
      hardLimit: "1",
      idempotencyKey: "workspace_concurrency_v2",
      recordedAt: new Date(now.getTime() + 1_000),
    }));
    const release = async (runId: string, offset: number) => service.commitTransition(await service.planTransition({
      workspaceId: "workspace_1",
      transitionId: `${runId}:terminal`,
      subject: { kind: "run", id: runId },
      outcome: "release",
      amount: null,
      evidenceRef: "run_completed",
      recordedAt: new Date(now.getTime() + offset),
    }));
    await expect(release("narrow_1", 2_000)).resolves.toMatchObject({ newlyEligibleWaits: [] });
    await expect(release("narrow_2", 3_000)).resolves.toMatchObject({
      newlyEligibleWaits: [{ runId: "narrow_3" }],
    });
  });

  it("rejects incoherent quota policy identities", async () => {
    const service = new QuotaService(new InMemoryQuotaRepository());
    await expect(service.createPolicyRevision(policy({
      kind: "concurrency",
      boundary: "artifact_storage",
      unit: "byte",
      reservationRule: "release_on_transition",
    }))).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
    await expect(service.createPolicyRevision(policy({
      exhaustionBehavior: "deny",
      idempotencyKey: "concurrency_deny",
    }))).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
    await expect(service.createPolicyRevision(policy({
      kind: "admission",
      boundary: "run_admission",
      dimension: "runtime.run_admissions@1",
      window: "calendar_day",
      reservationRule: "consume",
      exhaustionBehavior: "wait",
      idempotencyKey: "admission_wait",
    }))).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
    await expect(service.createPolicyRevision(policy({
      kind: "storage",
      boundary: "artifact_storage",
      dimension: "runtime.artifact_bytes@1",
      unit: "byte",
      window: "lifetime",
      reservationRule: "release_on_transition",
      exhaustionBehavior: "wait",
      idempotencyKey: "storage_wait",
    }))).rejects.toMatchObject({ code: "QUOTA_INVALID_INPUT" });
  });

  it("preserves emergency spend suspension at the provider-effect boundary", async () => {
    const repository = new InMemoryQuotaRepository();
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({
      kind: "rate",
      boundary: "provider_effect",
      dimension: "runtime.provider_calls@1",
      window: "calendar_minute",
      reservationRule: "consume",
      hardLimit: "10",
      warningThreshold: "8",
      idempotencyKey: "workspace_rate_v1",
    }));
    await repository.setSpendSuspended("workspace_1", true);
    const input = { ...claim("run_suspended"), boundary: "provider_effect" as const,
      claims: [{ dimension: "runtime.provider_calls@1", unit: "count" as const, amount: "1" }] };
    await expect(service.previewClaim(input)).resolves.toMatchObject({
      decision: "deny",
      denialReasons: ["EMERGENCY_SPEND_SUSPENDED"],
    });
    await expect(service.commitClaim(await service.planClaim(input))).resolves.toEqual({
      kind: "denied",
      reasonCodes: ["EMERGENCY_SPEND_SUSPENDED"],
      evidence: [],
    });
  });

  it("observes a spend suspension that arrives during provider-effect capacity evaluation", async () => {
    let projectionStarted!: () => void;
    let releaseProjection!: () => void;
    const started = new Promise<void>((resolve) => { projectionStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseProjection = resolve; });
    class PausingRepository extends InMemoryQuotaRepository {
      pause = false;

      override async getCapacityProjection(
        input: Parameters<InMemoryQuotaRepository["getCapacityProjection"]>[0],
        transaction?: Parameters<InMemoryQuotaRepository["getCapacityProjection"]>[1],
      ) {
        if (this.pause) {
          this.pause = false;
          projectionStarted();
          await release;
        }
        return super.getCapacityProjection(input, transaction);
      }
    }
    const repository = new PausingRepository(() => now);
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({
      kind: "rate",
      boundary: "provider_effect",
      dimension: "runtime.provider_calls@1",
      window: "calendar_minute",
      reservationRule: "consume",
      hardLimit: "10",
      warningThreshold: "8",
      idempotencyKey: "workspace_rate_interleaving_v1",
    }));
    const input = {
      ...claim("run_suspension_interleaving"),
      boundary: "provider_effect" as const,
      claims: [{ dimension: "runtime.provider_calls@1", unit: "count" as const, amount: "1" }],
    };
    const plan = await service.planClaim(input);
    repository.pause = true;
    const committing = service.commitClaim(plan);
    await started;
    const suspending = repository.setSpendSuspended("workspace_1", true);
    releaseProjection();

    await expect(committing).resolves.toEqual({
      kind: "denied",
      reasonCodes: ["EMERGENCY_SPEND_SUSPENDED"],
      evidence: [],
    });
    await suspending;
    await expect(service.listReservations({
      workspaceId: "workspace_1",
      subject: input.subject,
    })).resolves.toEqual([]);
  });

  it("rejects a stale calendar-window plan after the repository clock rolls over", async () => {
    let repositoryNow = new Date("2026-08-01T12:00:30.000Z");
    const repository = new InMemoryQuotaRepository(() => new Date(repositoryNow));
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy({
      kind: "rate",
      boundary: "provider_effect",
      dimension: "runtime.provider_calls@1",
      window: "calendar_minute",
      reservationRule: "consume",
      hardLimit: "10",
      warningThreshold: "8",
      idempotencyKey: "workspace_rate_rollover_v1",
      recordedAt: repositoryNow,
    }));
    const input = {
      ...claim("run_stale_window", repositoryNow),
      boundary: "provider_effect" as const,
      claims: [{ dimension: "runtime.provider_calls@1", unit: "count" as const, amount: "1" }],
    };
    const plan = await service.planClaim(input);
    repositoryNow = new Date("2026-08-01T12:01:00.000Z");

    await expect(service.commitClaim(plan)).resolves.toEqual({ kind: "unavailable" });
    await expect(service.listReservations({
      workspaceId: "workspace_1",
      subject: input.subject,
    })).resolves.toEqual([]);
  });

  it("does not expose quota writes that are later rolled back by a shared memory transaction", async () => {
    const repository = new InMemoryQuotaRepository(() => new Date(now));
    const service = new QuotaService(repository);
    await service.createPolicyRevision(policy());
    const plan = await service.planClaim(claim("run_isolated_read"));
    const coordinator = new MemoryTransactionCoordinator();
    repository.attachMemoryTransactionCoordinator(coordinator);
    let mutationVisible!: () => void;
    let releaseRollback!: () => void;
    const visible = new Promise<void>((resolve) => { mutationVisible = resolve; });
    const release = new Promise<void>((resolve) => { releaseRollback = resolve; });
    const transaction = coordinator.runExclusive(async (token) => {
      const checkpoint = repository.checkpointMemoryState(token);
      await repository.commitClaim(plan, token);
      mutationVisible();
      await release;
      repository.restoreMemoryState(token, checkpoint);
    });
    await visible;
    let readSettled = false;
    const read = service.listReservations({
      workspaceId: "workspace_1",
      subject: plan.subject,
    }).then((value) => {
      readSettled = true;
      return value;
    });
    await Promise.resolve();
    expect(readSettled).toBe(false);
    releaseRollback();
    await transaction;
    await expect(read).resolves.toEqual([]);
  });
});
