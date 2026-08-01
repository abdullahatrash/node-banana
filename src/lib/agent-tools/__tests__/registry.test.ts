import { z } from "zod";
import {
  CAPABILITY_GET_IDENTITY,
  CAPABILITY_LIST_IDENTITY,
  CapabilityDispatcher,
  COMMON_DISCOVERY_ERRORS,
  canonicalDigest,
  contractDigestFor,
  createCapabilityRegistry,
  dispatchMcpCapability,
  formatCapabilityIdentity,
  listMcpCapabilityTools,
  type CapabilityDefinition,
  type CapabilityRegistration,
} from "@/lib/agent-tools";
import { PRODUCTION_CAPABILITY_REGISTRY as CAPABILITY_REGISTRY } from "@/lib/agent-runtime/server-dispatcher";
import type { CapabilityDispatcherPort } from "@/types";

const TEST_DISPATCHER: CapabilityDispatcherPort = (() => {
  const dispatcher = new CapabilityDispatcher(CAPABILITY_REGISTRY, {
    authorize: async (request) => ({
      allowed:
        (request.audience === "agent" || request.audience === "shared") &&
        request.securityContext.kind === "agent",
    }),
  });
  return {
    dispatch: (invocation) =>
      dispatcher.dispatch(invocation, {
        securityContext: {
          kind: "agent",
          principalId: "principal-registry",
          workspaceId: "workspace-registry",
          keyId: "key-registry",
        },
      }),
  };
})();

function contractWithoutPublication(
  definition: CapabilityDefinition,
): Omit<CapabilityDefinition, "contractDigest" | "lifecycle"> {
  const { contractDigest: _digest, lifecycle: _lifecycle, ...contract } =
    definition;
  return contract;
}

