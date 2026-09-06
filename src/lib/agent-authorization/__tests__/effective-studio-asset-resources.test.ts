import { describe, expect, it } from "vitest";
import type {
  AgentCapabilityGrant,
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentResourceConstraints,
} from "@/types";
import { InMemoryAgentAuthorizationRepository } from "../memory-repository";
import { AgentAuthorizationService } from "../service";

const NOW = new Date("2026-09-04T12:00:00.000Z");
const digest = `sha256:${"b".repeat(64)}`;
const resources: AgentResourceConstraints = {
  channelIds: [],
  credentialProfileIds: [],
  workflowIds: [],
  automationIds: [],
  studioAssetIds: ["asset-live", "asset-deleted", "asset-other-tenant"],
  artifactIds: [],
};
const grant: AgentCapabilityGrant = {
  capability: "workflow_runs.start@3",
  authorizationContractDigest: digest,
  resources,
};

describe("effective Studio asset resources", () => {
  it("admits only live assets in the Agent Workspace and never projects them as runtime Artifacts", async () => {
    const repository = new InMemoryAgentAuthorizationRepository();
    const service = new AgentAuthorizationService(repository, {
      now: () => NOW,
    });
    const principal: AgentPrincipalRecord = {
      id: "principal-1",
      workspaceId: "workspace-1",
      sponsorUserId: "owner-1",
      name: "Content runner",
      requestedAccess: [],
      status: "active",
      suspendedAt: null,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const key: AgentKeyRecord = {
      id: "key-1",
      principalId: principal.id,
      name: "Content key",
      lookupPrefix: "lookup",
      secretHash: "unused",
      pepperVersion: 1,
      authorizationScopes: [grant],
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: NOW,
    };
    repository.principals.set(principal.id, principal);
    repository.keys.set(key.id, key);
    repository.addAdministrator("workspace-1", "owner-1");
    repository.setResourceActive("workspace-1", {
      kind: "studio_asset",
      id: "asset-live",
    });
    repository.setResourceActive("workspace-2", {
      kind: "studio_asset",
      id: "asset-other-tenant",
    });
    await service.putWorkspacePolicy({
      workspaceId: "workspace-1",
      enabled: true,
      grants: [grant],
      actorUserId: "owner-1",
    });
    await service.createGrantSet({
      workspaceId: "workspace-1",
      principalId: principal.id,
      name: "Content runners",
      grants: [grant],
      actorUserId: "owner-1",
    });

    const authorize = (id: string) => service.authorize({
      securityContext: {
        kind: "agent" as const,
        principalId: principal.id,
        workspaceId: principal.workspaceId,
        keyId: key.id,
      },
      audience: "agent" as const,
      capability: { name: "workflow_runs.start", version: 3 },
      authorizationContractDigest: digest,
      resources: [{ kind: "studio_asset" as const, id }],
    });

    await expect(authorize("asset-live")).resolves.toMatchObject({
      allowed: true,
      effectiveResources: {
        studioAssetIds: ["asset-live"],
        artifactIds: [],
      },
    });
    await expect(authorize("asset-deleted")).resolves.toMatchObject({
      allowed: false,
    });
    expect(repository.decisions.at(-1)?.reason).toBe("resource_unavailable");
    await expect(authorize("asset-other-tenant")).resolves.toMatchObject({
      allowed: false,
    });
    expect(repository.decisions.at(-1)?.reason).toBe("resource_unavailable");
  });
});
