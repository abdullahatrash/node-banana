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
      capability: "workflow_runs.start@1",
      idempotencyKey: "idempotency-1",
      requestFingerprint: `sha256:${"d".repeat(64)}`,
      runId: "run_1",
      initialEventCursor: "cursor",
      createdAt: acceptedAt,
    },
    outboxIntent: {
      id: "outbox_1",
      workspaceId: "workspace_1",
      runId: "run_1",
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
});
