import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_SERVICE_AUTHORITY_ACTOR_ID,
  WorkspaceServiceAgentResolver,
  WorkspaceServiceAgentUnavailableError,
  builtInServiceAuthorityAuditActor,
  validateWorkspaceServiceAgentAuthority,
  workspaceServiceAgentPrincipalId,
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
  studioAssetIds: [],
  artifactIds: [],
};
const authority: WorkspaceServiceAgentAuthority = {
  capability: "workflow_runs.start@3",
  authorizationContractDigest: `sha256:${"a".repeat(64)}`,
  resources: {
    ...EMPTY,
    workflowIds: ["workflow_1"],
    studioAssetIds: ["asset_direct", "asset_from_media_set"],
  },
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
    workspacePolicyEnabled: true,
    ...overrides,
  };
}

function mutableRepository() {
  const rows: WorkspaceServiceAgentCandidate[] = [];
  const provision = vi.fn(async (input: Parameters<WorkspaceServiceAgentRepository["provision"]>[0]) => {
    rows.push(candidate(
      input.workspaceId,
      workspaceServiceAgentPrincipalId(input.workspaceId, input.purpose),
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

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority, provisioningActorUserId: "member_a" })).resolves.toEqual({
      workspaceId: "workspace_a",
      principalId: workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"),
      keyId: "key_workspace_a",
    });
    await expect(resolver.resolve({ workspaceId: "workspace_b", purpose: "content_workflow", authority, provisioningActorUserId: "owner_b" })).resolves.toEqual({
      workspaceId: "workspace_b",
      principalId: workspaceServiceAgentPrincipalId("workspace_b", "content_workflow"),
      keyId: "key_workspace_b",
    });
    expect(setup.provision).toHaveBeenCalledTimes(2);
    expect(setup.provision).toHaveBeenNthCalledWith(1, expect.objectContaining({ initiatingUserId: "member_a" }));
    expect(setup.provision).toHaveBeenNthCalledWith(2, expect.objectContaining({ initiatingUserId: "owner_b" }));
    expect(setup.provision.mock.calls[0]?.[0].authority.resources).toMatchObject({
      workflowIds: ["workflow_1"],
      studioAssetIds: ["asset_direct", "asset_from_media_set"],
      artifactIds: [],
    });
  });

  it("coalesces concurrent bootstrap idempotently per Workspace and purpose", async () => {
    const setup = mutableRepository();
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);
    const request = { workspaceId: "workspace_a", purpose: "content_workflow" as const, authority, provisioningActorUserId: "owner_a" };

    const [first, second] = await Promise.all([resolver.resolve(request), resolver.resolve(request)]);

    expect(first).toEqual(second);
    expect(setup.provision).toHaveBeenCalledTimes(1);
    expect(setup.rows).toHaveLength(1);
  });

  it("expands an active actor scope when a Studio asset is newly required", async () => {
    const setup = mutableRepository();
    setup.rows.push(candidate("workspace_a", workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"), "key_old", "2026-09-01T00:00:00.000Z", {
      authorizationScopes: [{
        ...authority,
        resources: {
          ...EMPTY,
          workflowIds: ["workflow_1"],
          studioAssetIds: ["asset_direct"],
        },
      }],
    }));
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority, provisioningActorUserId: "member_a" }))
      .resolves.toMatchObject({ workspaceId: "workspace_a" });
    expect(setup.provision).toHaveBeenCalledOnce();
    expect(setup.provision).toHaveBeenCalledWith(expect.objectContaining({ initiatingUserId: "member_a" }));
    expect(setup.provision.mock.calls[0]?.[0].authority.resources.studioAssetIds)
      .toEqual(["asset_direct", "asset_from_media_set"]);
  });

  it("upgrades an existing tenant's active legacy service Principal for an ordinary member", async () => {
    const setup = mutableRepository();
    setup.rows.push(candidate("workspace_a", "legacy_random_principal", "legacy_key", "2026-09-01T00:00:00.000Z"));
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority, provisioningActorUserId: "member_a" }))
      .resolves.toEqual({
        workspaceId: "workspace_a",
        principalId: workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"),
        keyId: "key_workspace_a",
      });
    expect(setup.provision).toHaveBeenCalledWith(expect.objectContaining({ initiatingUserId: "member_a" }));
  });

  it("selects the newest eligible key during zero-downtime rotation", async () => {
    const setup = mutableRepository();
    setup.rows.push(
      candidate("workspace_a", workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"), "key_old", "2026-09-01T00:00:00.000Z"),
      candidate("workspace_a", workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"), "key_new", "2026-09-03T00:00:00.000Z"),
    );
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority, provisioningActorUserId: "owner_a" }))
      .resolves.toMatchObject({ principalId: workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"), keyId: "key_new" });
    expect(setup.provision).not.toHaveBeenCalled();
  });

  it("observes key rotation and revocation on the next request without a stale cache", async () => {
    const setup = mutableRepository();
    setup.rows.push(candidate("workspace_a", workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"), "key_old", "2026-09-01T00:00:00.000Z"));
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);
    const request = { workspaceId: "workspace_a", purpose: "content_workflow" as const, authority, provisioningActorUserId: "owner_a" };

    await expect(resolver.resolve(request)).resolves.toMatchObject({ keyId: "key_old" });
    setup.rows[0].keyRevokedAt = NOW;
    setup.rows.push(candidate("workspace_a", workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"), "key_new", "2026-09-03T00:00:00.000Z"));
    await expect(resolver.resolve(request)).resolves.toMatchObject({ keyId: "key_new" });
    setup.rows[1].keyRevokedAt = NOW;
    await expect(resolver.resolve(request)).rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
    expect(setup.provision).not.toHaveBeenCalled();
  });

  it("does not combine an active Principal with a usable key owned by a revoked Principal", async () => {
    const setup = mutableRepository();
    setup.rows.push(
      candidate("workspace_a", workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"), "key_revoked", "2026-09-03T00:00:00.000Z", {
        keyRevokedAt: NOW,
      }),
      candidate("workspace_a", "principal_revoked", "key_unrevoked", "2026-09-02T00:00:00.000Z", {
        principalStatus: "revoked",
        principalRevokedAt: NOW,
      }),
    );
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority, provisioningActorUserId: "owner_a" }))
      .rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
    expect(setup.provision).not.toHaveBeenCalled();
  });

  it("does not replace a revoked legacy service Principal with the deterministic built-in Principal", async () => {
    const setup = mutableRepository();
    setup.rows.push(candidate("workspace_a", "legacy_random_principal", "legacy_key", "2026-09-01T00:00:00.000Z", {
      principalStatus: "revoked",
      principalRevokedAt: NOW,
    }));
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority, provisioningActorUserId: "member_a" }))
      .rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
    expect(setup.provision).not.toHaveBeenCalled();
  });

  it("rejects wrong-Workspace and wrong-purpose actors", async () => {
    const setup = mutableRepository();
    setup.rows.push(
      candidate("workspace_b", workspaceServiceAgentPrincipalId("workspace_b", "content_workflow"), "key_b", "2026-09-01T00:00:00.000Z"),
      candidate("workspace_a", workspaceServiceAgentPrincipalId("workspace_a", "calendar_reschedule"), "key_calendar", "2026-09-02T00:00:00.000Z", {
        requestedAccess: ["service:calendar-reschedule"],
      }),
    );
    const resolver = new WorkspaceServiceAgentResolver({
      ...setup.repository,
      provision: vi.fn(async () => undefined),
      listCandidates: vi.fn(async () => setup.rows),
    }, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority, provisioningActorUserId: "owner_a" }))
      .rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
  });

  it("does not repair a disabled Workspace Agent policy on first use", async () => {
    const setup = mutableRepository();
    setup.rows.push(candidate("workspace_a", workspaceServiceAgentPrincipalId("workspace_a", "content_workflow"), "key_a", "2026-09-01T00:00:00.000Z", {
      workspacePolicyEnabled: false,
    }));
    const resolver = new WorkspaceServiceAgentResolver(setup.repository, () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow", authority, provisioningActorUserId: "member_a" }))
      .rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
    expect(setup.provision).not.toHaveBeenCalled();
  });

  it("binds audit actor to built-in system identity while preserving the human initiator", () => {
    expect(builtInServiceAuthorityAuditActor("member_a")).toEqual({
      actorKind: "built_in_system",
      systemActorId: BUILT_IN_SERVICE_AUTHORITY_ACTOR_ID,
      initiatingUserId: "member_a",
    });
  });

  it("rejects capabilities and resources belonging to another built-in purpose", () => {
    expect(() => validateWorkspaceServiceAgentAuthority("content_workflow", {
      ...authority,
      resources: { ...EMPTY, channelIds: ["channel_1"] },
    })).toThrow(WorkspaceServiceAgentUnavailableError);
    expect(() => validateWorkspaceServiceAgentAuthority("calendar_reschedule", authority))
      .toThrow(WorkspaceServiceAgentUnavailableError);
    expect(() => validateWorkspaceServiceAgentAuthority("calendar_reschedule", {
      capability: "publishing_plan_revisions.create@1",
      authorizationContractDigest: authority.authorizationContractDigest,
      resources: { ...EMPTY, workflowIds: ["workflow_1"] },
    })).toThrow(WorkspaceServiceAgentUnavailableError);
    expect(() => validateWorkspaceServiceAgentAuthority("calendar_reschedule", {
      capability: "publishing_plan_revisions.create@1",
      authorizationContractDigest: authority.authorizationContractDigest,
      resources: { ...EMPTY, studioAssetIds: ["asset_1"] },
    })).toThrow(WorkspaceServiceAgentUnavailableError);
  });

  it("publishes exact existing-Agent provisioning profiles for both purposes", () => {
    expect(workspaceServiceAgentProvisioningProfile("content_workflow")).toEqual({
      requestedAccess: ["service:content-workflow"],
      capabilities: ["workflow_runs.start@3"],
    });
    expect(workspaceServiceAgentProvisioningProfile("calendar_reschedule")).toEqual({
      requestedAccess: ["service:calendar-reschedule"],
      capabilities: ["publishing_plan_revisions.create@1"],
    });
  });
});
