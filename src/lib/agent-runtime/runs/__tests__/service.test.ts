import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it } from "vitest";
import { AesGcmWorkflowRunEventCursorCodec } from "../cursor";
import { createDeterministicWorkflowRunExecutorRegistry } from "../executors";
import {
  InMemoryWorkflowRunQueue,
  InMemoryWorkflowRunRepository,
  InMemoryWorkflowRunRevisionReader,
} from "../memory";
import { WorkflowRunService } from "../service";
import { workflowRunWorkerId } from "../worker-identity";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "../../workflows";
import type { ResolvedWorkflowDefinition } from "../../workflows/types";

function definition(
  operation = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
    "runtime.digest_text@1",
  )!,
): ResolvedWorkflowDefinition {
  return {
    schema: "content-workflow-revision-definition/v1",
    workflowId: "workflow_1",
    name: "Deterministic digest",
    inputs: {
      text: { kind: "text", required: true },
    },
    credentialSlots: {},
    steps: [{
      id: "digest",
      operation: {
        identity: operation.identity,
        contractDigest: operation.contractDigest,
      },
      inputs: {
        text: { from: "workflow_input", input: "text" },
      },
      credentials: {},
      config: {},
      retry: {
        maxAttempts: 1,
        backoff: { initialMs: 0, maxMs: 0, multiplier: 1 },
      },
    }],
    outputs: {
      textDigest: {
        kind: "text",
        binding: {
          from: "step_output",
          step: "digest",
          output: "textDigest",
        },
      },
    },
  };
}

