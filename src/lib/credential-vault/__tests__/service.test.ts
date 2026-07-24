import { describe, expect, it, vi } from "vitest";
import {
  CredentialEffectExecutor,
  CredentialVaultError,
  CredentialVaultService,
} from "@/lib/credential-vault/service";
import { InMemoryCredentialVaultRepository } from "@/lib/credential-vault/memory-repository";
import type {
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
} from "@/types";

const cipher = {
  encrypt: (value: string) =>
    `vault:${Buffer.from(value).toString("base64url")}`,
  decrypt: (value: string) =>
    Buffer.from(value.slice("vault:".length), "base64url").toString(),
};

function setup() {
  let current = new Date("2026-07-25T00:00:00.000Z");
  const repository = new InMemoryCredentialVaultRepository();
  repository.addAdministrator("workspace-1", "human-1");
  repository.addPrincipal("workspace-1", "principal-1");
  repository.addAdministrator("workspace-2", "human-2");
  const vault = new CredentialVaultService(repository, cipher, () => current);
  const admissions: CapabilityAuthorizationRequest[] = [];
  const authorizer: CapabilityAuthorizer = {
    authorize: async (request) => {
      admissions.push(request);
      return {
        allowed:
          request.securityContext.kind === "agent" &&
          request.securityContext.workspaceId === "workspace-1" &&
          request.securityContext.principalId === "principal-1" &&
          request.securityContext.keyId === "key-1" &&
          request.resources[0]?.kind === "credential_profile",
      };
    },
  };
  const providerCalls: string[] = [];
  const cache = new Map<string, unknown>();
  const adapter = {
    provider: "openai",
    validate: vi.fn(),
    quote: vi.fn(async () => ({ priceCeilingCents: 4 })),
    execute: vi.fn(async (input: {
      intent: Record<string, unknown>;
      credential: { secret: string };
      idempotencyKey: string;
    }) => {
      if (cache.has(input.idempotencyKey)) {
        return cache.get(input.idempotencyKey);
      }
      providerCalls.push(input.idempotencyKey);
      const result = {
        accepted: true,
        prompt: input.intent.prompt,
        credentialSeenOnlyInsideAdapter: input.credential.secret.length > 0,
      };
      cache.set(input.idempotencyKey, result);
      return result;
    }),
  };
  const executor = new CredentialEffectExecutor(
    repository,
    cipher,
    authorizer,
    {
      capability: { name: "credentials.run.internal", version: 1 },
      authorizationContractDigest: `sha256:${"a".repeat(64)}`,
    },
    [adapter],
    () => current,
  );
  return {
    repository,
    vault,
    executor,
    adapter,
    admissions,
    providerCalls,
    setNow: (value: Date) => {
      current = value;
    },
  };
}

async function fixture(mode: "bounded" | "audited_unbounded" = "bounded") {
  const value = setup();
  const profile = await value.vault.createProfile({
    workspaceId: "workspace-1",
    actorUserId: "human-1",
    idempotencyKey: "fixture-profile-create",
    name: "Production OpenAI",
    provider: "openai",
    slotName: "primary-image-provider",
    secret: "sk-private-value-1234",
  });
  const grant = await value.vault.createSpendGrant({
    workspaceId: "workspace-1",
    actorUserId: "human-1",
    idempotencyKey: "fixture-grant-create",
    principalId: "principal-1",
    profileId: profile.id,
    mode,
    ...(mode === "bounded" ? { limitCents: 10 } : {}),
  });
  value.repository.addWorkflowBinding({
    workspaceId: "workspace-1",
    workflowId: "workflow-1",
    workflowRevision: "revision-1",
    binding: {
      nodeId: "node-openai",
      operationIdentity: "openai.responses.create@1",
      slotId: profile.slotId!,
    },
  });
  return { ...value, profile, grant };
}

const securityContext = {
  workspaceId: "workspace-1",
  principalId: "principal-1",
  keyId: "key-1",
};

async function snapshot(
  value: Awaited<ReturnType<typeof fixture>>,
  effectRef = "effect-1",
) {
  return value.executor.snapshotEffectIntent({
    securityContext,
    binding: {
      nodeId: "node-openai",
      operationIdentity: "openai.responses.create@1",
      slotId: value.profile.slotId!,
    },
    workflowStepRef: {
      workflowId: "workflow-1",
      workflowRevision: "revision-1",
      nodeId: "node-openai",
      operationIdentity: "openai.responses.create@1",
    },
    effectRef,
    providerIntent: { prompt: "hello" },
  });
}

