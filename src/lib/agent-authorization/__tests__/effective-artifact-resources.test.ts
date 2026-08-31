import { describe, expect, it } from "vitest";
import type {
  AgentCapabilityGrant,
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentResourceConstraints,
} from "@/types";
import { InMemoryAgentAuthorizationRepository } from "../memory-repository";
import { AgentAuthorizationService } from "../service";

const NOW = new Date("2026-07-25T00:00:00.000Z");
const digest = `sha256:${"a".repeat(64)}`;
const resources: AgentResourceConstraints = {
  channelIds: [],
  credentialProfileIds: [],
  workflowIds: [],
  automationIds: [],
  artifactIds: ["artifact-live", "artifact-deleted"],
};
const grant: AgentCapabilityGrant = {
  capability: "artifacts.get@1",
  authorizationContractDigest: digest,
  resources,
};

describe("effective Artifact resources", () => {
  it("normalizes legacy JSON and admits only currently live Artifact selectors", async () => {
    const repository = new InMemoryAgentAuthorizationRepository();
    const service = new AgentAuthorizationService(repository, {
      now: () => NOW,
    });
    const principal: AgentPrincipalRecord = {
      id: "principal-1",
      workspaceId: "workspace-1",
      sponsorUserId: "owner-1",
      name: "Artifact reader",
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
      name: "Artifact key",
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
      kind: "artifact",
      id: "artifact-live",
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
      name: "Artifact readers",
      grants: [grant],
      actorUserId: "owner-1",
    });

    await expect(
      service.authorize({
        securityContext: {
          kind: "agent",
          principalId: principal.id,
          workspaceId: principal.workspaceId,
          keyId: key.id,
        },
        audience: "agent",
        capability: { name: "artifacts.get", version: 1 },
        authorizationContractDigest: digest,
        resources: [{ kind: "artifact", id: "artifact-live" }],
      }),
    ).resolves.toMatchObject({
      allowed: true,
      effectiveResources: { artifactIds: ["artifact-live"] },
    });
    await expect(
      service.authorize({
        securityContext: {
          kind: "agent",
          principalId: principal.id,
          workspaceId: principal.workspaceId,
          keyId: key.id,
        },
        audience: "agent",
        capability: { name: "artifacts.get", version: 1 },
        authorizationContractDigest: digest,
        resources: [{ kind: "artifact", id: "artifact-deleted" }],
      }),
    ).resolves.toMatchObject({ allowed: false });
  });
});
