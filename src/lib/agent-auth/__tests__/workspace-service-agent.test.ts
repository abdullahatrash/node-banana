import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceServiceAgentResolver,
  WorkspaceServiceAgentUnavailableError,
  workspaceServiceAgentProvisioningProfile,
  type WorkspaceServiceAgentCandidate,
  type WorkspaceServiceAgentRepository,
} from "../workspace-service-agent";

const NOW = new Date("2026-09-04T10:00:00.000Z");

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
    authorizationCapabilities: ["workflow_runs.start@2"],
    ...overrides,
  };
}

function repository(
  implementation: WorkspaceServiceAgentRepository["listCandidates"],
): WorkspaceServiceAgentRepository {
  return { listCandidates: implementation };
}

describe("WorkspaceServiceAgentResolver", () => {
  it("resolves distinct service actors for two Workspaces", async () => {
    const listCandidates = vi.fn(async ({ workspaceId }) => [
      candidate(workspaceId, `principal_${workspaceId}`, `key_${workspaceId}`, "2026-09-01T00:00:00.000Z"),
    ]);
    const resolver = new WorkspaceServiceAgentResolver(repository(listCandidates), () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow" })).resolves.toEqual({
      workspaceId: "workspace_a",
      principalId: "principal_workspace_a",
      keyId: "key_workspace_a",
    });
    await expect(resolver.resolve({ workspaceId: "workspace_b", purpose: "content_workflow" })).resolves.toEqual({
      workspaceId: "workspace_b",
      principalId: "principal_workspace_b",
      keyId: "key_workspace_b",
    });
  });

  it("rejects a candidate returned from another Workspace", async () => {
    const resolver = new WorkspaceServiceAgentResolver(
      repository(async () => [candidate("workspace_b", "principal_b", "key_b", "2026-09-01T00:00:00.000Z")]),
      () => NOW,
    );

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow" }))
      .rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
  });

  it("selects the newest active key after rotation and observes revocation without a stale cache", async () => {
    let rows = [candidate("workspace_a", "principal_a", "key_old", "2026-09-01T00:00:00.000Z")];
    const resolver = new WorkspaceServiceAgentResolver(repository(async () => rows), () => NOW);

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow" }))
      .resolves.toMatchObject({ keyId: "key_old" });

    rows = [
      candidate("workspace_a", "principal_a", "key_old", "2026-09-01T00:00:00.000Z", { keyRevokedAt: NOW }),
      candidate("workspace_a", "principal_a", "key_new", "2026-09-03T00:00:00.000Z"),
    ];
    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow" }))
      .resolves.toMatchObject({ keyId: "key_new" });

    rows = rows.map((row) => ({ ...row, keyRevokedAt: NOW }));
    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow" }))
      .rejects.toBeInstanceOf(WorkspaceServiceAgentUnavailableError);
  });

  it("fails closed for a revoked Principal or ambiguous purpose provisioning", async () => {
    const revoked = candidate("workspace_a", "principal_a", "key_a", "2026-09-01T00:00:00.000Z", {
      principalStatus: "revoked",
      principalRevokedAt: NOW,
    });
    const resolver = new WorkspaceServiceAgentResolver(
      repository(async () => [
        revoked,
        candidate("workspace_a", "principal_b", "key_b", "2026-09-02T00:00:00.000Z"),
        candidate("workspace_a", "principal_c", "key_c", "2026-09-03T00:00:00.000Z"),
      ]),
      () => NOW,
    );

    await expect(resolver.resolve({ workspaceId: "workspace_a", purpose: "content_workflow" }))
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
