import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowRunRepository } from "../types";
import { DrizzleWorkflowRunRepository } from "../postgres-repository";

function invalidStart(): Parameters<WorkflowRunRepository["start"]>[0] {
  const acceptedAt = new Date("2026-07-25T12:00:00.000Z");
  return {
    run: {
      id: "run_1",
      workspaceId: "workspace_1",
      workflowId: "workflow_1",
      workflowRevisionId: "revision_1",
      state: "accepted",
      startSnapshotDigest: `sha256:${"a".repeat(64)}`,
      startSnapshot: {
        schema: "workflow-run-start-snapshot/v1",
        workflowId: "workflow_1",
        workflowRevisionId: "revision_1",
        workflowRevision: 1,
        definitionDigest: `sha256:${"b".repeat(64)}`,
        operationRegistryDigest: `sha256:${"c".repeat(64)}`,
        definition: {
          schema: "content-workflow-revision-definition/v1",
          workflowId: "workflow_1",
          name: "test",
          inputs: {},
          credentialSlots: {},
          steps: [],
          outputs: {},
        },
        inputs: [],
        operationContracts: [],
        artifactReferences: [],
        credentialReferences: [],
        authorization: {
          principalId: "principal_1",
          keyId: "key_1",
          evidenceRef: "evidence_1",
        },
      },
      nextEventSequence: 2,
      output: null,
      finalSnapshot: null,
      finalSnapshotDigest: null,
      derivation: null,
      resumeAt: null,
      failureCode: null,
      acceptedAt,
      startedAt: null,
      completedAt: null,
      updatedAt: acceptedAt,
    },
    firstEvent: {
      id: "event_1",
      workspaceId: "other_workspace",
      runId: "run_1",
      sequence: 1,
      type: "run.accepted",
      data: {},
      occurredAt: acceptedAt,
    },
    receipt: {
      workspaceId: "workspace_1",
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef: "trace_1",
      capability: "workflow_runs.start@1",
      idempotencyKey: "idempotency-1",
      requestFingerprint: `sha256:${"d".repeat(64)}`,
      runId: "run_1",
      initialEventCursor: "cursor",
      result: null,
      createdAt: acceptedAt,
    },
    outboxIntent: {
      id: "outbox_1",
      workspaceId: "workspace_1",
      runId: "run_1",
      generation: 1,
      dedupeKey: "dedupe_1",
      state: "pending",
      deliveryToken: null,
      deliveryAttempts: 0,
      availableAt: acceptedAt,
      claimedAt: null,
      deliveredAt: null,
      createdAt: acceptedAt,
    },
  };
}

