import { describe, expect, it } from "vitest";
import {
  CapabilityDispatcher,
  createCapabilityRegistry,
  dispatchCliCapability,
  dispatchMcpCapability,
} from "@/lib/agent-tools";
import { createUsageRegistrations } from "../capabilities";
import { InMemoryUsageRepository } from "../memory";
import { UsageLedgerService } from "../service";
import { AesGcmUsageCursorCodec } from "../cursor";

async function setup() {
  const repository = new InMemoryUsageRepository();
  const service = new UsageLedgerService(repository);
  await service.settleProviderOutcome({
    binding: {
      workspaceId: "workspace_1",
      principalId: "principal_1",
      workflowId: "workflow_1",
      runId: "run_1",
      stepAttemptId: "attempt_1",
      stepId: "step_1",
      attempt: 1,
      provider: "gemini",
      providerOperation: "generativelanguage.v1beta.models.generateContent",
      providerOperationRef: "provider_ref_1",
      model: "gemini-2.5-flash",
      effectKey: "effect_1",
    },
    interval: {
      startedAt: new Date("2026-08-01T00:00:00.000Z"),
      endedAt: new Date("2026-08-01T00:00:01.000Z"),
    },
    metadata: {
      evidence: {
        providerRequestId: "request_1",
        httpStatus: 200,
        providerCode: null,
        operatorTraceRef: "trace_1",
        effectDisposition: "accepted",
      },
      usage: [{
        dimension: "gemini.tokens.input@1",
        unit: "count",
        source: "reported",
        quantity: "10",
      }],
      retryAfterMs: null,
      pollAfterMs: null,
    },
    outcome: "succeeded",
    recordedAt: new Date("2026-08-01T00:00:01.000Z"),
  });
  const cursor = new AesGcmUsageCursorCodec(() => ({
    active: { id: "test", key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) },
    all: [{ id: "test", key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) }],
  }));
  const registry = createCapabilityRegistry(createUsageRegistrations(service, cursor));
  const dispatcher = new CapabilityDispatcher(registry, {
    authorize: async (request) => ({
      allowed:
        (request.audience === "agent" || request.audience === "shared") &&
        request.securityContext.kind === "agent",
      operatorTraceRef: "trace_auth",
    }),
  });
  const port = {
    dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
      dispatcher.dispatch(invocation, {
        securityContext: {
          kind: "agent",
          workspaceId: "workspace_1",
          principalId: "principal_1",
          keyId: "key_1",
        },
      }),
  };
  return { port, repository, service };
}

describe("Usage Ledger public capability parity", () => {
  it("returns identical exact-decimal evidence through CLI and MCP", async () => {
    const { port } = await setup();
    const cli = await dispatchCliCapability("usage_summaries.get@1", {}, port);
    const mcp = await dispatchMcpCapability("usage_summaries.get.v1", {}, port);
    expect(cli).toEqual(mcp);
    expect(cli).toMatchObject({
      type: "capability_result",
      output: {
        costSubtotals: [{ currency: "USD", amount: "0.000003" }],
        unknownValuationCount: 0,
        complete: true,
      },
    });
  });

  it("derives Agent Usage identity from security context", async () => {
    const { port } = await setup();
    const selected = await dispatchCliCapability(
      "agent_usage.get@1",
      { principalId: "principal_2" },
      port,
    );
    expect(selected).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
    const self = await dispatchCliCapability("agent_usage.get@1", {}, port);
    expect(self).toMatchObject({
      type: "capability_result",
      output: {
        principalId: "principal_1",
        reservationEvidence: {
          state: "unsupported",
          reasonCode: "RUNTIME_BUDGET_AND_QUOTA_NOT_AVAILABLE",
        },
      },
    });
  });

  it("does not expose records from another Workspace", async () => {
    const { port, repository } = await setup();
    const foreign = [...repository.usageRecords.values()][0]!;
    repository.usageRecords.set("foreign_record", {
      ...structuredClone(foreign),
      id: "foreign_record",
      binding: { ...foreign.binding, workspaceId: "workspace_2" },
    });
    const result = await dispatchCliCapability(
      "usage_records.get@1",
      { usageRecordId: "foreign_record" },
      port,
    );
    expect(result).toMatchObject({
      type: "capability_error",
      code: "USAGE_UNAVAILABLE",
      category: "not_found",
    });
  });

  it("continues list reads with a caller- and filter-bound opaque cursor", async () => {
    const { port, service } = await setup();
    await service.settleProviderOutcome({
      binding: {
        workspaceId: "workspace_1", principalId: "principal_1", workflowId: "workflow_1",
        runId: "run_1", stepAttemptId: "attempt_2", stepId: "step_2", attempt: 1,
        provider: "gemini", providerOperation: "generativelanguage.v1beta.models.generateContent",
        providerOperationRef: "provider_ref_2", model: "gemini-2.5-flash", effectKey: "effect_2",
      },
      interval: { startedAt: new Date("2026-08-01T00:00:02.000Z"), endedAt: new Date("2026-08-01T00:00:03.000Z") },
      metadata: null,
      outcome: "outcome_unknown",
      recordedAt: new Date("2026-08-01T00:00:03.000Z"),
    });
    const first = await dispatchCliCapability("usage_records.list@1", { limit: 1 }, port);
    expect(first).toMatchObject({ type: "capability_result", output: { items: [{ binding: { stepAttemptId: "attempt_2" } }], nextCursor: expect.any(String) } });
    if (first.type !== "capability_result") throw new Error("first page unavailable");
    const second = await dispatchCliCapability("usage_records.list@1", { limit: 1, cursor: (first.output as { nextCursor: string }).nextCursor }, port);
    expect(second).toMatchObject({ type: "capability_result", output: { items: [{ binding: { stepAttemptId: "attempt_1" } }], nextCursor: null } });
  });

  it("filters the projected direct Artifact attribution before bounded pagination", async () => {
    const { port, service } = await setup();
    await service.attributeGeneratedArtifact({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      runId: "run_1",
      stepAttemptId: "attempt_1",
      effectKey: "effect_1",
      settlementId: service.settlementIdFor({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        workflowId: "workflow_1",
        runId: "run_1",
        stepAttemptId: "attempt_1",
        stepId: "step_1",
        attempt: 1,
        provider: "gemini",
        providerOperation: "generativelanguage.v1beta.models.generateContent",
        providerOperationRef: "provider_ref_1",
        model: "gemini-2.5-flash",
        effectKey: "effect_1",
      }),
      artifactId: "artifact_1",
      outputName: "image",
      recordedAt: new Date("2026-08-01T00:00:02.000Z"),
    });
    const result = await dispatchCliCapability(
      "usage_records.list@1",
      { artifactId: "artifact_1", limit: 1 },
      port,
    );
    expect(result).toMatchObject({
      type: "capability_result",
      output: {
        items: [{ directArtifactId: "artifact_1" }],
        nextCursor: null,
      },
    });
  });
});
