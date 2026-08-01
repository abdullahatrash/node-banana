import { z } from "zod";
import {
  AgentAuthService,
  InMemoryAgentAuthRepository,
} from "@/lib/agent-auth";
import {
  AgentAuthorizationService,
  EMPTY_RESOURCE_CONSTRAINTS,
  InMemoryAgentAuthorizationRepository,
  normalizeCapabilityGrants,
} from "@/lib/agent-authorization";
import {
  COMMON_DISCOVERY_ERRORS,
  CapabilityDispatcher,
  QUERY_EFFECT,
  createCapabilityRegistry,
  defineCapability,
  authorizationContractDigestFor,
} from "@/lib/agent-tools";
import type {
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentResourceConstraints,
  AgentSecurityContext,
} from "@/types";

const NOW = new Date("2026-07-24T16:00:00.000Z");
const EMPTY = EMPTY_RESOURCE_CONSTRAINTS;
const securityContext: AgentSecurityContext = {
  principalId: "principal-1",
  workspaceId: "workspace-1",
  keyId: "key-1",
};

function resources(
  channelIds: string[] = [],
  overrides: Partial<AgentResourceConstraints> = {},
): AgentResourceConstraints {
  return {
    channelIds,
    credentialProfileIds: [],
    workflowIds: [],
    automationIds: [],
    ...overrides,
  };
}

function fixture() {
  let publishCalls = 0;
  let auditCalls = 0;
  const base = {
    summary: "Authorization fixture.",
    lifecycle: {
      status: "active",
      introducedAt: "2026-07-24T00:00:00.000Z",
      recommended: true,
    } as const,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: { ok: { type: "boolean" } },
    },
    effect: QUERY_EFFECT,
    approval: { mode: "none" } as const,
    idempotency: { mode: "retry-safe" } as const,
    errors: COMMON_DISCOVERY_ERRORS,
  };
  const publishInput = z
    .object({
      channelId: z.string().min(1),
      prompt: z.string().optional(),
    })
    .strict();
  const registry = createCapabilityRegistry([
    defineCapability({
      ...base,
      identity: { name: "content.publish", version: 1 },
      input: publishInput,
      authorization: {
        resources: [{ kind: "channel", inputPath: "channelId" }],
      },
      handler: () => {
        publishCalls += 1;
        return { ok: true };
      },
    }),
    defineCapability({
      ...base,
      identity: { name: "content.publish", version: 2 },
      lifecycle: {
        ...base.lifecycle,
        recommended: false,
      },
      input: publishInput,
      authorization: {
        resources: [{ kind: "channel", inputPath: "channelId" }],
      },
      handler: () => {
        publishCalls += 1;
        return { ok: true };
      },
    }),
    defineCapability({
      ...base,
      identity: { name: "content.inspect", version: 1 },
      input: publishInput,
      authorization: {
        resources: [{ kind: "channel", inputPath: "channelId" }],
      },
      handler: () => {
        publishCalls += 1;
        return { ok: true };
      },
    }),
    defineCapability({
      ...base,
      identity: { name: "authorization.decisions.list", version: 1 },
      input: z.object({}).strict(),
      authorization: { resources: [] },
      handler: () => {
        auditCalls += 1;
        return { ok: true };
      },
    }),
    defineCapability({
      ...base,
      identity: { name: "content.broken_selector", version: 1 },
      input: publishInput,
      authorization: {
        resources: [{ kind: "channel", inputPath: "missingChannelId" }],
      },
      handler: () => {
        publishCalls += 1;
        return { ok: true };
      },
    }),
    defineCapability({
      ...base,
      identity: { name: "content.batch_publish", version: 1 },
      input: z.object({ channelIds: z.array(z.string()) }).strict(),
      authorization: {
        resources: [{ kind: "channel", inputPath: "channelIds" }],
      },
      handler: () => {
        publishCalls += 1;
        return { ok: true };
      },
    }),
  ]);
  const repository = new InMemoryAgentAuthorizationRepository();
  repository.addAdministrator("workspace-1", "human-1");
  const service = new AgentAuthorizationService(repository, {
    now: () => new Date(NOW),
  });
  const dispatcher = new CapabilityDispatcher(registry, service);
  const principal: AgentPrincipalRecord = {
    id: securityContext.principalId,
    workspaceId: securityContext.workspaceId,
    sponsorUserId: "human-1",
    name: "Publisher",
    requestedAccess: ["human-readable enrollment history"],
    status: "active",
    suspendedAt: null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const key: AgentKeyRecord = {
    id: securityContext.keyId,
    principalId: principal.id,
    name: "Test key",
    lookupPrefix: "lookup",
    secretHash: "not-used-by-authorization",
    pepperVersion: 1,
    authorizationScopes: [],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: NOW,
  };
  repository.principals.set(principal.id, principal);
  repository.keys.set(key.id, key);

  const definition = (name: string, version: number) => {
    const found = registry.getDefinition({ name, version });
    if (!found) throw new Error("Fixture definition missing.");
    return found;
  };
  const grant = (
    name: string,
    version: number,
    grantedResources: AgentResourceConstraints,
  ) => ({
    capability: `${name}@${version}`,
    authorizationContractDigest: authorizationContractDigestFor(
      { name, version },
      registry.getRegistration({ name, version })!.authorization,
    ),
    resources: grantedResources,
  });
  const keyScope = (
    name: string,
    version: number,
    grantedResources: AgentResourceConstraints,
  ) => ({
    capability: `${name}@${version}`,
    authorizationContractDigest: authorizationContractDigestFor(
      { name, version },
      registry.getRegistration({ name, version })!.authorization,
    ),
    resources: grantedResources,
  });
  const dispatch = (
    capability: string,
    input: Record<string, unknown>,
    context = securityContext,
  ) =>
    dispatcher.dispatch(
      { capability, input },
      { securityContext: { kind: "agent", ...context } },
    );

  return {
    repository,
    service,
    dispatcher,
    principal,
    key,
    definition,
    grant,
    keyScope,
    dispatch,
    calls: () => ({ publishCalls, auditCalls }),
  };
}