describe("DrizzleWorkflowRunRepository", () => {
  it("keeps Usage Ledger and quota usage reconciliation in each provider outcome transaction", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/agent-runtime/runs/postgres-repository.ts"),
      "utf8",
    );
    for (const method of [
      "recordStepAttemptProviderSuccess",
      "failStepAttempt",
      "markStepAttemptOutcomeUnknown",
      "reconcileStepAttempt",
    ]) {
      const start = source.indexOf(`async ${method}(`);
      const next = source.indexOf("\n  async ", start + 10);
      const body = source.slice(start, next < 0 ? undefined : next);
      expect(body).toContain("appendUsage");
      expect(body).toContain("commitQuotaUsageReconciliations");
    }
  });
  it("attaches a durable Run evidence version to every canonical insert and update", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/agent-runtime/runs/postgres-repository.ts"),
      "utf8",
    );
    expect(source.match(/(?:insert|update)\(workflowRuns\)/g)).toHaveLength(17);
    // Reconciliation has two mutually-exclusive updates followed by one shared append.
    expect(source.match(/await appendRunContractEvidence\(tx,/g)).toHaveLength(16);
    const reconcile = source.slice(source.indexOf("  async reconcileStepAttempt("));
    expect(reconcile.match(/update\(workflowRuns\)/g)).toHaveLength(2);
    expect(reconcile.match(/await appendRunContractEvidence\(tx,/g)).toHaveLength(1);
    expect(source).toContain("canonicalSource: row");
    expect(source).toContain("projection: projectRunContractEvidence(");
  });
  it("rejects inconsistent atomic acceptance before opening a database", async () => {
    const getDatabase = vi.fn(() => {
      throw new Error("must not open");
    });
    const repository = new DrizzleWorkflowRunRepository(getDatabase);

    await expect(repository.start(invalidStart())).resolves.toEqual({
      kind: "unavailable",
    });
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it("keeps implementation-critical PostgreSQL concurrency contracts explicit", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/agent-runtime/runs/postgres-repository.ts",
      ),
      "utf8",
    );

    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toMatch(
      /agentAuthorizationDecisions\.capabilityName,\s+"workflow_runs\.start"/,
    );
    expect(source).toContain('resource.kind === "workflow"');
    expect(source).toContain('.for("update", { skipLocked: true })');
    expect(source).toContain("candidate.deliveryAttempts + 1");
    expect(source).toContain("existing?.fence ?? BigInt(0)");
    expect(source).toContain("existing.expiresAt > databaseNow");
    expect(source).toContain(
      "databaseNow.getTime() + requestedLeaseMs",
    );
    expect(source).toContain("lease.token !== input.token");
    expect(source).toContain("lease.fence !== input.fence");
    expect(source).toContain(
      "lease.expiresAt <= postgresDate(selected.databaseNow)",
    );
    expect(source).toContain("clock_timestamp()");
    expect(source).toContain('type: "step.completed"');
    expect(source).toContain('type: "run.completed"');
    expect(source).toContain('type: "run.failed"');
    expect(source).not.toMatch(/\bJob\b|jobId|job_id/);
  });

  it("acquires quota gates before budget gates for accepted and derived Runs", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/agent-runtime/runs/postgres-repository.ts",
      ),
      "utf8",
    );
    const start = source.slice(
      source.indexOf("  async start("),
      source.indexOf("  async getById("),
    );
    const derive = source.slice(
      source.indexOf("  async deriveRun("),
      source.indexOf("  async resumeRun("),
    );

    for (const admission of [start, derive]) {
      expect(admission.indexOf("this.commitQuotaClaim(")).toBeGreaterThan(-1);
      expect(admission.indexOf("this.budgetWriter.commitAdmission(")).toBeGreaterThan(-1);
      expect(admission.indexOf("this.commitQuotaClaim(")).toBeLessThan(
        admission.indexOf("this.budgetWriter.commitAdmission("),
      );
    }
  });

  it("locks the winning Quota Wait before accepting a manual-resume replay", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/agent-runtime/runs/postgres-repository.ts",
      ),
      "utf8",
    );
    const resume = source.slice(
      source.indexOf("  async resumeQuotaWait("),
      source.indexOf("  async reconcileStepAttempt("),
    );

    expect(resume).toContain(".from(runtimeQuotaWaits)");
    expect(resume).toContain('.for("update")');
    expect(resume).toContain("winningWait?.state === \"resumed\"");
    expect(resume).toContain(
      "sameQuotaResumeActor(winningWait.resumedBy, input.quotaResumePlan.resumeActor)",
    );
    expect(resume).toContain(
      "winningWait.resumeIdempotencyKey === input.quotaResumePlan.resumeIdempotencyKey",
    );
    expect(resume.indexOf(".from(runtimeQuotaWaits)")).toBeLessThan(
      resume.indexOf('if (run.state !== "waiting"'),
    );
  });

  it("rolls back quota-denied acceptance and preserves the typed denial", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/agent-runtime/runs/postgres-repository.ts",
      ),
      "utf8",
    );
    for (const admission of [
      source.slice(source.indexOf("  async start("), source.indexOf("  async getById(")),
      source.slice(source.indexOf("  async deriveRun("), source.indexOf("  async resumeRun(")),
    ]) {
      expect(admission).toContain("throw new QuotaAdmissionDenied(");
      expect(admission).toContain("error instanceof QuotaAdmissionDenied");
      expect(admission).toContain('kind: "quota_denied" as const');
    }
  });
});
