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
      "approval_policies.manage@1",
      "artifact_downloads.create@1",
      "artifact_uploads.begin@1",
      "artifact_uploads.complete@1",
      "artifacts.get@1",
      "artifacts.import@1",
      "artifacts.list@1",
      "audit.export@1",
      "budget_policies.get_effective@1",
      "budget_policies.list@1",
      "budget_policy_revisions.create@1",
      "budget_reservations.list@1",
      "budget_status.get@1",
      "bulk.execute@1",
      "bulk.preview@1",
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
      "diagnostic_traces.get@1",
      "exports.manage@1",
      "governance.snapshot.get@1",
      "governance.view@1",
      "imports.manage@1",
      "members.invite@1",
      "members.manage@1",
      "observability_retention.get@1",
      "observability_retention.set@1",
      "operational_metrics.list@1",
      "portfolios.manage@1",
      "pricing_overrides.create@1",
      "pricing_overrides.list@1",
      "pricing_overrides.revoke@1",
      "publishing_approvals.decide@1",
      "publishing_approvals.get@1",
      "publishing_approvals.get@2",
      "publishing_approvals.list@1",
      "publishing_approvals.request@1",
      "publishing_deliveries.cancel@1",
      "publishing_deliveries.get@1",
      "publishing_deliveries.get@2",
      "publishing_deliveries.list@1",
      "publishing_deliveries.list@2",
      "publishing_deliveries.reconcile@1",
      "publishing_deliveries.retry@1",
      "publishing_delivery_events.list@1",
      "publishing_delivery_events.list@2",
      "publishing_plan_revisions.create@1",
      "publishing_plan_revisions.get@1",
      "publishing_plan_revisions.get@2",
      "publishing_plan_revisions.list@1",
      "publishing_plan_revisions.release@1",
      "publishing_plan_revisions.validate@1",
      "quota_policies.get_effective@1",
      "quota_policies.list@1",
      "quota_policy_revisions.create@1",
      "quota_reservations.list@1",
      "quota_waits.list@1",
      "quota_waits.resume@1",
      "regions.manage@1",
      "retention.manage@1",
      "reviews.create@1",
      "reviews.decide_content@1",
      "roles.manage@1",
      "safety.appeal@1",
      "safety.decide@1",
      "spend_controls.get@1",
      "spend_controls.get@2",
      "spend_controls.resume@1",
      "spend_controls.resume@2",
      "spend_controls.suspend@1",
      "spend_controls.suspend@2",
      "support_bundle_audit.list@1",
      "support_bundles.create@1",
      "support_bundles.get@1",
      "support_bundles.payload.get@1",
      "support_bundles.revoke@1",
      "telemetry_operator_grants.issue@1",
      "telemetry_operator_grants.list@1",
      "telemetry_operator_grants.revoke@1",
      "usage_events.list@1",
      "usage_records.get@1",
      "usage_records.list@1",
      "usage_summaries.get@1",
      "workflow_operations.get@1",
      "workflow_operations.list@1",
      "workflow_run_artifacts.get@1",
      "workflow_run_artifacts.get@2",
      "workflow_run_events.list@1",
      "workflow_run_events.list@2",
      "workflow_runs.get@1",
      "workflow_runs.get@2",
      "workflow_runs.preview@1",
      "workflow_runs.reconcile@1",
      "workflow_runs.resume@1",
      "workflow_runs.retry@1",
      "workflow_runs.start@1",
      "workflow_runs.start@2",
      "workflow_runs.start@3",
      "workflow_step_attempts.list@1",
      "workflow_step_attempts.list@2",
      "workflow_versions.create@1",
      "workflow_versions.get@1",
      "workflow_versions.get@2",
      "workflow_versions.validate@1",
      "workflows.create@1",
      "workspace.close@1",
      "workspace.transfer_ownership@1",
    ]);
    expect(output.registryDigest).toBe(CAPABILITY_REGISTRY.digest);

    for (const definition of output.items) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(definition.contractDigest).toBe(
        contractDigestFor(contractWithoutPublication(definition)),
      );
      expect(definition.lifecycle).toMatchObject({
        status: "active",
        recommended: ![
          "workflow_run_artifacts.get@1",
          "workflow_run_events.list@1",
          "workflow_runs.get@1",
          "workflow_runs.start@1",
          "workflow_runs.start@2",
          "workflow_step_attempts.list@1",
          "workflow_versions.get@1",
          "publishing_approvals.get@1",
          "publishing_deliveries.get@1",
          "publishing_deliveries.list@1",
          "publishing_delivery_events.list@1",
          "publishing_plan_revisions.get@1",
          "spend_controls.get@1",
          "spend_controls.resume@1",
          "spend_controls.suspend@1",
        ].includes(formatCapabilityIdentity(definition.identity)),
      });
      expect(definition.schemas.input).toMatchObject({ type: "object" });
      const outputSchema = definition.schemas.output as {
        type?: string;
        additionalProperties?: boolean;
        oneOf?: Array<{ type?: string; additionalProperties?: boolean }>;
      };
      const outputBranches = outputSchema.oneOf ?? [outputSchema];
      expect(outputBranches.length).toBeGreaterThan(0);
      for (const branch of outputBranches) {
        expect(branch).toMatchObject({
          type: "object",
          additionalProperties: false,
        });
      }
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
      "approval_policies.manage.v1",
      "artifact_downloads.create.v1",
      "artifact_uploads.begin.v1",
      "artifact_uploads.complete.v1",
      "artifacts.get.v1",
      "artifacts.import.v1",
      "artifacts.list.v1",
      "audit.export.v1",
      "budget_policies.get_effective.v1",
      "budget_policies.list.v1",
      "budget_policy_revisions.create.v1",
      "budget_reservations.list.v1",
      "budget_status.get.v1",
      "bulk.execute.v1",
      "bulk.preview.v1",
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
      "diagnostic_traces.get.v1",
      "exports.manage.v1",
      "governance.snapshot.get.v1",
      "governance.view.v1",
      "imports.manage.v1",
      "members.invite.v1",
      "members.manage.v1",
      "observability_retention.get.v1",
      "observability_retention.set.v1",
      "operational_metrics.list.v1",
      "portfolios.manage.v1",
      "pricing_overrides.create.v1",
      "pricing_overrides.list.v1",
      "pricing_overrides.revoke.v1",
      "publishing_approvals.decide.v1",
      "publishing_approvals.get.v1",
      "publishing_approvals.get.v2",
      "publishing_approvals.list.v1",
      "publishing_approvals.request.v1",
      "publishing_deliveries.cancel.v1",
      "publishing_deliveries.get.v1",
      "publishing_deliveries.get.v2",
      "publishing_deliveries.list.v1",
      "publishing_deliveries.list.v2",
      "publishing_deliveries.reconcile.v1",
      "publishing_deliveries.retry.v1",
      "publishing_delivery_events.list.v1",
      "publishing_delivery_events.list.v2",
      "publishing_plan_revisions.create.v1",
      "publishing_plan_revisions.get.v1",
      "publishing_plan_revisions.get.v2",
      "publishing_plan_revisions.list.v1",
      "publishing_plan_revisions.release.v1",
      "publishing_plan_revisions.validate.v1",
      "quota_policies.get_effective.v1",
      "quota_policies.list.v1",
      "quota_policy_revisions.create.v1",
      "quota_reservations.list.v1",
      "quota_waits.list.v1",
      "quota_waits.resume.v1",
      "regions.manage.v1",
      "retention.manage.v1",
      "reviews.create.v1",
      "reviews.decide_content.v1",
      "roles.manage.v1",
      "safety.appeal.v1",
      "safety.decide.v1",
      "spend_controls.get.v1",
      "spend_controls.get.v2",
      "spend_controls.resume.v1",
      "spend_controls.resume.v2",
      "spend_controls.suspend.v1",
      "spend_controls.suspend.v2",
      "support_bundle_audit.list.v1",
      "support_bundles.create.v1",
      "support_bundles.get.v1",
      "support_bundles.payload.get.v1",
      "support_bundles.revoke.v1",
      "telemetry_operator_grants.issue.v1",
      "telemetry_operator_grants.list.v1",
      "telemetry_operator_grants.revoke.v1",
      "usage_events.list.v1",
      "usage_records.get.v1",
      "usage_records.list.v1",
      "usage_summaries.get.v1",
      "workflow_operations.get.v1",
      "workflow_operations.list.v1",
      "workflow_run_artifacts.get.v1",
      "workflow_run_artifacts.get.v2",
      "workflow_run_events.list.v1",
      "workflow_run_events.list.v2",
      "workflow_runs.get.v1",
      "workflow_runs.get.v2",
      "workflow_runs.preview.v1",
      "workflow_runs.reconcile.v1",
      "workflow_runs.resume.v1",
      "workflow_runs.retry.v1",
      "workflow_runs.start.v1",
      "workflow_runs.start.v2",
      "workflow_runs.start.v3",
      "workflow_step_attempts.list.v1",
      "workflow_step_attempts.list.v2",
      "workflow_versions.create.v1",
      "workflow_versions.get.v1",
      "workflow_versions.get.v2",
      "workflow_versions.validate.v1",
      "workflows.create.v1",
      "workspace.close.v1",
      "workspace.transfer_ownership.v1",
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
