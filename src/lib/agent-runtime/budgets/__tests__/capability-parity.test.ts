import { describe, expect, it } from "vitest";
import {
  CapabilityDispatcher,
  createCapabilityRegistry,
  dispatchCliCapability,
  dispatchMcpCapability,
} from "@/lib/agent-tools";
import type { CapabilityAuthorizer } from "@/types/agentAuthorization";
import type { ResolvedSecurityContext } from "@/types/capabilities";
import {
  BUDGET_CAPABILITY_IDENTITIES,
  createBudgetRegistrations,
} from "../capabilities";
import { InMemoryBudgetRepository } from "../memory";
import { BudgetService } from "../service";

const NOW = new Date("2026-08-01T12:00:00.000Z");

async function setup() {
  const repository = new InMemoryBudgetRepository();
  const service = new BudgetService(repository);
  const workspacePolicy = await service.createPolicyRevision({
    workspaceId: "workspace_1",
    principalId: null,
    currency: "USD",
    period: "calendar_month",
    timezone: "Europe/Athens",
    warningThreshold: "75",
    hardLimit: "100",
    unknownPriceTreatment: "deny",
    unknownPriceAllowance: null,
    actorUserId: "owner_1",
    idempotencyKey: "seed-workspace-policy",
    recordedAt: new Date("2026-08-01T10:00:00.000Z"),
  });
  const principalPolicy = await service.createPolicyRevision({
    workspaceId: "workspace_1",
    principalId: "principal_1",
    currency: "USD",
    period: "calendar_month",
    timezone: "Europe/Athens",
    warningThreshold: "25",
    hardLimit: "50",
    unknownPriceTreatment: "deny",
    unknownPriceAllowance: null,
    actorUserId: "owner_1",
    idempotencyKey: "seed-principal-policy",
    recordedAt: new Date("2026-08-01T10:01:00.000Z"),
  });
  repository.reservations.set("reservation_1", {
    schema: "budget-reservation/v1",
    id: "reservation_1",
    workspaceId: "workspace_1",
    principalId: "principal_1",
    admittedPrincipalId: "principal_1",
    runId: "run_1",
    policyId: principalPolicy.policy.id,
    policyRevisionId: principalPolicy.revision.id,
    scope: "principal",
    period: {
      kind: "calendar_month",
      timezone: "Europe/Athens",
      startsAt: new Date("2026-07-31T21:00:00.000Z"),
      endsAt: new Date("2026-08-31T21:00:00.000Z"),
    },
    currency: "USD",
    reservedAmount: "4.5",
    heldAmount: "3.5",
    settledAmount: "1",
    releasedAmount: "0",
    state: "held",
    pricingSnapshotIds: ["pricing_1"],
    createdAt: new Date("2026-08-01T11:00:00.000Z"),
    updatedAt: new Date("2026-08-01T11:30:00.000Z"),
  });
  repository.reservations.set("reservation_foreign", {
    ...structuredClone(repository.reservations.get("reservation_1")!),
    id: "reservation_foreign",
    principalId: "principal_2",
    admittedPrincipalId: "principal_2",
    runId: "run_2",
  });

  const authorizer: CapabilityAuthorizer = {
    authorize: async (request) => {
      const context = request.securityContext;
      const allowed = context.kind === "agent"
        ? request.audience === "agent" || request.audience === "shared"
        : request.audience === "shared" ||
          (request.audience === "human" &&
            (context.role === "owner" || context.role === "admin"));
      return {
        allowed,
        operatorTraceRef: "trace_budget_test",
      };
    },
  };
  const registry = createCapabilityRegistry(
    createBudgetRegistrations(service, { now: () => new Date(NOW) }),
  );
  const dispatcher = new CapabilityDispatcher(registry, authorizer);
  const port = (securityContext: ResolvedSecurityContext) => ({
    dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
      dispatcher.dispatch(invocation, { securityContext }),
  });
  return { repository, registry, service, workspacePolicy, port };
}

const agent = {
  kind: "agent" as const,
  workspaceId: "workspace_1",
  principalId: "principal_1",
  keyId: "key_1",
};

const owner = (idempotencyKey?: string) => ({
  kind: "human" as const,
  workspaceId: "workspace_1",
  userId: "owner_1",
  role: "owner" as const,
  ...(idempotencyKey ? { idempotencyKey } : {}),
});

