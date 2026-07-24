import { describe, expect, it } from "vitest";
import { InMemoryAgentAuthorizationRepository } from "../memory-repository";
import { AgentAuthorizationService } from "../service";
import type {
  AgentCapabilityGrant,
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentResourceConstraints,
} from "@/types";

const NOW = new Date("2026-07-24T12:00:00.000Z");
const capability = { name: "credentials.profile.list", version: 1 };
const authorizationContractDigest = `sha256:${"a".repeat(64)}`;
const resources: AgentResourceConstraints = {
  channelIds: [],
  credentialProfileIds: [
    "profile-active",
    "profile-disabled",
    "profile-deleted",
  ],
  workflowIds: [],
  automationIds: [],
};
const grant: AgentCapabilityGrant = {
  capability: "credentials.profile.list@1",
  authorizationContractDigest,
  resources,
};

describe("effective Credential Profile resources", () => {
  it("returns only currently active resources from the memory admission repository", async () => {
    const repository = new InMemoryAgentAuthorizationRepository();
    const service = new AgentAuthorizationService(repository, {
      now: () => NOW,
    });
    const principal: AgentPrincipalRecord = {
      id: "principal-1",
      workspaceId: "workspace-1",
      sponsorUserId: "owner-1",
      name: "Auditor",
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
      name: "Audit key",
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
      kind: "credential_profile",
      id: "profile-active",
    });
    // Stale authority may still name disabled/deleted IDs; current resource
    // state, not the historical grant, controls list enumeration.
    await service.putWorkspacePolicy({
      workspaceId: "workspace-1",
      enabled: true,
      grants: [grant],
      actorUserId: "owner-1",
    });
    await service.createGrantSet({
      workspaceId: "workspace-1",
      principalId: principal.id,
      name: "Credential readers",
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
        capability,
        authorizationContractDigest,
        resources: [],
      }),
    ).resolves.toMatchObject({
      allowed: true,
      effectiveResources: {
        credentialProfileIds: ["profile-active"],
      },
    });
  });
});