describe("production Capability Registry", () => {
  it("publishes the two exact discovery contracts with canonical digests", async () => {
    const response = await TEST_DISPATCHER.dispatch({
      capability: CAPABILITY_LIST_IDENTITY,
      input: {},
    });

    expect(response.type).toBe("capability_result");
    if (response.type !== "capability_result") return;

    const output = response.output as {
      items: CapabilityDefinition[];
      registryDigest: string;
    };
    expect(
      output.items.map((definition) =>
        formatCapabilityIdentity(definition.identity),
      ),
    ).toEqual([
      "agent_usage.get@1",
      "agents.current.get@1",
      "artifact_downloads.create@1",
      "artifact_uploads.begin@1",
      "artifact_uploads.complete@1",
      "artifacts.get@1",
      "artifacts.import@1",
      "artifacts.list@1",
      "budget_policies.get_effective@1",
      "budget_policies.list@1",
      "budget_policy_revisions.create@1",
      "budget_reservations.list@1",
      "capabilities.get@1",
      "capabilities.list@1",
      "cost_valuations.get@1",
      "cost_valuations.list@1",
      "credentials.audit.export@1",
      "credentials.audit.list@1",
      "credentials.profile.get@1",
      "credentials.profile.list@1",
      "credentials.profiles.create@1",
      "credentials.profiles.list@1",
      "credentials.profiles.reprovision@1",
      "credentials.profiles.rotate@1",
      "credentials.profiles.status.set@1",
      "credentials.spend_grants.create@1",
      "credentials.spend_grants.list@1",
      "credentials.spend_grants.revoke@1",
      "credentials.versions.revoke@1",
      "pricing_overrides.create@1",
      "pricing_overrides.list@1",
      "pricing_overrides.revoke@1",
      "spend_controls.get@1",
      "spend_controls.resume@1",
      "spend_controls.suspend@1",
      "usage_events.list@1",
      "usage_records.get@1",
      "usage_records.list@1",
      "usage_summaries.get@1",
      "workflow_operations.get@1",
      "workflow_operations.list@1",
      "workflow_run_artifacts.get@1",
      "workflow_run_events.list@1",
      "workflow_runs.get@1",
      "workflow_runs.preview@1",
      "workflow_runs.reconcile@1",
      "workflow_runs.resume@1",
      "workflow_runs.retry@1",
      "workflow_runs.start@1",
      "workflow_runs.start@2",
      "workflow_step_attempts.list@1",
      "workflow_versions.create@1",
      "workflow_versions.get@1",
      "workflow_versions.validate@1",
      "workflows.create@1",
    ]);
    expect(output.registryDigest).toBe(CAPABILITY_REGISTRY.digest);

    for (const definition of output.items) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(definition.contractDigest).toBe(
        contractDigestFor(contractWithoutPublication(definition)),
      );
      expect(definition.lifecycle).toMatchObject({
        status: "active",
        recommended:
          formatCapabilityIdentity(definition.identity) !==
          "workflow_runs.start@1",
      });
      expect(definition.schemas.input).toMatchObject({ type: "object" });
      expect(definition.schemas.output).toMatchObject({ type: "object" });
      if (
        (definition.audience === "agent" || definition.audience === "shared") &&
        definition.effect.mutation === "none"
      ) {
        expect(definition.effect).toEqual({
          mutation: "none",
          visibility: "private",
          timing: "immediate",
          reversibility: "reversible",
          maySpendProviderBudget: false,
        });
        expect(definition.approval).toEqual({ mode: "none" });
        expect(definition.idempotency).toEqual({ mode: "retry-safe" });
      }
      expect(definition.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining(
          definition.audience === "human"
            ? ["HUMAN_CAPABILITY_NOT_AUTHORIZED", "VALIDATION_FAILED"]
            : [
                "CAPABILITY_NOT_FOUND",
                "CAPABILITY_VERSION_RETIRED",
                "VALIDATION_FAILED",
              ],
        ),
      );
    }
  });

  it("gets an exact definition and returns a stable error for an unknown one", async () => {
    const found = await TEST_DISPATCHER.dispatch({
      capability: CAPABILITY_GET_IDENTITY,
      input: CAPABILITY_LIST_IDENTITY,
    });
    expect(found).toMatchObject({
      type: "capability_result",
      capability: CAPABILITY_GET_IDENTITY,
      status: "completed",
      output: { identity: CAPABILITY_LIST_IDENTITY },
    });

    const missing = await TEST_DISPATCHER.dispatch({
      capability: CAPABILITY_GET_IDENTITY,
      input: { name: "missing.capability", version: 1 },
    });
    expect(missing).toMatchObject({
      type: "capability_error",
      capability: CAPABILITY_GET_IDENTITY,
      code: "CAPABILITY_NOT_FOUND",
      category: "not_found",
      retryable: false,
    });
  });

  it("rejects aliases and never generates an executable latest tool", async () => {
    const response = await TEST_DISPATCHER.dispatch({
      capability: "capabilities.list@latest",
      input: {},
    });
    expect(response).toMatchObject({
      type: "capability_error",
      capability: null,
      code: "CAPABILITY_IDENTITY_INVALID",
    });
    const mcpTools = await listMcpCapabilityTools(TEST_DISPATCHER);
    expect(mcpTools.map((tool) => tool.name)).toEqual([
      "agent_usage.get.v1",
      "agents.current.get.v1",
      "artifact_downloads.create.v1",
      "artifact_uploads.begin.v1",
      "artifact_uploads.complete.v1",
      "artifacts.get.v1",
      "artifacts.import.v1",
      "artifacts.list.v1",
      "budget_policies.get_effective.v1",
      "budget_policies.list.v1",
      "budget_policy_revisions.create.v1",
      "budget_reservations.list.v1",
      "capabilities.get.v1",
      "capabilities.list.v1",
      "cost_valuations.get.v1",
      "cost_valuations.list.v1",
      "credentials.audit.export.v1",
      "credentials.audit.list.v1",
      "credentials.profile.get.v1",
      "credentials.profile.list.v1",
      "credentials.profiles.create.v1",
      "credentials.profiles.list.v1",
      "credentials.profiles.reprovision.v1",
      "credentials.profiles.rotate.v1",
      "credentials.profiles.status.set.v1",
      "credentials.spend_grants.create.v1",
      "credentials.spend_grants.list.v1",
      "credentials.spend_grants.revoke.v1",
      "credentials.versions.revoke.v1",
      "pricing_overrides.create.v1",
      "pricing_overrides.list.v1",
      "pricing_overrides.revoke.v1",
      "spend_controls.get.v1",
      "spend_controls.resume.v1",
      "spend_controls.suspend.v1",
      "usage_events.list.v1",
      "usage_records.get.v1",
      "usage_records.list.v1",
      "usage_summaries.get.v1",
      "workflow_operations.get.v1",
      "workflow_operations.list.v1",
      "workflow_run_artifacts.get.v1",
      "workflow_run_events.list.v1",
      "workflow_runs.get.v1",
      "workflow_runs.preview.v1",
      "workflow_runs.reconcile.v1",
      "workflow_runs.resume.v1",
      "workflow_runs.retry.v1",
      "workflow_runs.start.v1",
      "workflow_runs.start.v2",
      "workflow_step_attempts.list.v1",
      "workflow_versions.create.v1",
      "workflow_versions.get.v1",
      "workflow_versions.validate.v1",
      "workflows.create.v1",
    ]);
    expect(mcpTools.some((tool) => tool.name.includes("latest"))).toBe(false);
    expect(
      mcpTools.find(
        (tool) => tool.name === "credentials.profiles.list.v1",
      )?.description,
    ).toContain("Human-only");
    expect(
      mcpTools.some((tool) => tool.name === "credentials.effect.execute.v1"),
    ).toBe(false);
    await expect(
      dispatchMcpCapability(
        "credentials.profiles.list.v1",
        {},
        TEST_DISPATCHER,
      ),
    ).resolves.toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
  });

  it("fully specifies every structured field in discovery output schemas", async () => {
    const response = await TEST_DISPATCHER.dispatch({
      capability: CAPABILITY_GET_IDENTITY,
      input: CAPABILITY_GET_IDENTITY,
    });
    expect(response.type).toBe("capability_result");
    if (response.type !== "capability_result") return;

    const definition = response.output as CapabilityDefinition;
    const outputSchema = definition.schemas.output as {
      properties: Record<string, Record<string, unknown>>;
    };
    const properties = outputSchema.properties;

    expect(properties.lifecycle).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["status", "introducedAt", "recommended"],
      properties: {
        status: {
          enum: ["experimental", "active", "deprecated", "retired"],
        },
        replacement: {
          required: ["name", "version"],
        },
      },
    });
    expect(properties.schemas).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["input", "output"],
      properties: {
        input: { $ref: "http://json-schema.org/draft-07/schema#" },
        output: { $ref: "http://json-schema.org/draft-07/schema#" },
      },
    });
    expect(properties.effect).toMatchObject({
      additionalProperties: false,
      required: [
        "mutation",
        "visibility",
        "timing",
        "reversibility",
        "maySpendProviderBudget",
      ],
      properties: {
        mutation: { enum: ["none", "runtime-state", "external-system"] },
      },
    });
    expect(properties.approval).toMatchObject({
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: {
          enum: ["none", "manages-approval", "required-before-effect"],
        },
      },
    });
    expect(properties.idempotency).toMatchObject({
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: { enum: ["retry-safe", "intrinsic", "key-required"] },
      },
    });
    expect(properties.errors).toMatchObject({
      type: "array",
      minItems: 1,
      items: {
        additionalProperties: false,
        required: ["code", "category", "retryable", "description"],
        properties: {
          code: { pattern: "^[A-Z][A-Z0-9_]*$" },
          category: {
            enum: [
              "validation",
              "not_found",
              "lifecycle",
              "authorization",
              "approval",
              "conflict",
              "internal",
            ],
          },
        },
      },
    });
  });

  it("canonicalizes object key order for contract and request digests", () => {
    expect(canonicalDigest({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalDigest({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("derives accepted status for durable asynchronous effects", async () => {
    const durable: CapabilityRegistration = {
      identity: { name: "fixtures.durable", version: 1 },
      summary: "Accept a durable fixture.",
      lifecycle: {
        status: "active",
        introducedAt: "2026-01-01T00:00:00.000Z",
        recommended: true,
      },
      input: z.object({}).strict(),
      outputSchema: { type: "object" },
      effect: {
        mutation: "runtime-state",
        visibility: "private",
        timing: "durable-async",
        reversibility: "conditional",
        maySpendProviderBudget: false,
      },
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: { resources: [] },
      errors: COMMON_DISCOVERY_ERRORS,
      handler: () => ({ accepted: true }),
    };
    const dispatcher = new CapabilityDispatcher(
      createCapabilityRegistry([durable]),
      { authorize: async () => ({ allowed: true }) },
    );

    await expect(
      dispatcher.dispatch(
        { capability: durable.identity, input: {} },
        {
          securityContext: {
            kind: "agent",
            principalId: "principal-durable",
            workspaceId: "workspace-durable",
            keyId: "key-durable",
          },
        },
      ),
    ).resolves.toMatchObject({
      type: "capability_result",
      status: "accepted",
    });
  });

  it("enforces lifecycle publication invariants", () => {
    const invalid: CapabilityRegistration = {
      identity: { name: "fixtures.invalid", version: 1 },
      summary: "Invalid recommendation.",
      lifecycle: {
        status: "retired",
        introducedAt: "2026-01-01T00:00:00.000Z",
        retiredAt: "2026-02-01T00:00:00.000Z",
        recommended: true,
      },
      input: z.object({}).strict(),
      outputSchema: { type: "object" },
      effect: {
        mutation: "none",
        visibility: "private",
        timing: "immediate",
        reversibility: "reversible",
        maySpendProviderBudget: false,
      },
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: COMMON_DISCOVERY_ERRORS,
      handler: () => ({}),
    };
    expect(() => createCapabilityRegistry([invalid])).toThrow(
      "Only an active capability may be recommended",
    );
  });
});