describe("Budget capability transport parity", () => {
  it("publishes the exact shared-read and human-admin audiences", async () => {
    const { registry } = await setup();
    expect(
      registry.listDefinitions().map((definition) => ({
        identity: `${definition.identity.name}@${definition.identity.version}`,
        audience: definition.audience,
      })),
    ).toEqual([
      { identity: "budget_policies.get_effective@1", audience: "shared" },
      { identity: "budget_policies.list@1", audience: "human" },
      { identity: "budget_policy_revisions.create@1", audience: "human" },
      { identity: "budget_reservations.list@1", audience: "shared" },
      { identity: "budget_status.get@1", audience: "shared" },
      { identity: "pricing_overrides.create@1", audience: "human" },
      { identity: "pricing_overrides.list@1", audience: "human" },
      { identity: "pricing_overrides.revoke@1", audience: "human" },
      { identity: "spend_controls.get@1", audience: "human" },
      { identity: "spend_controls.get@2", audience: "shared" },
      { identity: "spend_controls.resume@1", audience: "human" },
      { identity: "spend_controls.resume@2", audience: "human" },
      { identity: "spend_controls.suspend@1", audience: "human" },
      { identity: "spend_controls.suspend@2", audience: "human" },
    ]);
    expect(BUDGET_CAPABILITY_IDENTITIES.effectivePoliciesGet).toEqual({
      name: "budget_policies.get_effective",
      version: 1,
    });
    expect(registry.getDefinition(
      BUDGET_CAPABILITY_IDENTITIES.spendControlGetV2,
    )?.errors).toEqual([
      expect.objectContaining({ code: "CAPABILITY_IDENTITY_INVALID" }),
      expect.objectContaining({ code: "CAPABILITY_NOT_FOUND" }),
      expect.objectContaining({ code: "CAPABILITY_VERSION_RETIRED" }),
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
      expect.objectContaining({ code: "INTERNAL_ERROR" }),
      {
        code: "BUDGET_UNAVAILABLE",
        category: "internal",
        retryable: true,
        description: "Durable Emergency Spend Suspension evidence is unavailable or inconsistent.",
      },
    ]);
  });

  it("returns the same redacted effective policies through CLI and MCP", async () => {
    const { port } = await setup();
    const cli = await dispatchCliCapability(
      "budget_policies.get_effective@1",
      {},
      port(agent),
    );
    const mcp = await dispatchMcpCapability(
      "budget_policies.get_effective.v1",
      {},
      port(agent),
    );
    expect(cli).toEqual(mcp);
    expect(cli).toMatchObject({
      type: "capability_result",
      output: {
        schema: "effective-budget-policy-list/v1",
        items: [
          { policy: { scope: "principal" }, revision: { hardLimit: "50" } },
          { policy: { scope: "workspace" }, revision: { hardLimit: "100" } },
        ],
      },
    });
    expect(JSON.stringify(cli)).not.toContain("createdByUserId");
  });

  it("self-scopes Agent reservation reads and rejects another Principal selector", async () => {
    const { port } = await setup();
    const cli = await dispatchCliCapability(
      "budget_reservations.list@1",
      {},
      port(agent),
    );
    const mcp = await dispatchMcpCapability(
      "budget_reservations.list.v1",
      {},
      port(agent),
    );
    expect(cli).toEqual(mcp);
    expect(cli).toMatchObject({
      type: "capability_result",
      output: {
        items: [{ id: "reservation_1", principalId: "principal_1" }],
      },
    });
    expect(JSON.stringify(cli)).not.toContain("reservation_foreign");

    const denied = await dispatchCliCapability(
      "budget_reservations.list@1",
      { principalId: "principal_2" },
      port(agent),
    );
    expect(denied).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
  });

  it("replays policy and pricing creation identically across transports", async () => {
    const { port } = await setup();
    const policyInput = {
      principalId: null,
      currency: "USD",
      period: "calendar_month",
      timezone: "Europe/Athens",
      warningThreshold: "70",
      hardLimit: "90",
      unknownPriceTreatment: "deny",
      unknownPriceAllowance: null,
    };
    const policyCli = await dispatchCliCapability(
      "budget_policy_revisions.create@1",
      policyInput,
      port(owner("policy-revision-parity")),
    );
    const policyMcp = await dispatchMcpCapability(
      "budget_policy_revisions.create.v1",
      policyInput,
      port(owner("policy-revision-parity")),
    );
    expect(policyCli).toEqual(policyMcp);
    expect(policyCli).toMatchObject({
      type: "capability_result",
      output: { revision: { revision: 2, hardLimit: "90" } },
    });

    const pricingInput = {
      provider: "replicate",
      providerOperation: "predictions.create",
      model: "vendor/model",
      serviceTier: "default",
      dimension: "replicate.predict_seconds@1",
      unit: "millisecond",
      price: "0.0001",
      currency: "USD",
      perQuantity: "1",
      runCeiling: "5",
      sourceRef: "pricing-note-1",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
    };
    const pricingCli = await dispatchCliCapability(
      "pricing_overrides.create@1",
      pricingInput,
      port(owner("pricing-create-parity")),
    );
    const pricingMcp = await dispatchMcpCapability(
      "pricing_overrides.create.v1",
      pricingInput,
      port(owner("pricing-create-parity")),
    );
    expect(pricingCli).toEqual(pricingMcp);
    expect(pricingCli).toMatchObject({
      type: "capability_result",
      output: { provider: "replicate", price: "0.0001", status: "active" },
    });
  });

  it("keeps pricing revocation and spend controls identical through CLI and MCP", async () => {
    const { port } = await setup();
    const created = await dispatchCliCapability(
      "pricing_overrides.create@1",
      {
        provider: "replicate",
        providerOperation: "predictions.create",
        model: "vendor/model",
        serviceTier: "default",
        dimension: "replicate.predict_seconds@1",
        unit: "millisecond",
        price: "0.0001",
        currency: "USD",
        perQuantity: "1",
        runCeiling: "5",
        sourceRef: "pricing-note-1",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
      },
      port(owner("pricing-create-for-revoke")),
    );
    if (created.type !== "capability_result") {
      throw new Error("Pricing seed was not created.");
    }
    const overrideId = (created.output as { id: string }).id;
    const revokeCli = await dispatchCliCapability(
      "pricing_overrides.revoke@1",
      { overrideId },
      port(owner()),
    );
    const revokeMcp = await dispatchMcpCapability(
      "pricing_overrides.revoke.v1",
      { overrideId },
      port(owner()),
    );
    expect(revokeCli).toEqual(revokeMcp);

    const suspendCli = await dispatchCliCapability(
      "spend_controls.suspend@1",
      { reason: "Provider incident" },
      port(owner()),
    );
    const suspendMcp = await dispatchMcpCapability(
      "spend_controls.suspend.v1",
      { reason: "Provider incident" },
      port(owner()),
    );
    expect(suspendCli).toEqual(suspendMcp);
    const readCli = await dispatchCliCapability(
      "spend_controls.get@1",
      {},
      port(owner()),
    );
    const readMcp = await dispatchMcpCapability(
      "spend_controls.get.v1",
      {},
      port(owner()),
    );
    expect(readCli).toEqual(readMcp);
    expect(readCli).toMatchObject({
      type: "capability_result",
      output: { suspended: true },
    });

    const resumeCli = await dispatchCliCapability(
      "spend_controls.resume@1",
      { reason: "Incident resolved" },
      port(owner()),
    );
    const resumeMcp = await dispatchMcpCapability(
      "spend_controls.resume.v1",
      { reason: "Incident resolved" },
      port(owner()),
    );
    expect(resumeCli).toEqual(resumeMcp);
  });

  it("permits shared reads to members but keeps administration owner/admin-only", async () => {
    const { port } = await setup();
    const member = {
      kind: "human" as const,
      workspaceId: "workspace_1",
      userId: "member_1",
      role: "member" as const,
    };
    const shared = await dispatchCliCapability(
      "budget_policies.get_effective@1",
      { principalId: "principal_1" },
      port(member),
    );
    expect(shared.type).toBe("capability_result");

    const denied = await dispatchCliCapability(
      "budget_policies.list@1",
      {},
      port(member),
    );
    expect(denied).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
  });

  it("reports Workspace unknown cost across principals and policy revisions", async () => {
    const { port, repository, service, workspacePolicy } = await setup();
    repository.reservations.set("reservation_workspace_unknown", {
      ...structuredClone(repository.reservations.get("reservation_1")!),
      id: "reservation_workspace_unknown",
      principalId: null,
      admittedPrincipalId: "principal_2",
      runId: "run_workspace_unknown",
      policyId: workspacePolicy.policy.id,
      policyRevisionId: workspacePolicy.revision.id,
      scope: "workspace",
      state: "held_unknown_cost",
    });
    const replacement = await service.createPolicyRevision({
      workspaceId: "workspace_1",
      principalId: null,
      currency: "USD",
      period: "calendar_month",
      timezone: "Europe/Athens",
      warningThreshold: "3",
      hardLimit: "5",
      unknownPriceTreatment: "deny",
      unknownPriceAllowance: null,
      actorUserId: "owner_1",
      idempotencyKey: "replace-workspace-policy",
      recordedAt: new Date("2026-08-01T11:45:00.000Z"),
    });

    const result = await dispatchCliCapability(
      "budget_status.get@1",
      {},
      port(agent),
    );
    expect(result).toMatchObject({
      type: "capability_result",
      output: {
        schema: "budget-status/v1",
        workspaceId: "workspace_1",
        principalId: "principal_1",
        items: expect.arrayContaining([
          expect.objectContaining({
            scope: "workspace",
            policyId: workspacePolicy.policy.id,
            policyRevisionId: replacement.revision.id,
            committed: "4.5",
            available: "0.5",
            warningState: "warning",
            certainty: "contains_unknown_cost",
            unknownReservationCount: 1,
          }),
        ]),
      },
    });

    const foreign = await dispatchCliCapability(
      "budget_status.get@1",
      { principalId: "principal_2" },
      port(agent),
    );
    expect(foreign).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
  });

  it("returns exact spend-control evidence, upgrades legacy evidence, and redacts Agents", async () => {
    const { port, repository, service } = await setup();
    const legacy = await dispatchCliCapability(
      "spend_controls.suspend@1",
      { reason: "Provider incident" },
      port(owner()),
    );
    expect(legacy).toMatchObject({
      type: "capability_result",
      output: { schema: "workspace-spend-control/v1", suspended: true },
    });

    const upgraded = await dispatchCliCapability(
      "spend_controls.suspend@2",
      { reason: "Provider incident" },
      port(owner()),
    );
    expect(upgraded).toMatchObject({
      type: "capability_result",
      output: {
        schema: "workspace-spend-control/v2",
        suspended: true,
        revision: 2,
        reason: "Provider incident",
        actorUserId: "owner_1",
        authorizationEvidenceRef: "trace_budget_test",
        policyEventId: expect.stringMatching(/^budget_event_/),
      },
    });
    const replayed = await dispatchMcpCapability(
      "spend_controls.suspend.v2",
      { reason: "Provider incident" },
      port(owner()),
    );
    expect(replayed).toEqual(upgraded);

    const member = {
      kind: "human" as const,
      workspaceId: "workspace_1",
      userId: "member_1",
      role: "member" as const,
    };
    const memberRead = await dispatchCliCapability(
      "spend_controls.get@2",
      {},
      port(member),
    );
    expect(memberRead).toMatchObject({
      type: "capability_result",
      output: {
        revision: 2,
        authorizationEvidenceRef: "trace_budget_test",
      },
    });
    const agentRead = await dispatchCliCapability(
      "spend_controls.get@2",
      {},
      port(agent),
    );
    expect(agentRead).toMatchObject({
      type: "capability_result",
      output: {
        suspended: true,
        actorUserId: null,
        authorizationEvidenceRef: null,
      },
    });
    const denied = await dispatchCliCapability(
      "spend_controls.resume@2",
      { reason: "Member cannot resume" },
      port(member),
    );
    expect(denied).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });

    const [first, second] = await Promise.all([
      service.setSpendSuspendedWithEvidence({
        workspaceId: "workspace_1",
        suspended: false,
        reason: "Recovered A",
        actorUserId: "owner_1",
        authorizationEvidenceRef: "trace_concurrent_a",
        recordedAt: new Date("2026-08-01T12:01:00.000Z"),
      }),
      service.setSpendSuspendedWithEvidence({
        workspaceId: "workspace_1",
        suspended: false,
        reason: "Recovered B",
        actorUserId: "owner_1",
        authorizationEvidenceRef: "trace_concurrent_b",
        recordedAt: new Date("2026-08-01T12:02:00.000Z"),
      }),
    ]);
    expect(first).toMatchObject({ reason: "Recovered A", authorizationEvidenceRef: "trace_concurrent_a" });
    expect(second).toMatchObject({ reason: "Recovered B", authorizationEvidenceRef: "trace_concurrent_b" });
    expect(first.revision).not.toBe(second.revision);

    repository.getSpendControlEvidence = async () => {
      throw new Error("corrupt durable evidence");
    };
    const unavailable = await dispatchCliCapability(
      "spend_controls.get@2",
      {},
      port(member),
    );
    expect(unavailable).toMatchObject({
      type: "capability_error",
      code: "BUDGET_UNAVAILABLE",
      category: "internal",
      retryable: true,
    });
  });

  it("rejects undeclared fields before any Budget handler executes", async () => {
    const { port } = await setup();
    const result = await dispatchCliCapability(
      "spend_controls.suspend@1",
      { reason: "Provider incident", workspaceId: "workspace_2" },
      port(owner()),
    );
    expect(result).toMatchObject({
      type: "capability_error",
      code: "VALIDATION_FAILED",
    });
  });
});
