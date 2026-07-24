import { describe, expect, it } from "vitest";
import {
  AgentAuthorizationService,
  InMemoryAgentAuthorizationRepository,
} from "@/lib/agent-authorization";
import {
  CredentialVaultService,
} from "@/lib/credential-vault/service";
import { InMemoryCredentialVaultRepository } from "@/lib/credential-vault/memory-repository";
import {
  CREDENTIAL_PROFILE_GET_IDENTITY,
  CREDENTIAL_PROFILE_LIST_IDENTITY,
  CapabilityDispatcher,
  authorizationContractDigestFor,
  createAgentIdentityRegistrations,
  createCapabilityRegistry,
  createCredentialProfileRegistrations,
  createDiscoveryRegistrations,
  dispatchCliCapability,
  dispatchMcpCapability,
} from "@/lib/agent-tools";
import type { AgentKeyRecord, AgentPrincipalRecord } from "@/types";

const now = new Date("2026-07-25T00:00:00.000Z");
const cipher = {
  encrypt: (value: string) =>
    `vault:${Buffer.from(value).toString("base64url")}`,
  decrypt: (value: string) =>
    Buffer.from(value.slice(6), "base64url").toString(),
};

describe("Credential Profile capability parity", () => {
  it("enforces exact resource grants and returns redacted metadata over CLI/MCP", async () => {
    const vaultRepository = new InMemoryCredentialVaultRepository();
    vaultRepository.addAdministrator("workspace-1", "human-1");
    const vault = new CredentialVaultService(
      vaultRepository,
      cipher,
      () => now,
    );
    const profile = await vault.createProfile({
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      idempotencyKey: "parity-profile-create",
      name: "OpenAI production",
      provider: "openai",
      slotName: "writer",
      secret: "sk-super-secret-1234",
    });
    const rotated = await vault.rotateProfile({
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      idempotencyKey: "parity-profile-rotate",
      profileId: profile.id,
      expectedActiveVersion: 1,
      overlapSeconds: 60,
      secret: "sk-rotated-secret-5678",
    });
    vaultRepository.profiles.set("profile-disabled", {
      ...rotated,
      id: "profile-disabled",
      name: "Disabled",
      status: "disabled",
      deletedAt: null,
    });
    vaultRepository.profiles.set("profile-deleted", {
      ...rotated,
      id: "profile-deleted",
      name: "Deleted",
      deletedAt: now,
    });
    vaultRepository.profiles.set("profile-ungranted", {
      ...rotated,
      id: "profile-ungranted",
      name: "Ungrantable but active",
      deletedAt: null,
    });
    const authorizationRepository =
      new InMemoryAgentAuthorizationRepository();
    authorizationRepository.addAdministrator("workspace-1", "human-1");
    const principal: AgentPrincipalRecord = {
      id: "principal-1",
      workspaceId: "workspace-1",
      sponsorUserId: "human-1",
      name: "Writer",
      requestedAccess: [],
      status: "active",
      suspendedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const registry = createCapabilityRegistry([
      ...createDiscoveryRegistrations(),
      ...createAgentIdentityRegistrations(),
      ...createCredentialProfileRegistrations(vault),
    ]);
    const registration = registry.getRegistration(
      CREDENTIAL_PROFILE_GET_IDENTITY,
    )!;
    const digest = authorizationContractDigestFor(
      CREDENTIAL_PROFILE_GET_IDENTITY,
      registration.authorization,
    );
    const listRegistration = registry.getRegistration(
      CREDENTIAL_PROFILE_LIST_IDENTITY,
    )!;
    const listDigest = authorizationContractDigestFor(
      CREDENTIAL_PROFILE_LIST_IDENTITY,
      listRegistration.authorization,
    );
    const resources = {
      channelIds: [],
      credentialProfileIds: [
        profile.id,
        "profile-disabled",
        "profile-deleted",
      ],
      workflowIds: [],
      automationIds: [],
    };
    const key: AgentKeyRecord = {
      id: "key-1",
      principalId: principal.id,
      name: "Test",
      lookupPrefix: "lookup",
      secretHash: "unused",
      pepperVersion: 1,
      authorizationScopes: [
        {
          capability: "credentials.profile.get@1",
          authorizationContractDigest: digest,
          resources,
        },
        {
          capability: "credentials.profile.list@1",
          authorizationContractDigest: listDigest,
          resources,
        },
      ],
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    };
    authorizationRepository.principals.set(principal.id, principal);
    authorizationRepository.keys.set(key.id, key);
    authorizationRepository.setResourceActive("workspace-1", {
      kind: "credential_profile",
      id: profile.id,
    });
    authorizationRepository.setResourceActive("workspace-1", {
      kind: "credential_profile",
      id: "profile-deleted",
    });
    const authorization = new AgentAuthorizationService(
      authorizationRepository,
      { now: () => now },
    );
    const grant = {
      capability: "credentials.profile.get@1",
      authorizationContractDigest: digest,
      resources,
    };
    const listGrant = {
      capability: "credentials.profile.list@1",
      authorizationContractDigest: listDigest,
      resources,
    };
    await authorization.putWorkspacePolicy({
      workspaceId: "workspace-1",
      enabled: true,
      grants: [grant, listGrant],
      actorUserId: "human-1",
    });
    const authority = await authorization.createGrantSet({
      workspaceId: "workspace-1",
      principalId: principal.id,
      name: "Credentials",
      grants: [grant, listGrant],
      actorUserId: "human-1",
    });
    const dispatcher = new CapabilityDispatcher(
      registry,
      authorization,
    );
    const port = {
      dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
        dispatcher.dispatch(invocation, {
          securityContext: {
            kind: "agent",
            principalId: principal.id,
            workspaceId: principal.workspaceId,
            keyId: key.id,
          },
        }),
    };
    const input = { credentialProfileId: profile.id };
    const cli = await dispatchCliCapability(
      "credentials.profile.get@1",
      input,
      port,
    );
    const mcp = await dispatchMcpCapability(
      "credentials.profile.get.v1",
      input,
      port,
    );
    const list = await dispatchMcpCapability(
      "credentials.profile.list.v1",
      {},
      port,
    );
    const listCli = await dispatchCliCapability(
      "credentials.profile.list@1",
      {},
      port,
    );

    expect(mcp).toEqual(cli);
    expect(cli).toMatchObject({
      type: "capability_result",
      output: {
        id: profile.id,
        activeVersion: 2,
        secretHint: "••••5678",
      },
    });
    expect(JSON.stringify(cli)).not.toContain("sk-super-secret");
    expect(JSON.stringify(cli)).not.toContain("sk-rotated-secret");
    expect(JSON.stringify(cli)).not.toContain("secretCiphertext");
    expect(list).toMatchObject({
      type: "capability_result",
      output: { profiles: [{ id: profile.id }] },
    });
    expect(list).toEqual(listCli);
    expect(JSON.stringify(list)).not.toContain("profile-disabled");
    expect(JSON.stringify(list)).not.toContain("profile-ungranted");
    authorizationRepository.grantSets.set(authority.grantSet.id, {
      ...authority.grantSet,
      disabledAt: now,
      updatedAt: now,
    });
    const revokedGrantResults = await Promise.all([
      dispatchCliCapability("credentials.profile.get@1", input, port),
      dispatchMcpCapability("credentials.profile.get.v1", input, port),
    ]);
    for (const result of revokedGrantResults) {
      expect(result).toMatchObject({
        type: "capability_error",
        code: "CAPABILITY_NOT_AUTHORIZED",
        category: "authorization",
        message:
          "Capability credentials.profile.get@1 is not authorized. Ask a Workspace owner or admin to grant that exact capability and its required resources.",
        retryable: false,
      });
      expect(JSON.stringify(result)).not.toContain(profile.id);
      expect(JSON.stringify(result)).not.toContain("activeVersion");
      expect(JSON.stringify(result)).not.toContain("secretHint");
    }
    authorizationRepository.grantSets.set(
      authority.grantSet.id,
      authority.grantSet,
    );
    for (const transport of [
      {
        name: "CLI",
        invoke: (credentialProfileId: string) =>
          dispatchCliCapability(
            "credentials.profile.get@1",
            { credentialProfileId },
            port,
          ),
      },
      {
        name: "MCP",
        invoke: (credentialProfileId: string) =>
          dispatchMcpCapability(
            "credentials.profile.get.v1",
            { credentialProfileId },
            port,
          ),
      },
    ]) {
      await expect(
        transport.invoke("profile-ungranted"),
        `${transport.name} must enforce the exact resource grant`,
      ).resolves.toMatchObject({
        type: "capability_error",
        code: "CAPABILITY_NOT_AUTHORIZED",
      });
    }
    vaultRepository.profiles.get(profile.id)!.status = "disabled";
    for (const transport of [
      () => dispatchCliCapability("credentials.profile.get@1", input, port),
      () => dispatchMcpCapability("credentials.profile.get.v1", input, port),
    ]) {
      await expect(transport()).resolves.toMatchObject({
        type: "capability_error",
        code: "CREDENTIAL_PROFILE_UNAVAILABLE",
      });
    }
    const crossWorkspacePort = {
      dispatch: (invocation: Parameters<typeof dispatcher.dispatch>[0]) =>
        dispatcher.dispatch(invocation, {
          securityContext: {
            kind: "agent",
            principalId: principal.id,
            workspaceId: "workspace-2",
            keyId: key.id,
          },
        }),
    };
    for (const transport of [
      () =>
        dispatchCliCapability(
          "credentials.profile.get@1",
          input,
          crossWorkspacePort,
        ),
      () =>
        dispatchMcpCapability(
          "credentials.profile.get.v1",
          input,
          crossWorkspacePort,
        ),
    ]) {
      await expect(transport()).resolves.toMatchObject({
        type: "capability_error",
        code: "CAPABILITY_NOT_AUTHORIZED",
      });
    }
    expect(JSON.stringify(list)).not.toContain("profile-deleted");
  });
});
