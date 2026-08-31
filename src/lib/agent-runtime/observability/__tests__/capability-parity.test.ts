import { CapabilityDispatcher, createCapabilityRegistry } from "@/lib/agent-tools";
import { describe, expect, it } from "vitest";
import { createObservabilityRegistrations } from "../capabilities";
import { InMemoryObservabilityRepository } from "../memory";
import { ObservabilityService } from "../service";
import type { SupportBundleApplication } from "../support-bundles";
import type { ObservabilityCursorCodec } from "../types";

const now = new Date("2026-08-01T12:00:00.000Z");
const codec: ObservabilityCursorCodec = {
  encode: async (value) => `cursor:${JSON.stringify(value)}`,
  decode: async (value) => value.startsWith("cursor:") ? JSON.parse(value.slice(7)) : null,
};

async function setup() {
  const repository = new InMemoryObservabilityRepository();
  const service = new ObservabilityService(repository, codec);
  await service.setRetention({
    workspaceId: "workspace_1",
    metricTtlSeconds: 3600,
    traceTtlSeconds: 600,
    supportBundleTtlSeconds: 600,
    actorUserId: "owner_1",
    idempotencyKey: "retention_1",
    recordedAt: now,
  });
  const registry = createCapabilityRegistry(
    createObservabilityRegistrations(
      service,
      {} as SupportBundleApplication,
      { now: () => new Date(now.getTime() + 1_000) },
    ),
  );
  const dispatcher = new CapabilityDispatcher(registry, {
    authorize: async (request) => ({
      allowed:
        request.securityContext.kind === "human" &&
        (request.audience === "human" || request.audience === "shared"),
      operatorTraceRef: `otr_${"f".repeat(32)}`,
    }),
  });
  const dispatch = (
    capability: string,
    input: unknown,
    context: {
      workspaceId?: string;
      userId?: string;
      role?: "owner" | "admin" | "member";
      idempotencyKey?: string;
    } = {},
  ) => dispatcher.dispatch(
    { capability, input },
    {
      securityContext: {
        kind: "human",
        workspaceId: context.workspaceId ?? "workspace_1",
        userId: context.userId ?? "owner_1",
        role: context.role ?? "owner",
        ...(context.idempotencyKey
          ? { idempotencyKey: context.idempotencyKey }
          : {}),
      },
    },
  );
  return { dispatch, repository, service };
}

describe("observability public authorization and redaction", () => {
  it("derives the operator from context and rejects caller identity fields", async () => {
    const { dispatch } = await setup();
    const forged = await dispatch(
      "telemetry_operator_grants.issue@1",
      {
        operatorId: "other_user",
        scopes: ["trace.read"],
        expiresAt: "2026-08-01T12:05:00.000Z",
      },
      { idempotencyKey: "grant-key-1" },
    );
    expect(forged).toMatchObject({
      type: "capability_error",
      code: "VALIDATION_FAILED",
    });

    const issued = await dispatch(
      "telemetry_operator_grants.issue@1",
      {
        scopes: ["trace.read"],
        expiresAt: "2026-08-01T12:05:00.000Z",
      },
      { idempotencyKey: "grant-key-2" },
    );
    expect(issued).toMatchObject({
      type: "capability_result",
      output: { status: "active", scopes: ["trace.read"] },
    });
    expect(JSON.stringify(issued)).not.toMatch(/operatorId|issuedByUserId|workspaceId/);
  });

  it("collapses foreign Workspace and foreign operator trace reads to unavailable", async () => {
    const { dispatch, service } = await setup();
    const traceRef = await service.recordTrace({
      workspaceId: "workspace_1",
      category: "provider",
      severity: "error",
      code: "PROVIDER_FAILED",
      stage: "execution",
      outcome: "failed",
      providerFamily: "openai",
      httpStatus: 500,
      retryable: true,
      durationMs: 12,
      attempt: 1,
      createdAt: now,
    });
    const issued = await dispatch(
      "telemetry_operator_grants.issue@1",
      { scopes: ["trace.read"], expiresAt: "2026-08-01T12:05:00.000Z" },
      { idempotencyKey: "grant-key-1" },
    );
    if (issued.type !== "capability_result") throw new Error("grant unavailable");
    const grantId = (issued.output as { id: string }).id;

    await expect(dispatch(
      "diagnostic_traces.get@1",
      { operatorTraceRef: traceRef, operatorGrantId: grantId },
      { workspaceId: "workspace_2" },
    )).resolves.toMatchObject({ type: "capability_error", code: "OBSERVABILITY_UNAVAILABLE", category: "not_found" });
    await expect(dispatch(
      "diagnostic_traces.get@1",
      { operatorTraceRef: traceRef, operatorGrantId: grantId },
      { userId: "other_user" },
    )).resolves.toMatchObject({ type: "capability_error", code: "OBSERVABILITY_UNAVAILABLE", category: "not_found" });
  });

  it("projects only low-cardinality metric fields under adversarial input", async () => {
    const { dispatch, service } = await setup();
    await service.recordMetricDelta({
      workspaceId: "workspace_1",
      eventId: "event_1",
      name: "runtime.run.count",
      dimensions: [{ key: "status", value: "completed" }],
      windowStartsAt: now,
      windowEndsAt: new Date(now.getTime() + 60_000),
      countDelta: 1,
      sumDelta: 1,
      recordedAt: now,
      prompt: "LEAK_CANARY",
      apiKey: "SECRET_CANARY",
    } as never);
    const result = await dispatch("operational_metrics.list@1", {
      limit: 50,
      cursor: null,
    });
    expect(result).toMatchObject({
      type: "capability_result",
      output: { items: [{ name: "runtime.run.count", count: 1 }] },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /LEAK_CANARY|SECRET_CANARY|workspaceId|eventId|expiresAt/,
    );
  });
});