describe("Credential Vault", () => {
  it("rejects detached slot operations that do not match the immutable Workflow step", async () => {
    const value = await fixture();
    await expect(
      value.executor.snapshotEffectIntent({
        securityContext,
        binding: {
          nodeId: "node-openai",
          operationIdentity: "openai.responses.create@1",
          slotId: value.profile.slotId!,
        },
        workflowStepRef: {
          workflowId: "workflow-1",
          workflowRevision: "revision-1",
          nodeId: "different-node",
          operationIdentity: "openai.responses.create@1",
        },
        effectRef: "detached-effect",
        providerIntent: { prompt: "hello" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects mutually matching binding DTOs that are not persisted in the referenced Workflow revision", async () => {
    const value = await fixture();
    await expect(
      value.executor.snapshotEffectIntent({
        securityContext,
        binding: {
          nodeId: "node-openai",
          operationIdentity: "openai.responses.create@1",
          slotId: value.profile.slotId!,
        },
        workflowStepRef: {
          workflowId: "forged-workflow",
          workflowRevision: "forged-revision",
          nodeId: "node-openai",
          operationIdentity: "openai.responses.create@1",
        },
        effectRef: "forged-effect",
        providerIntent: { prompt: "hello" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("vaults secrets and exposes redacted metadata only", async () => {
    const { repository, vault, profile } = await fixture();
    expect(profile.secretHint).toBe("••••1234");
    expect(JSON.stringify(await vault.listProfiles("workspace-1"))).not.toContain(
      "sk-private",
    );
    expect(JSON.stringify(repository.profiles)).not.toContain("sk-private");
    expect(JSON.stringify([...repository.versions.values()])).not.toContain(
      "sk-private-value-1234",
    );
  });

  it("keeps plaintext inside the provider adapter and reauthorizes at snapshot and effect", async () => {
    const value = await fixture();
    const intent = await snapshot(value);
    const result = await value.executor.withCredentialForEffect({
      securityContext,
      effectIntent: intent,
      providerIntent: { prompt: "hello" },
    });

    expect(value.admissions).toHaveLength(2);
    expect(value.admissions.every((item) => item.resources[0]?.id === value.profile.id)).toBe(true);
    expect(JSON.stringify(intent)).not.toContain("sk-private");
    expect(JSON.stringify(result)).not.toContain("sk-private");
    expect(result.result).toMatchObject({
      accepted: true,
      credentialSeenOnlyInsideAdapter: true,
    });
  });

  it("snapshots the old version through overlap while new intents choose current, then emergency revoke blocks old", async () => {
    const value = await fixture();
    const oldIntent = await snapshot(value, "old-effect");
    const rotated = await value.vault.rotateProfile({
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      idempotencyKey: "fixture-profile-rotate",
      profileId: value.profile.id,
      expectedActiveVersion: 1,
      overlapSeconds: 60,
      secret: "sk-rotated-value-5678",
    });
    const newIntent = await snapshot(value, "new-effect");

    expect(oldIntent.version).toBe(1);
    expect(newIntent.version).toBe(2);
    expect(rotated.activeVersion).toBe(2);
    await expect(
      value.executor.withCredentialForEffect({
        securityContext,
        effectIntent: oldIntent,
        providerIntent: { prompt: "hello" },
      }),
    ).resolves.toMatchObject({ version: 1 });

    await value.vault.revokeVersion({
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      profileId: value.profile.id,
      version: 1,
    });
    await expect(
      value.executor.withCredentialForEffect({
        securityContext,
        effectIntent: oldIntent,
        providerIntent: { prompt: "hello" },
      }),
    ).resolves.toMatchObject({ replayed: true, version: 1 });
  });

  it("replays the same fingerprint without recharging or a second external effect and conflicts on changed payload", async () => {
    const value = await fixture();
    const intent = await snapshot(value);
    const first = await value.executor.withCredentialForEffect({
      securityContext,
      effectIntent: intent,
      providerIntent: { prompt: "hello" },
    });
    const replay = await value.executor.withCredentialForEffect({
      securityContext,
      effectIntent: intent,
      providerIntent: { prompt: "hello" },
    });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(value.providerCalls).toEqual(["effect-1"]);
    expect(
      (await value.repository.listSpendGrants("workspace-1"))[0]?.spentCents,
    ).toBe(4);
    expect(
      value.repository.effectAuditEvents.map((event) => event.eventType),
    ).toEqual([
      "effect.reserved",
      "effect.completed",
      "effect.replayed",
    ]);

    await expect(
      value.executor.withCredentialForEffect({
        securityContext,
        effectIntent: { ...intent, priceCeilingCents: 5 },
        providerIntent: { prompt: "hello" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("replays a completed durable receipt across a fresh executor without calling the adapter", async () => {
    const value = await fixture();
    const intent = await snapshot(value, "durable-effect");
    const first = await value.executor.withCredentialForEffect({
      securityContext,
      effectIntent: intent,
      providerIntent: { prompt: "hello" },
    });
    const freshExecutor = new CredentialEffectExecutor(
      value.repository,
      {
        encrypt: cipher.encrypt,
        decrypt: () => {
          throw new Error("completed replay must not load credential material");
        },
      },
      { authorize: async () => ({ allowed: true }) },
      {
        capability: { name: "credentials.run.internal", version: 1 },
        authorizationContractDigest: `sha256:${"c".repeat(64)}`,
      },
      [],
    );
    const replay = await freshExecutor.withCredentialForEffect({
      securityContext,
      effectIntent: intent,
      providerIntent: { prompt: "hello" },
    });

    expect(replay).toEqual({ ...first, replayed: true });
    expect(
      (await value.repository.listSpendGrants("workspace-1"))[0]?.spentCents,
    ).toBe(4);
  });

  it("does not reserve spend when decryption/configuration fails", async () => {
    const value = await fixture();
    const intent = await snapshot(value);
    const brokenCipher = {
      encrypt: cipher.encrypt,
      decrypt: () => {
        throw new Error("key unavailable");
      },
    };
    const executor = new CredentialEffectExecutor(
      value.repository,
      brokenCipher,
      { authorize: async () => ({ allowed: true }) },
      {
        capability: { name: "credentials.run.internal", version: 1 },
        authorizationContractDigest: `sha256:${"b".repeat(64)}`,
      },
      [{
        provider: "openai",
        validate: () => undefined,
        quote: () => ({ priceCeilingCents: 4 }),
        execute: async () => ({ impossible: true }),
      }],
    );

    await expect(
      executor.withCredentialForEffect({
        securityContext,
        effectIntent: intent,
        providerIntent: { prompt: "hello" },
      }),
    ).rejects.toThrow("key unavailable");
    expect(value.repository.spendEvents).toHaveLength(0);
    expect(value.repository.grants.get(value.grant.id)?.spentCents).toBe(0);
  });

  it.each([
    {
      condition: "disabled credentials",
      run: async () => {
        const value = await fixture("audited_unbounded");
        const intent = await snapshot(value);
        await value.vault.setProfileStatus({
          workspaceId: "workspace-1",
          actorUserId: "human-1",
          profileId: value.profile.id,
          status: "disabled",
        });
        await expect(
          value.executor.withCredentialForEffect({
            securityContext,
            effectIntent: intent,
            providerIntent: { prompt: "hello" },
          }),
        ).rejects.toBeInstanceOf(CredentialVaultError);
      },
    },
    {
      condition: "revoked spend grants",
      run: async () => {
        const value = await fixture("audited_unbounded");
        await value.vault.revokeSpendGrant({
          workspaceId: "workspace-1",
          actorUserId: "human-1",
          grantId: value.grant.id,
        });
        await expect(
          snapshot(value, "revoked-grant"),
        ).rejects.toMatchObject({
          code: "SPEND_NOT_AUTHORIZED",
        });
      },
    },
    {
      condition: "cross-Workspace effect contexts",
      run: async () => {
        const value = await fixture("audited_unbounded");
        const intent = await snapshot(value);
        await expect(
          value.executor.withCredentialForEffect({
            securityContext: {
              ...securityContext,
              workspaceId: "workspace-2",
            },
            effectIntent: intent,
            providerIntent: { prompt: "hello" },
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      },
    },
  ])("fails closed for $condition", async ({ run }) => run());

  it("keeps a legacy profile reprovisionable when unsafe activation is rejected", async () => {
    const { vault, repository } = setup();
    repository.profiles.set("legacy-profile", {
      id: "legacy-profile",
      workspaceId: "workspace-1",
      name: "Legacy",
      provider: "openai",
      slotId: null,
      slotName: null,
      status: "disabled",
      activeVersion: null,
      secretHint: null,
      rotatedAt: null,
      reprovisionable: true,
      deletedAt: null,
    });

    await expect(
      vault.setProfileStatus({
        workspaceId: "workspace-1",
        actorUserId: "human-1",
        profileId: "legacy-profile",
        status: "active",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      vault.getSafeProfile({
        workspaceId: "workspace-1",
        profileId: "legacy-profile",
      }),
    ).resolves.toMatchObject({
      status: "disabled",
      reprovisionable: true,
      activeVersion: null,
    });
  });

  it("requires reprovision after emergency-revoking the active version", async () => {
    const value = await fixture();
    value.repository.addPrincipal("workspace-1", "principal-2");
    await value.vault.revokeVersion({
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      profileId: value.profile.id,
      version: 1,
    });

    await expect(
      value.vault.setProfileStatus({
        workspaceId: "workspace-1",
        actorUserId: "human-1",
        profileId: value.profile.id,
        status: "active",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      value.vault.createSpendGrant({
        workspaceId: "workspace-1",
        actorUserId: "human-1",
        idempotencyKey: "revoked-version-grant",
        principalId: "principal-2",
        profileId: value.profile.id,
        mode: "bounded",
        limitCents: 100,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const unavailable = await value.vault.getSafeProfile({
      workspaceId: "workspace-1",
      profileId: value.profile.id,
    });
    expect(unavailable).toMatchObject({
      status: "disabled",
      reprovisionable: true,
      activeVersion: null,
      secretHint: null,
    });

    const recovered = await value.vault.reprovisionProfile({
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      idempotencyKey: "revoked-version-reprovision",
      profileId: value.profile.id,
      provider: "openai",
      slotName: "recovered",
      secret: "replacement-provider-key",
    });
    expect(recovered).toMatchObject({
      status: "active",
      reprovisionable: false,
      activeVersion: 2,
    });
  });

  it("requires an explicit Credential Spend Grant mode and owner/admin handoff", async () => {
    const { vault } = setup();
    await expect(
      vault.createProfile({
        workspaceId: "workspace-1",
        actorUserId: "member-1",
        idempotencyKey: "denied-profile-create",
        name: "Denied",
        provider: "openai",
        slotName: "denied",
        secret: "secret-long",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      vault.createSpendGrant({
        workspaceId: "workspace-1",
        actorUserId: "human-1",
        idempotencyKey: "invalid-grant-create",
        principalId: "principal-1",
        profileId: "missing",
        mode: "bounded",
      }),
    ).rejects.toBeInstanceOf(CredentialVaultError);
  });

  it("rejects spend grants for inactive principals", async () => {
    const { vault, repository } = setup();
    const profile = await vault.createProfile({
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      idempotencyKey: "inactive-principal-profile",
      name: "Inactive principal profile",
      provider: "openai",
      slotName: "inactive-principal-slot",
      secret: "private-provider-key",
    });
    repository.addPrincipal("workspace-1", "principal-1", "suspended");

    await expect(
      vault.createSpendGrant({
        workspaceId: "workspace-1",
        actorUserId: "human-1",
        idempotencyKey: "inactive-principal-grant",
        principalId: "principal-1",
        profileId: profile.id,
        mode: "bounded",
        limitCents: 100,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("replays the durable result after a lost response and conflicts on key reuse with another payload", async () => {
    const { vault, repository } = setup();
    const request = {
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      idempotencyKey: "lost-response-profile-create",
      name: "Lost response profile",
      provider: "openai",
      slotName: "lost-response-slot",
      secret: "sk-lost-response-secret",
    };

    const first = await vault.createProfile(request);
    // Simulate the client never receiving `first` and retrying against the
    // same durable repository from a fresh service process.
    const freshVault = new CredentialVaultService(
      repository,
      cipher,
      () => new Date("2026-07-25T00:00:01.000Z"),
    );
    const replay = await freshVault.createProfile(request);

    expect(replay).toEqual(first);
    expect(repository.profiles).toHaveLength(1);
    expect(repository.versions).toHaveLength(1);
    expect(repository.slots).toHaveLength(1);
    expect(repository.humanMutationReceipts).toHaveLength(1);

    await expect(
      freshVault.createProfile({
        ...request,
        name: "Different payload",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Idempotency-Key"),
    });
    expect(repository.profiles).toHaveLength(1);
  });

  it("replays spend-grant creation and rotation before evaluating current-state conflicts", async () => {
    const value = await fixture();
    const grantReplay = await value.vault.createSpendGrant({
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      idempotencyKey: "fixture-grant-create",
      principalId: "principal-1",
      profileId: value.profile.id,
      mode: "bounded",
      limitCents: 10,
    });
    expect(grantReplay).toEqual(value.grant);
    expect(value.repository.grants).toHaveLength(1);

    const rotation = {
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      idempotencyKey: "rotation-lost-response",
      profileId: value.profile.id,
      expectedActiveVersion: 1,
      overlapSeconds: 0,
      secret: "sk-rotated-lost-response",
    };
    const first = await value.vault.rotateProfile(rotation);
    const replay = await value.vault.rotateProfile(rotation);
    expect(replay).toEqual(first);
    expect(value.repository.versions).toHaveLength(2);
  });
});
