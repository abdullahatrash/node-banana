import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceServiceAgentResolver,
  WorkspaceServiceAgentUnavailableError,
  workspaceServiceAgentProvisioningProfile,
  type WorkspaceServiceAgentAuthority,
  type WorkspaceServiceAgentCandidate,
  type WorkspaceServiceAgentRepository,
} from "../workspace-service-agent";

const NOW = new Date("2026-09-04T10:00:00.000Z");
const EMPTY = {
  channelIds: [],
  credentialProfileIds: [],
  workflowIds: [],
  automationIds: [],
  artifactIds: [],
};
const authority: WorkspaceServiceAgentAuthority = {
  capability: "workflow_runs.start@2",
  authorizationContractDigest: `sha256:${"a".repeat(64)}`,
  resources: { ...EMPTY, workflowIds: ["workflow_1"] },
};

function candidate(
  workspaceId: string,
  principalId: string,
  keyId: string,
  createdAt: string,
  overrides: Partial<WorkspaceServiceAgentCandidate> = {},
): WorkspaceServiceAgentCandidate {
  return {
    workspaceId,
    principalId,
    keyId,
    principalStatus: "active",
    principalRevokedAt: null,
    keyRevokedAt: null,
    keyExpiresAt: null,
    keyCreatedAt: new Date(createdAt),
    requestedAccess: ["service:content-workflow"],
    authorizationScopes: [{ ...authority, resources: { ...authority.resources } }],
    ...overrides,
  };
}

function mutableRepository() {
  const rows: WorkspaceServiceAgentCandidate[] = [];
  const provision = vi.fn(async (input: Parameters<WorkspaceServiceAgentRepository["provision"]>[0]) => {
    rows.push(candidate(
      input.workspaceId,
      `principal_${input.workspaceId}`,
      `key_${input.workspaceId}`,
      input.now.toISOString(),
      { authorizationScopes: [{ ...input.authority, resources: { ...input.authority.resources } }] },
    ));
  });
  const repository: WorkspaceServiceAgentRepository = {
    listCandidates: vi.fn(async ({ workspaceId }) => rows.filter((row) => row.workspaceId === workspaceId)),
    provision,
  };
  return { rows, repository, provision };
}

describe("WorkspaceServiceAgentResolver", () => {
  it("bootstraps distinct service actors for two fresh Workspaces", async () => {
    const setup = mutableRepository();
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority })).resolves.toEqual({
      workspaceId: "workspace_a",
      principalId: "principal_workspace_a",
      keyId: "key_workspace_a",
    });
    await expect(resolver.resolve({ workspaceId: "workspace_b", purpose: "content_workflow", authority })).resolves.toEqual({
      workspaceId: "workspace_b",
      principalId: "principal_workspace_b",
      keyId: "key_workspace_b",
    });
    expect(setup.provision).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent bootstrap idempotently per Workspace and purpose", async () => {
    const setup = mutableRepository();
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);
    const request = { workspaceId: "workspace_a", purpose: "content_workflow" as const, authority };

    const [first, second] = await Promise.all([resolver.resolve(request), resolver.resolve(request)]);

    expect(first).toEqual(second);
    expect(setup.provision).toHaveBeenCalledTimes(1);
    expect(setup.rows).toHaveLength(1);
  });

  it("reconciles an active actor when a newly required resource is outside its current scope", async () => {
    const setup = mutableRepository();
    setup.rows.push(candidate("workspace_a", "principal_a", "key_old", "2026-09-01T00:00:00.000Z", {
      authorizationScopes: [{ ...authority, resources: { ...EMPTY, workflowIds: ["workflow_old"] } }],
    }));
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority }))
      .resolves.toMatchObject({ workspaceId: "workspace_a" });
    expect(setup.provision).toHaveBeenCalledOnce();
  });

  it("selects the newest eligible actor during zero-downtime overlapping-Principal rotation", async () => {
    const setup = mutableRepository();
    setup.rows.push(
      candidate("workspace_a", "principal_old", "key_old", "2026-09-01T00:00:00.000Z"),
      candidate("workspace_a", "principal_new", "key_new", "2026-09-03T00:00:00.000Z"),
    );
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority }))
      .resolves.toMatchObject({ principalId: "principal_new", keyId: "key_new" });
    expect(setup.provision).not.toHaveBeenCalled();
  });

  it("observes key rotation and revocation on the next request without a stale cache", async () => {
    const setup = mutableRepository();
    setup.rows.push(candidate("workspace_a", "principal_a", "key_old", "2026-09-01T00:00:00.000Z"));
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);
    const request = { workspaceId: "workspace_a", purpose: "content_workflow" as const, authority };

    await expect(resolver.resolve(request)).resolves.toMatchObject({ keyId: "key_old" });
    setup.rows[0].keyRevokedAt = NOW;
    setup.rows.push(candidate("workspace_a", "principal_a", "key_new", "2026-09-03T00:00:00.000Z"));
    await expect(resolver.resolve(request)).resolves.toMatchObject({ keyId: "key_new" });
    setup.rows[1].keyRevokedAt = NOW;
    await expect(resolver.resolve(request)).rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
    expect(setup.provision).not.toHaveBeenCalled();
  });

  it("does not combine an active Principal with a usable key owned by a revoked Principal", async () => {
    const setup = mutableRepository();
    setup.rows.push(
      candidate("workspace_a", "principal_active", "key_revoked", "2026-09-03T00:00:00.000Z", {
        keyRevokedAt: NOW,
      }),
      candidate("workspace_a", "principal_revoked", "key_unrevoked", "2026-09-02T00:00:00.000Z", {
        principalStatus: "revoked",
        principalRevokedAt: NOW,
      }),
    );
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority }))
      .rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
    expect(setup.provision).not.toHaveBeenCalled();
  });

  it("rejects wrong-Workspace and wrong-purpose actors", async () => {
    const setup = mutableRepository();
    setup.rows.push(
      candidate("workspace_b", "principal_b", "key_b", "2026-09-01T00:00:00.000Z"),
      candidate("workspace_a", "principal_calendar", "key_calendar", "2026-09-02T00:00:00.000Z", {
        requestedAccess: ["service:calendar-reschedule"],
      }),
    );
    const resolver = new WorkspaceServiceAgentResolver({
      ...setup.repository,
      provision: vi.fn(async () => undefined),
      listCandidates: vi.fn(async () => setup.rows),
    }, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority }))
      .rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
  });

  it("publishes exact existing-Agent provisioning profiles for both purposes", () => {
    expect(workspaceServiceAgentProvisioningProfile("content_workflow")).toEqual({
      requestedAccess: ["service:content-workflow"],
      capabilities: ["workflow_runs.start@2"],
    });
    expect(workspaceServiceAgentProvisioningProfile("calendar_reschedule")).toEqual({
      requestedAccess: ["service:calendar-reschedule"],
      capabilities: ["publishing_plan_revisions.create@1"],
    });
  });
});