function setup() {
  const repository = new InMemoryWorkflowRunRepository();
  const revisions = new InMemoryWorkflowRunRevisionReader();
  const queue = new InMemoryWorkflowRunQueue();
  const cursor = new AesGcmWorkflowRunEventCursorCodec(() => ({
    active: { id: "test", key: Buffer.alloc(32, 7) },
    all: [{ id: "test", key: Buffer.alloc(32, 7) }],
  }));
  let now = new Date("2026-07-25T12:00:00.000Z");
  const resolved = definition();
  revisions.put("workspace_1", {
    id: "revision_1",
    workflowId: "workflow_1",
    revision: 1,
    definitionDigest: canonicalDigest(resolved),
    definition: resolved,
    operationRegistryDigest: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
  });
  const service = new WorkflowRunService(
    repository,
    revisions,
    queue,
    createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    ),
    cursor,
    { now: () => new Date(now) },
  );
  const start = (overrides: Partial<Parameters<typeof service.start>[0]> = {}) =>
    service.start({
      workspaceId: "workspace_1",
      workflowId: "workflow_1",
      revisionId: "revision_1",
      inputs: { text: "hello" },
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef: "trace_original",
      idempotencyKey: "start-run-1",
      ...overrides,
    });
  return {
    repository,
    revisions,
    queue,
    cursor,
    service,
    start,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("WorkflowRunService", () => {
  it("atomically accepts the Run, immutable snapshot, event, receipt, and outbox", async () => {
    const { repository, start } = setup();
    const accepted = await start();
    expect(accepted.run.state).toBe("accepted");
    expect(accepted.inspect).toEqual({
      capability: "workflow_runs.get@1",
      input: {
        workflowId: "workflow_1",
        runId: accepted.run.id,
      },
    });
    expect(accepted.events.capability).toBe("workflow_run_events.list@1");
    expect(repository.runs.size).toBe(1);
    expect(repository.events.size).toBe(1);
    expect(repository.receipts.size).toBe(1);
    expect(repository.outbox.size).toBe(1);
    const stored = [...repository.runs.values()][0];
    expect(stored.startSnapshot.operationContracts).toEqual([
      expect.objectContaining({ identity: "runtime.digest_text@1" }),
    ]);
    expect(stored.startSnapshot.artifactReferences).toEqual([]);
    expect(stored.startSnapshot.credentialReferences).toEqual([]);
    expect(Object.isFrozen(stored.startSnapshot)).toBe(true);
    expect([...repository.outbox.values()][0].dedupeKey).toBe(
      `workflow-run:workspace_1:${accepted.run.id}:v1`,
    );
  });

  it("rolls back every acceptance record when the atomic start fails", async () => {
    const { repository, start } = setup();
    repository.failNextStart = true;
    await expect(start()).rejects.toMatchObject({
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
    });
    expect(repository.runs.size).toBe(0);
    expect(repository.events.size).toBe(0);
    expect(repository.receipts.size).toBe(0);
    expect(repository.outbox.size).toBe(0);
  });

  it("replays immutable acceptance with fresh evidence, even after completion", async () => {
    const { service, start } = setup();
    const accepted = await start();
    await service.executeOne({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_1",
    });
    const replay = await start({
      authorizationEvidenceRef: "trace_retry",
    });
    expect(replay).toEqual(accepted);
    expect(replay.run.state).toBe("accepted");
    await expect(
      service.get({
        workspaceId: "workspace_1",
        workflowId: "workflow_1",
        runId: accepted.run.id,
      }),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it("replays idempotent acceptance across Agent key rotation", async () => {
    const { repository, start } = setup();
    const first = await start();
    const second = await start({
      keyId: "key_2",
      authorizationEvidenceRef: "trace_rotated_key",
    });
    expect(second).toEqual(first);
    expect(repository.runs.size).toBe(1);
    expect(repository.receipts.size).toBe(1);
  });

  it("relays one identifier-only stable schedule and is retry safe", async () => {
    const { queue, service, start } = setup();
    const accepted = await start();
    await expect(service.relayNext()).resolves.toEqual({
      delivered: true,
      runId: accepted.run.id,
    });
    await expect(service.relayNext()).resolves.toEqual({ delivered: false });
    expect([...queue.scheduled.entries()]).toEqual([
      [
        `workflow-run:workspace_1:${accepted.run.id}:v1`,
        { workspaceId: "workspace_1", runId: accepted.run.id },
      ],
    ]);
  });

  it("advances accepted to completed under a fence with gap-free retained events", async () => {
    const { service, start } = setup();
    const accepted = await start();
    const completed = await service.executeOne({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_1",
    });
    expect(completed).toMatchObject({
      state: "completed",
      failureCode: null,
      output: { textDigest: canonicalDigest("hello") },
    });
    const page = await service.listEvents({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      workflowId: "workflow_1",
      runId: accepted.run.id,
      cursor: accepted.events.input.cursor,
    });
    expect(page.items.map(({ sequence, type }) => ({ sequence, type }))).toEqual([
      { sequence: 1, type: "run.accepted" },
      { sequence: 2, type: "step.completed" },
      { sequence: 3, type: "run.completed" },
    ]);
    await expect(
      service.listEvents({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        workflowId: "workflow_1",
        runId: accepted.run.id,
        cursor: page.nextCursor,
      }),
    ).resolves.toMatchObject({ items: [] });
  });

  it("rejects stale fences after lease takeover", async () => {
    const { advance, repository, start } = setup();
    const accepted = await start();
    const first = await repository.acquireLease({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_1",
      now: new Date("2026-07-25T12:00:00.000Z"),
      expiresAt: new Date("2026-07-25T12:00:01.000Z"),
    });
    expect(first.kind).toBe("acquired");
    advance(2_000);
    const second = await repository.acquireLease({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_2",
      now: new Date("2026-07-25T12:00:02.000Z"),
      expiresAt: new Date("2026-07-25T12:00:32.000Z"),
    });
    expect(second.kind).toBe("acquired");
    if (first.kind !== "acquired" || second.kind !== "acquired") return;
    expect(second.lease.fence > first.lease.fence).toBe(true);
    await expect(
      repository.completeStep({
        workspaceId: "workspace_1",
        runId: accepted.run.id,
        workerId: first.lease.workerId,
        token: first.lease.token,
        fence: first.lease.fence,
        output: {},
        completedAt: new Date("2026-07-25T12:00:02.000Z"),
        stepEventId: "event_step_stale",
        runEventId: "event_run_stale",
      }),
    ).resolves.toEqual({ kind: "stale_fence" });
  });

  it("keeps completion persistence failures reentrant instead of marking failed", async () => {
    const { repository, service, start } = setup();
    const accepted = await start();
    const workerId = workflowRunWorkerId("stable-sdk-step-id");
    repository.failNextFinish = true;
    await expect(
      service.executeOne({
        workspaceId: "workspace_1",
        runId: accepted.run.id,
        workerId,
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
    });
    expect([...repository.runs.values()][0].state).toBe("running");
    expect([...repository.events.values()][0]).toHaveLength(1);
    await expect(
      service.executeOne({
        workspaceId: "workspace_1",
        runId: accepted.run.id,
        workerId,
      }),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it("rejects provider, credential, image, and mismatched operation contracts", async () => {
    const { revisions, start } = setup();
    const provider = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
      "gemini.generate_text@1",
    )!;
    for (const [id, changed] of [
      ["revision_provider", definition(provider)],
      [
        "revision_mismatch",
        definition({
          ...GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("runtime.digest_text@1")!,
          contractDigest: `sha256:${"f".repeat(64)}`,
        }),
      ],
    ] as const) {
      revisions.put("workspace_1", {
        id,
        workflowId: "workflow_1",
        revision: 2,
        definitionDigest: canonicalDigest(changed),
        definition: changed,
        operationRegistryDigest: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
      });
      await expect(
        start({ revisionId: id, idempotencyKey: `start-${id}` }),
      ).rejects.toMatchObject({ code: "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW" });
    }
  });

  it("binds event cursors to Workspace, Principal, Workflow, and Run", async () => {
    const { service, start } = setup();
    const accepted = await start();
    await expect(
      service.listEvents({
        workspaceId: "workspace_1",
        principalId: "principal_2",
        workflowId: "workflow_1",
        runId: accepted.run.id,
        cursor: accepted.events.input.cursor,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_RUN_INVALID_INPUT" });
  });
});
