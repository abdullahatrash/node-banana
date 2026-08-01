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
  createQuotaRegistrations,
  type QuotaCapabilityService,
} from "../capabilities";
import type {
  QuotaPolicy,
  QuotaPolicyRevision,
  QuotaReservation,
  QuotaWait,
} from "../types";

const NOW = new Date("2026-08-01T12:00:00.000Z");
const window = {
  kind: "concurrent" as const,
  timezone: "UTC",
  startsAt: NOW,
  endsAt: null,
};
const policy: QuotaPolicy = {
  schema: "quota-policy/v1",
  id: "policy_1",
  workspaceId: "workspace_1",
  principalId: null,
  scope: "workspace",
  kind: "concurrency",
  boundary: "run_concurrency",
  dimension: "runtime.concurrent_runs@1",
  unit: "count",
  window: "concurrent",
  timezone: "UTC",
  reservationRule: "release_on_terminal",
  status: "active",
  currentRevisionId: "revision_1",
  createdAt: NOW,
  updatedAt: NOW,
};
const revision: QuotaPolicyRevision = {
  schema: "quota-policy-revision/v1",
  id: "revision_1",
  policyId: policy.id,
  workspaceId: policy.workspaceId,
  principalId: null,
  revision: 1,
  warningThreshold: "1",
  hardLimit: "2",
  exhaustionBehavior: "wait",
  createdByUserId: "owner_1",
  createdAt: NOW,
};

