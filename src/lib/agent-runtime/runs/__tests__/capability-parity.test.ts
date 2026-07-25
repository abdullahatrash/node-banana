import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  dispatchCliCapability,
  dispatchMcpCapability,
} from "@/lib/agent-tools/adapters";
import { CapabilityDispatcher } from "@/lib/agent-tools/dispatcher";
import {
  createCapabilityRegistry,
  createDiscoveryRegistrations,
} from "@/lib/agent-tools/registry";
import type {
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
} from "@/types/agentAuthorization";
import { AesGcmWorkflowRunEventCursorCodec } from "../cursor";
import { createDeterministicWorkflowRunExecutorRegistry } from "../executors";
import {
  InMemoryWorkflowRunQueue,
  InMemoryWorkflowRunRepository,
  InMemoryWorkflowRunRevisionReader,
} from "../memory";
import { createWorkflowRunRegistrations } from "../capabilities";
import { WorkflowRunService } from "../service";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "../../workflows";
import type { ResolvedWorkflowDefinition } from "../../workflows/types";

function setup() {
  const operation = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
    "runtime.digest_text@1",
  )!;
  const definition: ResolvedWorkflowDefinition = {
    schema: "content-workflow-revision-definition/v1",
    workflowId: "workflow_1",
    name: "Digest",
    inputs: { text: { kind: "text", required: true } },
    credentialSlots: {},
    steps: [{
      id: "digest",
      operation: {
        identity: operation.identity,
        contractDigest: operation.contractDigest,
      },
      inputs: { text: { from: "workflow_input", input: "text" } },
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
  const repository = new InMemoryWorkflowRunRepository();
  const revisions = new InMemoryWorkflowRunRevisionReader();
  revisions.put("workspace_1", {
    id: "revision_1",
    workflowId: "workflow_1",
    revision: 1,
    definitionDigest: canonicalDigest(definition),
    definition,
    operationRegistryDigest: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
  });
  const service = new WorkflowRunService(
    repository,
    revisions,
    new InMemoryWorkflowRunQueue(),
    createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    ),
    new AesGcmWorkflowRunEventCursorCodec(() => ({
      active: { id: "test", key: Buffer.alloc(32, 8) },
      all: [{ id: "test", key: Buffer.alloc(32, 8) }],
    })),
    { now: () => new Date("2026-07-25T12:00:00.000Z") },
  );
  const requests: CapabilityAuthorizationRequest[] = [];
  const authorizer: CapabilityAuthorizer = {
    authorize: async (request) => {
      requests.push(request);
      return {
        allowed: true,
        operatorTraceRef: `trace_${requests.length}`,
        effectiveResources: {
          channelIds: [],
          credentialProfileIds: [],
          workflowIds: ["workflow_1"],
          automationIds: [],
          artifactIds: [],
        },
      };
    },
  };
  const registry = createCapabilityRegistry([
    ...createDiscoveryRegistrations(),
    ...createWorkflowRunRegistrations(service),
  ]);
  const canonical = new CapabilityDispatcher(registry, authorizer);
  const dispatcher = {
    dispatch: (invocation: Parameters<typeof canonical.dispatch>[0]) =>
      canonical.dispatch(invocation, {
        securityContext: {
          kind: "agent",
          workspaceId: "workspace_1",
          principalId: "principal_1",
          keyId: "key_1",
        },
      }),
  };
  return { dispatcher, registry, requests, service };
}

describe("Workflow Run capability parity", () => {
  it("returns one stable durable acceptance across CLI and MCP", async () => {
    const { dispatcher } = setup();
    const input = {
      workflowId: "workflow_1",
      revisionId: "revision_1",
      idempotencyKey: "start-capability-1",
      inputs: { text: "hello" },
    };
    const cli = await dispatchCliCapability(
      "workflow_runs.start@1",
      input,
      dispatcher,
    );
    const mcp = await dispatchMcpCapability(
      "workflow_runs.start.v1",
      input,
      dispatcher,
    );
    expect(cli.type).toBe("capability_result");
    expect(mcp.type).toBe("capability_result");
    expect(cli).toMatchObject({ status: "accepted" });
    expect((mcp as { output: unknown }).output).toEqual(
      (cli as { output: unknown }).output,
    );
  });

  it("authorizes all public Run capabilities through the exact Workflow selector", async () => {
    const { dispatcher, requests } = setup();
    const started = await dispatchCliCapability(
      "workflow_runs.start@1",
      {
        workflowId: "workflow_1",
        revisionId: "revision_1",
        idempotencyKey: "start-capability-1",
        inputs: { text: "hello" },
      },
      dispatcher,
    );
    const accepted = (started as {
      output: {
        run: { id: string };
        events: { input: { cursor: string } };
      };
    }).output;
    await dispatchCliCapability(
      "workflow_runs.get@1",
      { workflowId: "workflow_1", runId: accepted.run.id },
      dispatcher,
    );
    await dispatchCliCapability(
      "workflow_run_events.list@1",
      {
        workflowId: "workflow_1",
        runId: accepted.run.id,
        cursor: accepted.events.input.cursor,
      },
      dispatcher,
    );
    expect(requests.slice(-3).map((request) => request.resources)).toEqual([
      [{ kind: "workflow", id: "workflow_1" }],
      [{ kind: "workflow", id: "workflow_1" }],
      [{ kind: "workflow", id: "workflow_1" }],
    ]);
  });

  it("publishes only Run resources and contains no coordination-plane leak", async () => {
    const { dispatcher, registry } = setup();
    const runDefinitions = registry
      .listDefinitions()
      .filter((entry) =>
        entry.identity.name.startsWith("workflow_run"),
      );
    expect(runDefinitions.map(({ identity }) => identity.name).sort()).toEqual([
      "workflow_run_events.list",
      "workflow_runs.get",
      "workflow_runs.start",
    ]);
    const started = await dispatchCliCapability(
      "workflow_runs.start@1",
      {
        workflowId: "workflow_1",
        revisionId: "revision_1",
        idempotencyKey: "start-capability-1",
        inputs: { text: "hello" },
      },
      dispatcher,
    );
    const serialized = JSON.stringify({ runDefinitions, started });
    for (const forbidden of [
      "outbox",
      "lease",
      "fence",
      "workerId",
      "deliveryToken",
      "dedupeKey",
      "orchestrator",
      "\"job\"",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
