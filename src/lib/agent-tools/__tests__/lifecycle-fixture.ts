import { z } from "zod";
import {
  COMMON_DISCOVERY_ERRORS,
  CapabilityDispatcher,
  createCapabilityRegistry,
  createDiscoveryRegistrations,
} from "@/lib/agent-tools";
import type {
  CapabilityDispatcherPort,
  CapabilityInvocation,
} from "@/types/capabilities";

const TEST_SECURITY_CONTEXT = {
  principalId: "principal-fixture",
  workspaceId: "workspace-fixture",
  keyId: "key-fixture",
};

export function createLifecycleTestDispatcher(): CapabilityDispatcherPort {
  const base = {
    summary: "Lifecycle parity fixture.",
    input: z.object({}).strict(),
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: { ok: { type: "boolean" } },
    },
    effect: {
      mutation: "none",
      visibility: "private",
      timing: "immediate",
      reversibility: "reversible",
      maySpendProviderBudget: false,
    } as const,
    approval: { mode: "none" } as const,
    idempotency: { mode: "retry-safe" } as const,
    authorization: { resources: [] },
    errors: COMMON_DISCOVERY_ERRORS,
    handler: () => ({ ok: true }),
  };
  const dispatcher = new CapabilityDispatcher(
    createCapabilityRegistry([
      ...createDiscoveryRegistrations(),
      {
        ...base,
        identity: { name: "fixtures.active", version: 1 },
        lifecycle: {
          status: "active",
          introducedAt: "2026-01-01T00:00:00.000Z",
          recommended: true,
        },
      },
      {
        ...base,
        identity: { name: "fixtures.deprecated", version: 1 },
        lifecycle: {
          status: "deprecated",
          introducedAt: "2026-01-01T00:00:00.000Z",
          deprecatedAt: "2026-02-01T00:00:00.000Z",
          sunsetAt: "2026-08-01T00:00:00.000Z",
          recommended: false,
          replacement: { name: "fixtures.active", version: 1 },
        },
      },
      {
        ...base,
        identity: { name: "fixtures.retired", version: 1 },
        lifecycle: {
          status: "retired",
          introducedAt: "2026-01-01T00:00:00.000Z",
          retiredAt: "2026-03-01T00:00:00.000Z",
          recommended: false,
          replacement: { name: "fixtures.active", version: 1 },
        },
      },
    ]),
    { authorize: async () => ({ allowed: true }) },
  );
  return {
    dispatch: (invocation: CapabilityInvocation) =>
      dispatcher.dispatch(invocation, {
        securityContext: TEST_SECURITY_CONTEXT,
      }),
  };
}