function reservation(id: string, principalId: string): QuotaReservation {
  return {
    schema: "quota-reservation/v1",
    id,
    workspaceId: "workspace_1",
    admittedPrincipalId: principalId,
    principalId: null,
    runId: `run_${principalId}`,
    transitionKey: `transition_${principalId}`,
    boundary: "run_concurrency",
    subject: { kind: "run", id: `run_${principalId}` },
    policyId: policy.id,
    policyRevisionId: revision.id,
    scope: "workspace",
    kind: "concurrency",
    dimension: policy.dimension,
    unit: "count",
    window,
    reservationRule: "release_on_terminal",
    reservedAmount: "1",
    heldAmount: "1",
    settledAmount: "0",
    releasedAmount: "0",
    overageAmount: "0",
    state: "held",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function wait(id: string, principalId: string, state: "waiting" | "resumed" = "waiting"): QuotaWait {
  return {
    schema: "quota-wait/v1",
    id,
    workspaceId: "workspace_1",
    admittedPrincipalId: principalId,
    runId: `run_${principalId}`,
    transitionKey: `transition_wait_${principalId}`,
    boundary: "run_concurrency",
    subject: { kind: "run", id: `run_${principalId}` },
    claims: [{ dimension: policy.dimension, unit: "count", amount: "1" }],
    reasonCode: "QUOTA_RENEWABLE_CAPACITY_EXHAUSTED",
    evidence: [{
      schema: "quota-exhaustion-evidence/v1",
      policyId: policy.id,
      policyRevisionId: revision.id,
      scope: "workspace",
      dimension: policy.dimension,
      unit: "count",
      window,
      hardLimit: "2",
      committed: "2",
      requested: "1",
      available: "0",
      blockingReservationIds: ["reservation_blocking"],
      evaluatedAt: NOW,
      eligibleAt: null,
      eligibility: { kind: "capacity_release", requiredAvailable: "1" },
      evidenceRef: `quota-evidence:${id}`,
      evidenceVersion: 1,
    }],
    eligibleAt: null,
    state,
    resumeReason: state === "resumed" ? "manual_resume" : null,
    resumedBy: state === "resumed"
      ? { kind: "human", userId: "owner_1" }
      : null,
    resumeIdempotencyKey: state === "resumed" ? "resume_wait_1" : null,
    resolutionReservationIds: state === "resumed" ? ["reservation_resumed"] : [],
    createdAt: NOW,
    resolvedAt: state === "resumed" ? NOW : null,
  };
}

function setup() {
  const reservations = [
    reservation("reservation_self", "principal_1"),
    reservation("reservation_foreign", "principal_2"),
  ];
  const waits = [wait("wait_self", "principal_1"), wait("wait_foreign", "principal_2")];
  const reservationListCalls: Array<{
    workspaceId: string;
    runId?: string;
    admittedPrincipalId?: string;
    limit?: number;
  }> = [];
  const waitListCalls: Array<{
    workspaceId: string;
    runId?: string;
    state?: "waiting" | "resumed" | "cancelled";
    admittedPrincipalId?: string;
    limit?: number;
  }> = [];
  const resumeCalls: Array<{
    workspaceId: string;
    waitId: string;
    actor: { kind: "human"; userId: string };
    idempotencyKey: string;
  }> = [];
  const service: QuotaCapabilityService = {
    createPolicyRevision: async () => ({ policy, revision }),
    getEffectiveCapacity: async () => [{
      schema: "effective-quota-capacity/v1",
      policy,
      revision,
      window,
      committed: "2",
      available: "0",
      blockingReservationIds: ["reservation_blocking"],
      warning: true,
      exhausted: true,
      evaluatedAt: NOW,
    }],
    listPolicies: async () => [{ policy, revision }],
    listReservations: async (input) => {
      reservationListCalls.push(input);
      return reservations.filter((item) =>
        !input.admittedPrincipalId ||
        item.admittedPrincipalId === input.admittedPrincipalId,
      ).slice(0, input.limit);
    },
    listWaits: async (input) => {
      waitListCalls.push(input);
      return waits.filter((item) =>
        (!input.admittedPrincipalId ||
          item.admittedPrincipalId === input.admittedPrincipalId) &&
        (!input.state || item.state === input.state),
      ).slice(0, input.limit);
    },
    getWait: async ({ waitId }) => wait(waitId, "principal_1", "resumed"),
  };
  const authorizer: CapabilityAuthorizer = {
    authorize: async (request) => {
      const context = request.securityContext;
      return {
        allowed: context.kind === "agent"
          ? request.audience === "agent" || request.audience === "shared"
          : request.audience === "shared" ||
            (request.audience === "human" &&
              (context.role === "owner" || context.role === "admin")),
        operatorTraceRef: "trace_quota_test",
      };
    },
  };
  const registry = createCapabilityRegistry(
    createQuotaRegistrations(service, {
      now: () => new Date(NOW),
      waitResumeCoordinator: {
        resumeQuotaWait: async (input) => {
          resumeCalls.push(input);
          return { runId: "run_principal_1", state: "accepted" };
        },
      },
    }),
  );
  const dispatcher = new CapabilityDispatcher(registry, authorizer);
  const port = (securityContext: ResolvedSecurityContext) => ({
    dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
      dispatcher.dispatch(invocation, { securityContext }),
  });
  return {
    registry,
    port,
    reservationListCalls,
    resumeCalls,
    waitListCalls,
  };
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

describe("Quota capability transport parity", () => {
  it("publishes the agreed shared-read and human-admin identities", () => {
    const { registry } = setup();
    expect(registry.listDefinitions().map((definition) => ({
      identity: `${definition.identity.name}@${definition.identity.version}`,
      audience: definition.audience,
      idempotency: definition.idempotency.mode,
    }))).toEqual([
      { identity: "quota_policies.get_effective@1", audience: "shared", idempotency: "retry-safe" },
      { identity: "quota_policies.list@1", audience: "human", idempotency: "retry-safe" },
      { identity: "quota_policy_revisions.create@1", audience: "human", idempotency: "key-required" },
      { identity: "quota_reservations.list@1", audience: "shared", idempotency: "retry-safe" },
      { identity: "quota_waits.list@1", audience: "shared", idempotency: "retry-safe" },
      { identity: "quota_waits.resume@1", audience: "human", idempotency: "key-required" },
    ]);
  });

  it("keeps Agent reservation and wait reads self-scoped across CLI and MCP", async () => {
    const { port, reservationListCalls, waitListCalls } = setup();
    const cliReservations = await dispatchCliCapability("quota_reservations.list@1", {}, port(agent));
    const mcpReservations = await dispatchMcpCapability("quota_reservations.list.v1", {}, port(agent));
    expect(cliReservations).toEqual(mcpReservations);
    expect(JSON.stringify(cliReservations)).toContain("reservation_self");
    expect(JSON.stringify(cliReservations)).not.toContain("reservation_foreign");

    const cliWaits = await dispatchCliCapability("quota_waits.list@1", {}, port(agent));
    const mcpWaits = await dispatchMcpCapability("quota_waits.list.v1", {}, port(agent));
    expect(cliWaits).toEqual(mcpWaits);
    expect(JSON.stringify(cliWaits)).toContain("wait_self");
    expect(JSON.stringify(cliWaits)).not.toContain("wait_foreign");
    expect(reservationListCalls).toEqual([
      {
        workspaceId: "workspace_1",
        admittedPrincipalId: "principal_1",
        limit: 100,
      },
      {
        workspaceId: "workspace_1",
        admittedPrincipalId: "principal_1",
        limit: 100,
      },
    ]);
    expect(waitListCalls).toEqual([
      {
        workspaceId: "workspace_1",
        admittedPrincipalId: "principal_1",
        limit: 100,
      },
      {
        workspaceId: "workspace_1",
        admittedPrincipalId: "principal_1",
        limit: 100,
      },
    ]);
  });

  it("restricts Workspace-wide shared reads to owners and admins", async () => {
    const { port } = setup();
    const member = { ...owner(), role: "member" as const };

    await Promise.all([
      dispatchCliCapability(
        "quota_policies.get_effective@1",
        { principalId: "principal_1" },
        port(member),
      ),
      dispatchCliCapability("quota_reservations.list@1", {}, port(member)),
      dispatchCliCapability("quota_waits.list@1", {}, port(member)),
    ]).then((results) => {
      for (const result of results) {
        expect(result).toMatchObject({
          type: "capability_error",
          code: "CAPABILITY_NOT_AUTHORIZED",
        });
      }
    });
  });

  it("returns safe effective capacity without human audit identity", async () => {
    const { port } = setup();
    const result = await dispatchCliCapability("quota_policies.get_effective@1", {}, port(agent));
    expect(result).toMatchObject({
      type: "capability_result",
      output: {
        items: [{ committed: "2", available: "0", warning: true, exhausted: true }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("createdByUserId");
  });

  it("requires owner/admin plus idempotency and replays the canonical wait through both transports", async () => {
    const { port, resumeCalls } = setup();
    const denied = await dispatchCliCapability(
      "quota_waits.resume@1",
      { waitId: "wait_self" },
      port({ ...owner(), role: "member" }),
    );
    expect(denied).toMatchObject({ type: "capability_error" });

    const missingKey = await dispatchCliCapability(
      "quota_waits.resume@1",
      { waitId: "wait_self" },
      port(owner()),
    );
    expect(missingKey).toMatchObject({
      type: "capability_error",
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });

    const cli = await dispatchCliCapability(
      "quota_waits.resume@1",
      { waitId: "wait_self" },
      port(owner("resume-wait-parity")),
    );
    const mcp = await dispatchMcpCapability(
      "quota_waits.resume.v1",
      { waitId: "wait_self" },
      port(owner("resume-wait-parity")),
    );
    expect(cli).toEqual(mcp);
    expect(cli).toMatchObject({
      type: "capability_result",
      output: {
        wait: {
          id: "wait_self",
          state: "resumed",
          resumeReason: "manual_resume",
          resumedBy: { kind: "human", userId: "owner_1" },
        },
      },
    });
    expect(JSON.stringify(cli)).not.toContain("resumeIdempotencyKey");
    expect(resumeCalls).toEqual([
      {
        workspaceId: "workspace_1",
        waitId: "wait_self",
        actor: { kind: "human", userId: "owner_1" },
        idempotencyKey: "resume-wait-parity",
      },
      {
        workspaceId: "workspace_1",
        waitId: "wait_self",
        actor: { kind: "human", userId: "owner_1" },
        idempotencyKey: "resume-wait-parity",
      },
    ]);
  });
});