async function installAuthority(
  setup: ReturnType<typeof fixture>,
  input: {
    grants: ReturnType<ReturnType<typeof fixture>["grant"]>[];
    keyScopes?: ReturnType<ReturnType<typeof fixture>["keyScope"]>[];
  },
) {
  setup.key.authorizationScopes =
    input.keyScopes ??
    input.grants.map((grant) => ({
      capability: grant.capability,
      authorizationContractDigest: grant.authorizationContractDigest,
      resources: grant.resources,
    }));
  await setup.service.putWorkspacePolicy({
    workspaceId: "workspace-1",
    enabled: true,
    grants: input.grants,
    actorUserId: "human-1",
  });
  return setup.service.createGrantSet({
    workspaceId: "workspace-1",
    principalId: "principal-1",
    name: "Primary",
    grants: input.grants,
    actorUserId: "human-1",
  });
}

describe("deny-by-default Agent authorization", () => {
  it("normalizes legacy grants that predate artifactIds without rewriting history", () => {
    const [grant] = normalizeCapabilityGrants([
      {
        capability: "content.publish@1",
        authorizationContractDigest: `sha256:${"a".repeat(64)}`,
        resources: {
          channelIds: [],
          credentialProfileIds: [],
          workflowIds: [],
          automationIds: [],
        },
      },
    ]);

    expect(grant.resources.artifactIds).toEqual([]);
  });

  it.each([
    ["missing selector path", "content.broken_selector@1", { channelId: "a" }],
    ["empty selector array", "content.batch_publish@1", { channelIds: [] }],
  ])(
    "forces a durable resource_unavailable denial for %s",
    async (_label, capability, input) => {
      const setup = fixture();
      const response = await setup.dispatch(capability, input);

      expect(response).toMatchObject({
        type: "capability_error",
        code: "CAPABILITY_NOT_AUTHORIZED",
      });
      expect(setup.repository.decisions.at(-1)).toMatchObject({
        outcome: "denied",
        reason: "resource_unavailable",
        resources: [],
      });
      expect(setup.calls().publishCalls).toBe(0);
    },
  );

  it("invalidates old authority when selector semantics change without changing the frozen contract digest", async () => {
    const setup = fixture();
    const original = setup.dispatcher.registry.getRegistration({
      name: "content.publish",
      version: 1,
    })!;
    const changedRegistry = createCapabilityRegistry([
      {
        ...original,
        authorization: {
          resources: [{ kind: "workflow", inputPath: "channelId" }],
        },
      },
    ]);
    const originalDefinition = setup.definition("content.publish", 1);
    const changedDefinition = changedRegistry.getDefinition({
      name: "content.publish",
      version: 1,
    })!;
    const changedAuthorizationDigest = authorizationContractDigestFor(
      { name: "content.publish", version: 1 },
      changedRegistry.getRegistration({
        name: "content.publish",
        version: 1,
      })!.authorization,
    );
    const grant = setup.grant(
      "content.publish",
      1,
      resources(["channel-a"]),
    );
    await installAuthority(setup, { grants: [grant] });
    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-a",
    });

    expect(changedDefinition.contractDigest).toBe(
      originalDefinition.contractDigest,
    );
    expect(changedAuthorizationDigest).not.toBe(
      grant.authorizationContractDigest,
    );
    await expect(
      setup.service.authorize({
        securityContext: { kind: "agent", ...securityContext },
        audience: "agent",
        capability: { name: "content.publish", version: 1 },
        authorizationContractDigest: changedAuthorizationDigest,
        resources: [{ kind: "channel", id: "channel-a" }],
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
  });

  it("denies by default before the handler and persists no prompt or foreign resource ID", async () => {
    const setup = fixture();
    const response = await setup.dispatch("content.publish@1", {
      channelId: "foreign-channel-secret",
      prompt: "private campaign content",
    });

    expect(response).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
    });
    expect(setup.calls().publishCalls).toBe(0);
    expect(setup.repository.decisions).toHaveLength(1);
    expect(setup.repository.securityEvents).toHaveLength(1);
    expect(setup.repository.decisions[0].resources).toEqual([]);
    expect(response.type).toBe("capability_error");
    if (response.type !== "capability_error") return;
    expect(response.operatorTraceRef).toBeNull();
    expect(setup.repository.decisions[0]).toMatchObject({
      outcome: "denied",
      workspaceId: "workspace-1",
      operatorTraceRef: expect.stringMatching(/^otr_[a-f0-9]{32}$/),
    });
    const durable = JSON.stringify({
      decisions: setup.repository.decisions,
      events: setup.repository.securityEvents,
    });
    expect(durable).not.toContain("private campaign content");
    expect(durable).not.toContain("foreign-channel-secret");
  });

  it("intersects exact key, revision, policy, and current resource state", async () => {
    const setup = fixture();
    const grant = setup.grant(
      "content.publish",
      1,
      resources(["channel-a", "channel-b"]),
    );
    await installAuthority(setup, {
      grants: [grant],
      keyScopes: [
        setup.keyScope("content.publish", 1, resources(["channel-a"])),
      ],
    });
    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-a",
    });
    setup.repository.setResourceActive("workspace-2", {
      kind: "channel",
      id: "channel-b",
    });

    expect(
      await setup.dispatch("content.publish@1", { channelId: "channel-a" }),
    ).toMatchObject({ type: "capability_result" });
    expect(setup.repository.decisions.at(-1)).toMatchObject({
      outcome: "allowed",
      grantRevisionId: expect.any(String),
      policyRevisionId: expect.any(String),
    });
    const attenuated = await setup.dispatch("content.publish@1", {
      channelId: "channel-b",
    });
    const foreign = await setup.dispatch("content.publish@1", {
      channelId: "does-not-exist",
    });
    expect(attenuated).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
    expect(foreign).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
      message:
        "Capability content.publish@1 is not authorized. Ask a Workspace owner or admin to grant that exact capability and its required resources.",
    });
    expect((attenuated as { message: string }).message).toBe(
      (foreign as { message: string }).message,
    );
    expect(setup.calls().publishCalls).toBe(1);
  });

  it("makes foreign, missing, and disabled resources indistinguishable after full grant resolution", async () => {
    const setup = fixture();
    const ids = ["foreign-channel", "missing-channel", "disabled-channel"];
    const grant = setup.grant("content.publish", 1, resources(ids));
    await installAuthority(setup, { grants: [grant] });
    setup.repository.setResourceActive("workspace-2", {
      kind: "channel",
      id: "foreign-channel",
    });

    const responses = await Promise.all(
      ids.map((channelId) =>
        setup.dispatch("content.publish@1", { channelId }),
      ),
    );
    const scrub = (response: (typeof responses)[number]) => {
      if (response.type !== "capability_error") return response;
      const { operatorTraceRef: _trace, ...safe } = response;
      return safe;
    };
    expect(responses.map(scrub)).toEqual([
      scrub(responses[0]),
      scrub(responses[0]),
      scrub(responses[0]),
    ]);
    const durable = JSON.stringify({
      decisions: setup.repository.decisions,
      events: setup.repository.securityEvents,
    });
    for (const id of ids) expect(durable).not.toContain(id);
  });

  it("does not bleed resource authority across capabilities or exact versions", async () => {
    const setup = fixture();
    const publishGrant = setup.grant(
      "content.publish",
      1,
      resources(["channel-a"]),
    );
    await installAuthority(setup, { grants: [publishGrant] });
    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-a",
    });

    expect(
      await setup.dispatch("content.publish@1", { channelId: "channel-a" }),
    ).toMatchObject({ type: "capability_result" });
    expect(
      await setup.dispatch("content.publish@2", { channelId: "channel-a" }),
    ).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
    expect(
      await setup.dispatch("content.inspect@1", { channelId: "channel-a" }),
    ).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
    expect(setup.calls().publishCalls).toBe(1);
  });

  it("applies active immutable grant revisions immediately while old keys never gain expansion", async () => {
    const setup = fixture();
    const grantA = setup.grant(
      "content.publish",
      1,
      resources(["channel-a"]),
    );
    const created = await installAuthority(setup, { grants: [grantA] });
    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-a",
    });
    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-b",
    });

    const grantAB = setup.grant(
      "content.publish",
      1,
      resources(["channel-a", "channel-b"]),
    );
    await setup.service.putWorkspacePolicy({
      workspaceId: "workspace-1",
      enabled: true,
      grants: [grantAB],
      actorUserId: "human-1",
    });
    const revisionTwo = await setup.service.reviseGrantSet({
      grantSetId: created.grantSet.id,
      workspaceId: "workspace-1",
      expectedActiveRevision: 1,
      grants: [grantAB],
      actorUserId: "human-1",
    });
    expect(
      await setup.dispatch("content.publish@1", { channelId: "channel-b" }),
    ).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });

    const expandedKey: AgentKeyRecord = {
      ...setup.key,
      id: "key-2",
      lookupPrefix: "lookup-2",
      authorizationScopes: [
        setup.keyScope(
          "content.publish",
          1,
          resources(["channel-a", "channel-b"]),
        ),
      ],
      createdAt: new Date(NOW.getTime() + 1),
    };
    setup.repository.keys.set(expandedKey.id, expandedKey);
    expect(
      await setup.dispatch(
        "content.publish@1",
        { channelId: "channel-b" },
        { ...securityContext, keyId: expandedKey.id },
      ),
    ).toMatchObject({ type: "capability_result" });

    await setup.service.reviseGrantSet({
      grantSetId: created.grantSet.id,
      workspaceId: "workspace-1",
      expectedActiveRevision: 2,
      grants: [grantA],
      actorUserId: "human-1",
    });
    expect(
      await setup.dispatch(
        "content.publish@1",
        { channelId: "channel-b" },
        { ...securityContext, keyId: expandedKey.id },
      ),
    ).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
    expect(setup.repository.grantRevisions.get(created.revision.id)).toEqual(
      created.revision,
    );
    expect(setup.repository.grantRevisions.get(revisionTwo.id)).toEqual(
      revisionTwo,
    );
  });

  it.each(["suspended", "revoked"] as const)(
    "audits %s Principal denial inside admission",
    async (status) => {
      const setup = fixture();
      const grant = setup.grant("content.publish", 1, resources(["channel-a"]));
      await installAuthority(setup, { grants: [grant] });
      setup.repository.setResourceActive("workspace-1", {
        kind: "channel",
        id: "channel-a",
      });
      setup.principal.status = status;
      if (status === "suspended") setup.principal.suspendedAt = NOW;
      else setup.principal.revokedAt = NOW;

      expect(
        await setup.dispatch("content.publish@1", { channelId: "channel-a" }),
      ).toMatchObject({
        type: "capability_error",
        code: "CAPABILITY_NOT_AUTHORIZED",
      });
      expect(setup.repository.decisions.at(-1)).toMatchObject({
        outcome: "denied",
        reason: "principal_inactive",
        resources: [],
      });
      expect(setup.calls().publishCalls).toBe(0);
    },
  );

  it("audits an independently revoked key before the handler", async () => {
    const setup = fixture();
    const grant = setup.grant("content.publish", 1, resources(["channel-a"]));
    await installAuthority(setup, { grants: [grant] });
    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-a",
    });
    setup.key.revokedAt = NOW;

    expect(
      await setup.dispatch("content.publish@1", { channelId: "channel-a" }),
    ).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
    expect(setup.repository.decisions.at(-1)).toMatchObject({
      outcome: "denied",
      reason: "key_inactive",
      resources: [],
    });
    expect(setup.calls().publishCalls).toBe(0);
  });

  it("issues only bounded immutable key authority that is active at issuance", async () => {
    const setup = fixture();
    const grant = setup.grant("content.publish", 1, resources(["channel-a"]));
    await installAuthority(setup, { grants: [grant] });
    setup.repository.addAdministrator("workspace-1", "human-1");
    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-a",
    });
    const candidate = (id: string, channelIds: string[]): AgentKeyRecord => ({
      ...setup.key,
      id,
      lookupPrefix: `lookup-${id}`,
      authorizationScopes: [
        setup.keyScope(
          "content.publish",
          1,
          resources(channelIds),
        ),
      ],
    });

    await expect(
      setup.repository.issueAttenuatedKey({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        actorUserId: "human-1",
        key: candidate("overreach", ["channel-a", "channel-b"]),
        now: NOW,
      }),
    ).resolves.toBe(false);
    await expect(
      setup.repository.issueAttenuatedKey({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        actorUserId: "human-1",
        key: candidate("bounded", ["channel-a"]),
        now: NOW,
      }),
    ).resolves.toBe(true);
    await expect(
      setup.repository.issueAttenuatedKey({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        actorUserId: "human-1",
        key: { ...candidate("empty", []), authorizationScopes: [] },
        now: NOW,
      }),
    ).resolves.toBe(true);
    expect(setup.repository.keys.has("overreach")).toBe(false);
    expect(setup.repository.keys.has("bounded")).toBe(true);
    expect(setup.repository.keys.has("empty")).toBe(true);
    expect(setup.repository.securityEvents.at(-1)).toMatchObject({
      eventType: "key.issued",
      keyId: "empty",
      changeRef: "empty",
    });
  });

  it("provisions grant, policy, and key atomically with no partial failure", async () => {
    const setup = fixture();
    const grant = setup.grant(
      "content.publish",
      1,
      resources(["channel-a"]),
    );
    const provision = () =>
      setup.repository.provisionAuthority({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        actorUserId: "human-1",
        requestId: "request-1",
        requestFingerprint: "sha256:request-one",
        grantSetName: "Primary",
        expectedPolicyRevision: 0,
        grants: [grant],
        policyGrants: [grant],
        key: {
          ...setup.key,
          id: "provisioned-key",
          lookupPrefix: "provisioned-prefix",
          authorizationScopes: [
            setup.keyScope(
              "content.publish",
              1,
              resources(["channel-a"]),
            ),
          ],
        },
        now: NOW,
      });

    await expect(provision()).resolves.toEqual({
      type: "invalid_authority",
    });
    expect(setup.repository.grantSets.size).toBe(0);
    expect(setup.repository.policies.size).toBe(0);
    expect(setup.repository.keys.has("provisioned-key")).toBe(false);
    expect(setup.repository.securityEvents).toHaveLength(0);

    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-a",
    });
    await expect(provision()).resolves.toMatchObject({
      type: "created",
      grantRevision: 1,
      policyRevision: 1,
    });
    expect(setup.repository.grantSets.size).toBe(1);
    expect(setup.repository.policies.size).toBe(1);
    expect(setup.repository.keys.has("provisioned-key")).toBe(true);
    expect(
      setup.repository.securityEvents.map((event) => event.eventType),
    ).toEqual(["grant.revised", "policy.revised", "key.issued"]);
  });

  it("replays a lost successful authority response without issuing a second key", async () => {
    const setup = fixture();
    const grant = setup.grant(
      "content.publish",
      1,
      resources(["channel-a"]),
    );
    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-a",
    });
    const service = new AgentAuthService(
      new InMemoryAgentAuthRepository(),
      { now: () => new Date(NOW) },
      { 1: "test-authority-replay-pepper" },
      1,
      setup.repository,
    );
    const request = {
      workspaceId: "workspace-1",
      principalId: "principal-1",
      actorUserId: "human-1",
      requestId: "lost-response-1",
      grantSetName: "Primary",
      expectedPolicyRevision: 0,
      grants: [grant],
      policyGrants: [grant],
      key: {
        name: "Provisioned",
        authorizationScopes: [
          setup.keyScope(
            "content.publish",
            1,
            resources(["channel-a"]),
          ),
        ],
      },
    };

    const first = await service.provisionAuthority(request);
    const replayService = new AgentAuthService(
      new InMemoryAgentAuthRepository(),
      { now: () => new Date(NOW.getTime() + 1_000) },
      {
        1: "test-authority-replay-pepper",
        2: "rotated-authority-replay-pepper",
      },
      2,
      setup.repository,
    );
    const replay = await replayService.provisionAuthority(request);

    expect(replay.agentKey).toBe(first.agentKey);
    expect(replay.key.id).toBe(first.key.id);
    expect(replay.grantRevisionId).toBe(first.grantRevisionId);
    expect(setup.repository.keys.size).toBe(2);
    expect(setup.repository.securityEvents).toHaveLength(3);
  });

  it("conflicts when a provisioning request ID is reused for different content", async () => {
    const setup = fixture();
    const grant = setup.grant("content.publish", 1, resources([]));
    const service = new AgentAuthService(
      new InMemoryAgentAuthRepository(),
      { now: () => new Date(NOW) },
      { 1: "test-authority-conflict-pepper" },
      1,
      setup.repository,
    );
    const base = {
      workspaceId: "workspace-1",
      principalId: "principal-1",
      actorUserId: "human-1",
      requestId: "reused-request",
      grantSetName: "Primary",
      expectedPolicyRevision: 0,
      grants: [grant],
      policyGrants: [grant],
      key: { name: "First", authorizationScopes: [] },
    };

    await service.provisionAuthority(base);
    await expect(
      service.provisionAuthority({
        ...base,
        key: { ...base.key, name: "Different" },
      }),
    ).rejects.toThrow("Authority revisions changed");
    expect(setup.repository.securityEvents).toHaveLength(3);
  });

  it("serializes concurrent initial policy CAS so only one revision-zero request wins", async () => {
    const setup = fixture();
    const grant = setup.grant("content.publish", 1, resources([]));
    const candidate = (requestId: string, keyId: string) =>
      setup.repository.provisionAuthority({
        workspaceId: "workspace-1",
        principalId: "principal-1",
        actorUserId: "human-1",
        requestId,
        requestFingerprint: `sha256:${requestId}`,
        grantSetName: "Primary",
        expectedPolicyRevision: 0,
        grants: [grant],
        policyGrants: [grant],
        key: {
          ...setup.key,
          id: keyId,
          lookupPrefix: `prefix-${keyId}`,
          authorizationScopes: [],
        },
        now: NOW,
      });

    const results = await Promise.all([
      candidate("initial-a", "initial-key-a"),
      candidate("initial-b", "initial-key-b"),
    ]);

    expect(results.map((result) => result.type).sort()).toEqual([
      "conflict",
      "created",
    ]);
    expect(setup.repository.policies.get("workspace-1")?.revision).toBe(1);
    expect(setup.repository.provisioningReceipts.size).toBe(1);
  });

  it("denies and audits access to authorization decisions unless explicitly granted", async () => {
    const setup = fixture();
    const publishGrant = setup.grant(
      "content.publish",
      1,
      resources(["channel-a"]),
    );
    await installAuthority(setup, { grants: [publishGrant] });

    expect(
      await setup.dispatch("authorization.decisions.list@1", {}),
    ).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
    expect(setup.calls().auditCalls).toBe(0);
    expect(setup.repository.decisions.at(-1)).toMatchObject({
      outcome: "denied",
      reason: "capability_not_granted",
    });
  });

  it("fails closed before the handler when durable admission recording fails", async () => {
    const setup = fixture();
    const grant = setup.grant("content.publish", 1, resources(["channel-a"]));
    await installAuthority(setup, { grants: [grant] });
    setup.repository.setResourceActive("workspace-1", {
      kind: "channel",
      id: "channel-a",
    });
    setup.repository.admit = async () => {
      throw new Error("database unavailable");
    };

    expect(
      await setup.dispatch("content.publish@1", { channelId: "channel-a" }),
    ).toMatchObject({
      type: "capability_error",
      code: "AUTHORIZATION_ADMISSION_UNAVAILABLE",
      retryable: true,
    });
    expect(setup.calls().publishCalls).toBe(0);
  });
});
