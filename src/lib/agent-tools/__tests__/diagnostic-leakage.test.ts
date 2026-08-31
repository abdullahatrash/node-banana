import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CapabilityDispatcher,
  CapabilityFailure,
  COMMON_DISCOVERY_ERRORS,
  QUERY_EFFECT,
  createCapabilityRegistry,
  defineCapability,
} from "@/lib/agent-tools";

const IDENTITY = { name: "fixtures.diagnostic", version: 1 } as const;
const SECURITY_CONTEXT = {
  kind: "agent" as const,
  principalId: "principal-safe",
  workspaceId: "workspace-safe",
  keyId: "key-safe",
};

function registry(handler: (input: { prompt: string }) => unknown) {
  return createCapabilityRegistry([
    defineCapability({
      identity: IDENTITY,
      summary: "Diagnostic fixture.",
      lifecycle: {
        status: "active",
        introducedAt: "2026-08-01T00:00:00.000Z",
        recommended: true,
      },
      input: z.object({ prompt: z.string() }).strict(),
      outputSchema: { type: "object" },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: COMMON_DISCOVERY_ERRORS,
      handler,
    }),
  ]);
}

describe("CapabilityDispatcher diagnostic leakage boundary", () => {
  it("records only fixed fields and publishes a closed, secret-safe error", async () => {
    const canary =
      "PROMPT_CANARY Authorization: Bearer secret Cookie=private https://signed.example";
    const recorder = vi.fn(async () => "otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const dispatcher = new CapabilityDispatcher(
      registry(() => {
        throw new CapabilityFailure({
          code: "FIXTURE_FAILED",
          category: "internal",
          message: canary,
          details: { providerBody: canary },
          remediation: {
            capability: { name: "fixtures.safe_remediation", version: 1 },
            input: { prompt: canary },
          },
          retryable: true,
        });
      }),
      { authorize: async () => ({ allowed: true }) },
      recorder,
    );

    const response = await dispatcher.dispatch(
      { capability: IDENTITY, input: { prompt: canary } },
      { securityContext: SECURITY_CONTEXT },
    );

    expect(response).toMatchObject({
      type: "capability_error",
      code: "FIXTURE_FAILED",
      message: "The capability request could not be completed.",
      remediation: {
        capability: { name: "fixtures.safe_remediation", version: 1 },
      },
      operatorTraceRef: "otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(response).not.toHaveProperty("details");
    expect(JSON.stringify(response)).not.toContain(canary);
    expect(recorder).toHaveBeenCalledWith({
      workspaceId: "workspace-safe",
      category: "runtime",
      severity: "error",
      code: "FIXTURE_FAILED",
      stage: "execution",
      outcome: "failed",
      providerFamily: "internal",
      httpStatus: null,
      retryable: true,
      durationMs: null,
      attempt: null,
      createdAt: expect.any(Date),
    });
    expect(JSON.stringify(recorder.mock.calls)).not.toContain(canary);
  });

  it("does not manufacture an unresolvable reference when recording fails", async () => {
    const recorder = vi.fn(async () => {
      throw new Error("diagnostic-secret");
    });
    const dispatcher = new CapabilityDispatcher(
      registry(() => {
        throw new Error("provider-secret");
      }),
      { authorize: async () => ({ allowed: true }) },
      recorder,
    );

    const first = await dispatcher.dispatch(
      { capability: IDENTITY, input: { prompt: "private" } },
      { securityContext: SECURITY_CONTEXT },
    );
    const second = await dispatcher.dispatch(
      { capability: IDENTITY, input: { prompt: "private" } },
      { securityContext: SECURITY_CONTEXT },
    );

    expect(first).toMatchObject({
      type: "capability_error",
      code: "INTERNAL_ERROR",
      operatorTraceRef: null,
    });
    expect(second).toMatchObject({
      type: "capability_error",
      code: "INTERNAL_ERROR",
      operatorTraceRef: null,
    });
  });

  it("records authorization denials and exposes only the resolvable diagnostic reference", async () => {
    const valid = "otr_cccccccccccccccccccccccccccccccc";
    const recorder = vi.fn(async () => "otr_dddddddddddddddddddddddddddddddd");
    const validDispatcher = new CapabilityDispatcher(
      registry(() => ({ ok: true })),
      {
        authorize: async () => ({
          allowed: false,
          code: "CAPABILITY_NOT_AUTHORIZED",
          operatorTraceRef: valid,
        }),
      },
      recorder,
    );
    const validResponse = await validDispatcher.dispatch(
      { capability: IDENTITY, input: { prompt: "private" } },
      { securityContext: SECURITY_CONTEXT },
    );
    expect(validResponse).toMatchObject({
      message:
        "Capability fixtures.diagnostic@1 is not authorized. Ask a Workspace owner or admin to grant that exact capability and its required resources.",
      operatorTraceRef: "otr_dddddddddddddddddddddddddddddddd",
    });
    expect(recorder).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-safe",
      category: "authorization",
      code: "CAPABILITY_NOT_AUTHORIZED",
      stage: "admission",
      outcome: "denied",
    }));

    const injectedDispatcher = new CapabilityDispatcher(
      registry(() => ({ ok: true })),
      {
        authorize: async () => ({
          allowed: false,
          code: "CAPABILITY_NOT_AUTHORIZED",
          operatorTraceRef: "trace_request_digest_or_caller_value",
        }),
      },
      recorder,
    );
    const injectedResponse = await injectedDispatcher.dispatch(
      { capability: IDENTITY, input: { prompt: "private" } },
      { securityContext: SECURITY_CONTEXT },
    );
    expect(injectedResponse).toMatchObject({
      operatorTraceRef: "otr_dddddddddddddddddddddddddddddddd",
    });
  });

  it("publishes no authorization reference when durable recording is unavailable", async () => {
    const recorder = vi.fn(async () => null);
    const dispatcher = new CapabilityDispatcher(
      registry(() => ({ ok: true })),
      {
        authorize: async () => ({
          allowed: false,
          code: "CAPABILITY_NOT_AUTHORIZED",
          message: "Authorization: Bearer decision-secret",
          operatorTraceRef: "otr_cccccccccccccccccccccccccccccccc",
        }),
      },
      recorder,
    );

    const response = await dispatcher.dispatch(
      { capability: IDENTITY, input: { prompt: "private" } },
      { securityContext: SECURITY_CONTEXT },
    );

    expect(response).toMatchObject({
      type: "capability_error",
      message:
        "Capability fixtures.diagnostic@1 is not authorized. Ask a Workspace owner or admin to grant that exact capability and its required resources.",
      operatorTraceRef: null,
    });
    expect(JSON.stringify(response)).not.toContain("decision-secret");
  });

  it("normalizes hostile runtime error metadata", async () => {
    const dispatcher = new CapabilityDispatcher(
      registry(() => {
        throw new CapabilityFailure({
          code: "provider-secret\nAuthorization: Bearer secret",
          category: "provider-secret" as never,
          message: "message-secret",
          retryable: "yes" as never,
        });
      }),
      { authorize: async () => ({ allowed: true }) },
    );

    const response = await dispatcher.dispatch(
      { capability: IDENTITY, input: { prompt: "private" } },
      { securityContext: SECURITY_CONTEXT },
    );

    expect(response).toMatchObject({
      code: "CAPABILITY_FAILURE",
      category: "internal",
      message: "The capability request could not be completed.",
      retryable: false,
      operatorTraceRef: null,
    });
    expect(JSON.stringify(response)).not.toContain("secret");
  });
});
