import {
  AGENT_CURRENT_GET_IDENTITY,
  CapabilityDispatcher,
  authorizationContractDigestFor,
} from "@/lib/agent-tools";
import { PRODUCTION_CAPABILITY_REGISTRY as CAPABILITY_REGISTRY } from "@/lib/agent-runtime/server-dispatcher";
import {
  AgentAuthorizationService,
  EMPTY_RESOURCE_CONSTRAINTS,
  InMemoryAgentAuthorizationRepository,
} from "@/lib/agent-authorization";
import {
  AgentAuthError,
  AgentAuthService,
  InMemoryAgentAuthRepository,
  createAgentAuthenticatedDispatcher,
  loadAgentKeyPepperConfig,
} from "@/lib/agent-auth";
import { parseOpaqueCredential } from "@/lib/agent-auth/crypto";

class TestClock {
  constructor(private value: Date) {}
  now = () => new Date(this.value);
  advance(ms: number) {
    this.value = new Date(this.value.getTime() + ms);
  }
}

function fixture() {
  const repository = new InMemoryAgentAuthRepository();
  const clock = new TestClock(new Date("2026-07-24T12:00:00.000Z"));
  let issuanceCalls = 0;
  const service = new AgentAuthService(
    repository,
    clock,
    { 1: "test-agent-pepper-that-is-not-a-better-auth-secret" },
    1,
    {
      issueAttenuatedKey: async ({ key }) => {
        issuanceCalls += 1;
        await repository.createKey(key);
        return true;
      },
      provisionAuthority: async () => ({ type: "invalid_authority" }),
    },
  );
  repository.addMembership("workspace-1", "human-1", "owner");
  return { repository, clock, service, issuanceCalls: () => issuanceCalls };
}

async function pairAgent(
  setup: ReturnType<typeof fixture>,
  keyExpiresAt?: Date,
) {
  const created = await setup.service.createPairingChallenge({
    agentName: "Local Publisher",
    keyName: "Laptop",
    requestedAccess: ["content.read", "content.publish"],
  });
  await setup.service.approvePairingConfirmation({
    confirmationId: created.confirmationId,
    workspaceId: "workspace-1",
    sponsorUserId: "human-1",
  });
  const redeemed = await setup.service.redeemPairing({
    challenge: created.challenge,
    keyExpiresAt,
  });
  return { created, redeemed };
}

async function dispatchIdentity(
  setup: ReturnType<typeof fixture>,
  agentKey: string,
) {
  const lookupPrefix = parseOpaqueCredential(agentKey, "key")?.lookupPrefix;
  const key = [...setup.repository.keys.values()].find(
    (candidate) => candidate.lookupPrefix === lookupPrefix,
  );
  const principal = key
    ? setup.repository.principals.get(key.principalId)
    : undefined;
  const authorizationRepository =
    new InMemoryAgentAuthorizationRepository();
  const authorizationService = new AgentAuthorizationService(
    authorizationRepository,
    setup.clock,
  );
  authorizationRepository.addAdministrator(
    principal?.workspaceId ?? "workspace-1",
    "human-1",
  );
  if (key && principal) {
    authorizationRepository.keys.set(key.id, key);
    authorizationRepository.principals.set(principal.id, principal);
    key.authorizationScopes = [
      {
        capability: "agents.current.get@1",
        authorizationContractDigest: authorizationContractDigestFor(
          AGENT_CURRENT_GET_IDENTITY,
          CAPABILITY_REGISTRY.getRegistration(AGENT_CURRENT_GET_IDENTITY)!
            .authorization,
        ),
        resources: EMPTY_RESOURCE_CONSTRAINTS,
      },
    ];
    const definition = CAPABILITY_REGISTRY.getDefinition(
      AGENT_CURRENT_GET_IDENTITY,
    );
    if (!definition) throw new Error("Agent identity capability is missing.");
    const grants = [
      {
        capability: "agents.current.get@1",
        authorizationContractDigest: authorizationContractDigestFor(
          AGENT_CURRENT_GET_IDENTITY,
          CAPABILITY_REGISTRY.getRegistration(AGENT_CURRENT_GET_IDENTITY)!
            .authorization,
        ),
        resources: EMPTY_RESOURCE_CONSTRAINTS,
      },
    ];
    await authorizationService.putWorkspacePolicy({
      workspaceId: principal.workspaceId,
      enabled: true,
      grants,
      actorUserId: "human-1",
    });
    await authorizationService.createGrantSet({
      workspaceId: principal.workspaceId,
      principalId: principal.id,
      name: "Agent identity test",
      grants,
      actorUserId: "human-1",
    });
  }
  const dispatcher = createAgentAuthenticatedDispatcher({
    agentKey,
    service: setup.service,
    dispatcher: new CapabilityDispatcher(
      CAPABILITY_REGISTRY,
      authorizationService,
    ),
  });
  return dispatcher.dispatch({
    capability: AGENT_CURRENT_GET_IDENTITY,
    input: {},
  });
}

describe("Workspace Agent pairing and authentication", () => {
  it("requires a dedicated pepper when credentials are used in production-like environments", async () => {
    const previousAppEnv = process.env.APP_ENV;
    const previousPepper = process.env.AGENT_KEY_PEPPER;
    const previousPeppers = process.env.AGENT_KEY_PEPPERS;
    const previousActiveVersion =
      process.env.AGENT_KEY_PEPPER_ACTIVE_VERSION;
    process.env.APP_ENV = "staging";
    delete process.env.AGENT_KEY_PEPPER;
    delete process.env.AGENT_KEY_PEPPERS;
    delete process.env.AGENT_KEY_PEPPER_ACTIVE_VERSION;
    try {
      const service = new AgentAuthService(new InMemoryAgentAuthRepository());
      await expect(
        service.createPairingChallenge({
          agentName: "Build-safe agent",
          requestedAccess: ["capabilities.list@1"],
        }),
      ).rejects.toThrow(
        "AGENT_KEY_PEPPER or AGENT_KEY_PEPPERS must be set in production.",
      );
    } finally {
      if (previousAppEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previousAppEnv;
      if (previousPepper === undefined) delete process.env.AGENT_KEY_PEPPER;
      else process.env.AGENT_KEY_PEPPER = previousPepper;
      if (previousPeppers === undefined) delete process.env.AGENT_KEY_PEPPERS;
      else process.env.AGENT_KEY_PEPPERS = previousPeppers;
      if (previousActiveVersion === undefined) {
        delete process.env.AGENT_KEY_PEPPER_ACTIVE_VERSION;
      } else {
        process.env.AGENT_KEY_PEPPER_ACTIVE_VERSION = previousActiveVersion;
      }
    }
  });

  it("loads legacy AGENT_KEY_PEPPER as version 1", () => {
    expect(
      loadAgentKeyPepperConfig(
        { AGENT_KEY_PEPPER: "legacy-pepper-value" },
        true,
      ),
    ).toEqual({
      peppers: { 1: "legacy-pepper-value" },
      activeVersion: 1,
    });
  });

  it("loads a retained v1 plus active v2 production keyring", () => {
    const v1 = "a".repeat(43);
    const v2 = "b".repeat(43);

    expect(
      loadAgentKeyPepperConfig(
        {
          AGENT_KEY_PEPPERS: `1=${v1},2=${v2}`,
          AGENT_KEY_PEPPER_ACTIVE_VERSION: "2",
        },
        true,
      ),
    ).toEqual({
      peppers: { 1: v1, 2: v2 },
      activeVersion: 2,
    });
  });

  it("accepts the maximum positive PostgreSQL integer pepper version", () => {
    const pepper = "m".repeat(43);

    expect(
      loadAgentKeyPepperConfig(
        {
          AGENT_KEY_PEPPERS: `2147483647=${pepper}`,
          AGENT_KEY_PEPPER_ACTIVE_VERSION: "2147483647",
        },
        true,
      ),
    ).toEqual({
      peppers: { 2147483647: pepper },
      activeVersion: 2147483647,
    });
  });

  it.each([
    [
      "entry overflow",
      {
        AGENT_KEY_PEPPERS: `2147483648=${"a".repeat(43)}`,
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "2147483647",
      },
    ],
    [
      "active overflow",
      {
        AGENT_KEY_PEPPERS: `2147483647=${"a".repeat(43)}`,
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "2147483648",
      },
    ],
    [
      "unsafe entry integer",
      {
        AGENT_KEY_PEPPERS: `9007199254740992=${"a".repeat(43)}`,
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "1",
      },
    ],
    [
      "zero active version",
      {
        AGENT_KEY_PEPPERS: `1=${"a".repeat(43)}`,
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "0",
      },
    ],
    [
      "negative entry version",
      {
        AGENT_KEY_PEPPERS: `-1=${"a".repeat(43)}`,
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "1",
      },
    ],
    [
      "infinite active version",
      {
        AGENT_KEY_PEPPERS: `1=${"a".repeat(43)}`,
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "Infinity",
      },
    ],
  ])("rejects non-PostgreSQL pepper versions: %s", (_label, env) => {
    expect(() => loadAgentKeyPepperConfig(env, true)).toThrow(
      "positive PostgreSQL integer",
    );
  });

  it("verifies an existing v1 Agent key after production activates v2", async () => {
    const repository = new InMemoryAgentAuthRepository();
    const clock = new TestClock(new Date("2026-07-24T12:00:00.000Z"));
    repository.addMembership("workspace-1", "human-1", "owner");
    const v1 = "c".repeat(43);
    const v2 = "d".repeat(43);
    const legacy = loadAgentKeyPepperConfig(
      { AGENT_KEY_PEPPER: v1 },
      true,
    );
    const originalService = new AgentAuthService(
      repository,
      clock,
      legacy.peppers,
      legacy.activeVersion,
    );
    const created = await originalService.createPairingChallenge({
      agentName: "Rotating Agent",
      requestedAccess: ["content.read"],
    });
    await originalService.approvePairingConfirmation({
      confirmationId: created.confirmationId,
      workspaceId: "workspace-1",
      sponsorUserId: "human-1",
    });
    const redeemed = await originalService.redeemPairing({
      challenge: created.challenge,
    });
    const rotated = loadAgentKeyPepperConfig(
      {
        AGENT_KEY_PEPPERS: `1=${v1},2=${v2}`,
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "2",
      },
      true,
    );
    const rotatedService = new AgentAuthService(
      repository,
      clock,
      rotated.peppers,
      rotated.activeVersion,
    );

    await expect(
      rotatedService.resolveAgentKeyForAdmission(redeemed.agentKey),
    ).resolves.toMatchObject({
      principalId: redeemed.principal.id,
      keyId: redeemed.key.id,
    });
  });

  it.each([
    [
      "duplicate version",
      {
        AGENT_KEY_PEPPERS: `1=${"a".repeat(43)},1=${"b".repeat(43)}`,
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "1",
      },
    ],
    [
      "missing active version",
      { AGENT_KEY_PEPPERS: `1=${"a".repeat(43)}` },
    ],
    [
      "active version absent from keyring",
      {
        AGENT_KEY_PEPPERS: `1=${"a".repeat(43)}`,
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "2",
      },
    ],
    [
      "malformed pepper",
      {
        AGENT_KEY_PEPPERS: "1=too-short",
        AGENT_KEY_PEPPER_ACTIVE_VERSION: "1",
      },
    ],
  ])("rejects malformed production pepper config: %s", (_label, env) => {
    expect(() => loadAgentKeyPepperConfig(env, true)).toThrow();
  });

  it("approves then atomically redeems a single-use challenge without retaining plaintext", async () => {
    const setup = fixture();
    const { created, redeemed } = await pairAgent(setup);

    expect(created.challenge).toMatch(/^nbpc_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
    expect(redeemed.agentKey).toMatch(
      /^nbak_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/,
    );
    const storedChallenge = [...setup.repository.challenges.values()][0];
    const storedKey = [...setup.repository.keys.values()][0];
    expect(storedChallenge.secretHash).not.toContain(created.challenge);
    expect(storedChallenge.pepperVersion).toBe(1);
    expect(storedChallenge.consumedAt).toEqual(setup.clock.now());
    expect(storedKey.secretHash).not.toContain(redeemed.agentKey);
    expect(storedKey.pepperVersion).toBe(1);
    expect(JSON.stringify([...setup.repository.keys.values()])).not.toContain(
      redeemed.agentKey,
    );

    await expect(
      setup.service.redeemPairing({ challenge: created.challenge }),
    ).rejects.toMatchObject({ code: "PAIRING_CHALLENGE_REPLAYED" });

    const response = await dispatchIdentity(setup, redeemed.agentKey);
    expect(response).toMatchObject({
      type: "capability_result",
      output: {
        principalId: redeemed.principal.id,
        workspaceId: "workspace-1",
        keyId: redeemed.key.id,
        access: [],
      },
    });
    expect(storedKey.lastUsedAt).toEqual(setup.clock.now());
  });

  it("allows only one concurrent redemption", async () => {
    const setup = fixture();
    const created = await setup.service.createPairingChallenge({
      agentName: "Concurrent Agent",
      requestedAccess: ["content.read"],
    });
    await setup.service.approvePairing({
      challenge: created.challenge,
      workspaceId: "workspace-1",
      sponsorUserId: "human-1",
    });

    const results = await Promise.allSettled([
      setup.service.redeemPairing({ challenge: created.challenge }),
      setup.service.redeemPairing({ challenge: created.challenge }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    expect(setup.repository.principals.size).toBe(1);
    expect(setup.repository.keys.size).toBe(1);
  });

  it("supports overlapping rotation and independent key revocation", async () => {
    const setup = fixture();
    const { redeemed } = await pairAgent(setup);
    const rotated = await setup.service.rotateKey({
      principalId: redeemed.principal.id,
      workspaceId: "workspace-1",
      actorUserId: "human-1",
      name: "CI replacement",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(setup.issuanceCalls()).toBe(1);

    expect((await dispatchIdentity(setup, redeemed.agentKey)).type).toBe(
      "capability_result",
    );
    expect((await dispatchIdentity(setup, rotated.agentKey)).type).toBe(
      "capability_result",
    );

    await setup.service.revokeKey({
      keyId: redeemed.key.id,
      workspaceId: "workspace-1",
      actorUserId: "human-1",
    });
    expect(await dispatchIdentity(setup, redeemed.agentKey)).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
    });
    expect((await dispatchIdentity(setup, rotated.agentKey)).type).toBe(
      "capability_result",
    );
  });

  it("binds management actions to the selected active Workspace", async () => {
    const setup = fixture();
    const { redeemed } = await pairAgent(setup);
    setup.repository.addMembership("workspace-2", "human-1", "owner");

    await expect(
      setup.service.rotateKey({
        principalId: redeemed.principal.id,
        workspaceId: "workspace-2",
        actorUserId: "human-1",
        name: "Wrong Workspace",
      }),
    ).rejects.toMatchObject({ code: "AGENT_PRINCIPAL_NOT_FOUND" });

    setup.repository.inactiveWorkspaces.add("workspace-1");
    await expect(
      setup.service.listPrincipals("workspace-1", "human-1"),
    ).rejects.toMatchObject({ code: "PAIRING_SPONSOR_FORBIDDEN" });
    await expect(
      setup.service.revokeKey({
        keyId: redeemed.key.id,
        workspaceId: "workspace-1",
        actorUserId: "human-1",
      }),
    ).rejects.toMatchObject({ code: "AGENT_KEY_NOT_FOUND" });
  });

  it.each([
    {
      label: "principal suspension",
      mutate: async (
        setup: ReturnType<typeof fixture>,
        principalId: string,
      ) =>
        setup.service.setPrincipalStatus({
          principalId,
          workspaceId: "workspace-1",
          actorUserId: "human-1",
          status: "suspended",
        }),
      code: "CAPABILITY_NOT_AUTHORIZED",
    },
    {
      label: "principal revocation",
      mutate: async (
        setup: ReturnType<typeof fixture>,
        principalId: string,
      ) =>
        setup.service.setPrincipalStatus({
          principalId,
          workspaceId: "workspace-1",
          actorUserId: "human-1",
          status: "revoked",
        }),
      code: "CAPABILITY_NOT_AUTHORIZED",
    },
    {
      label: "sponsor loss or downgrade",
      mutate: async (setup: ReturnType<typeof fixture>) => {
        setup.repository.addMembership("workspace-1", "human-1", "member");
      },
      code: "CAPABILITY_NOT_AUTHORIZED",
    },
  ])("denies capability dispatch after $label", async ({ mutate, code }) => {
    const setup = fixture();
    const { redeemed } = await pairAgent(setup);
    await mutate(setup, redeemed.principal.id);
    expect(await dispatchIdentity(setup, redeemed.agentKey)).toMatchObject({
      type: "capability_error",
      code,
      category: "authorization",
    });
  });

  it("does not let a stale status update undo concurrent revocation", async () => {
    const setup = fixture();
    const { redeemed } = await pairAgent(setup);
    const updateStatus =
      setup.repository.updatePrincipalStatus.bind(setup.repository);
    setup.repository.updatePrincipalStatus = async (input) => {
      const principal = setup.repository.principals.get(input.principalId);
      if (principal) {
        principal.status = "revoked";
        principal.revokedAt = setup.clock.now();
      }
      return updateStatus(input);
    };

    await expect(
      setup.service.setPrincipalStatus({
        principalId: redeemed.principal.id,
        workspaceId: "workspace-1",
        actorUserId: "human-1",
        status: "active",
      }),
    ).rejects.toMatchObject({ code: "AGENT_PRINCIPAL_REVOKED" });
    expect(
      setup.repository.principals.get(redeemed.principal.id)?.status,
    ).toBe("revoked");
  });

  it("uses a uniform capability auth failure for missing, malformed, expired, and revoked keys", async () => {
    const setup = fixture();
    const { redeemed } = await pairAgent(
      setup,
      new Date("2026-07-24T12:01:00.000Z"),
    );
    setup.clock.advance(61_000);

    const responses: Array<Awaited<ReturnType<typeof dispatchIdentity>>> = [];
    for (const key of [undefined, "bad-key", redeemed.agentKey]) {
      const response = await dispatchIdentity(setup, key ?? "");
      expect(response).toMatchObject({
        type: "capability_error",
        code: "CAPABILITY_NOT_AUTHORIZED",
        category: "authorization",
        message:
          "Capability agents.current.get@1 is not authorized. Ask a Workspace owner or admin to grant that exact capability and its required resources.",
        retryable: false,
        operatorTraceRef: null,
      });
      expect(JSON.stringify(response)).not.toMatch(/otr_[a-f0-9]{32}/);
      responses.push(response);
    }
    const withoutDigest = (response: (typeof responses)[number]) => {
      const { requestDigest: _requestDigest, ...stable } = response;
      return stable;
    };
    expect(withoutDigest(responses[1])).toEqual(withoutDigest(responses[0]));
    expect(withoutDigest(responses[2])).toEqual(withoutDigest(responses[0]));
  });

  it("rejects expired and replayed challenges and refuses member-only sponsors", async () => {
    const setup = fixture();
    setup.repository.addMembership("workspace-2", "human-2", "member");
    const expired = await setup.service.createPairingChallenge({
      agentName: "Expired",
      requestedAccess: ["content.read"],
      ttlMs: 30_000,
    });
    setup.clock.advance(31_000);
    await expect(
      setup.service.inspectPairingChallenge(expired.challenge),
    ).rejects.toMatchObject({ code: "PAIRING_CHALLENGE_EXPIRED" });

    const forbidden = await setup.service.createPairingChallenge({
      agentName: "Unsponsored",
      requestedAccess: ["content.read"],
    });
    await expect(
      setup.service.approvePairing({
        challenge: forbidden.challenge,
        workspaceId: "workspace-2",
        sponsorUserId: "human-2",
      }),
    ).rejects.toMatchObject({ code: "PAIRING_SPONSOR_FORBIDDEN" });
  });

  it("reports expiry when an approved challenge expires during redemption", async () => {
    const setup = fixture();
    const created = await setup.service.createPairingChallenge({
      agentName: "Expiry Race",
      requestedAccess: ["content.read"],
      ttlMs: 30_000,
    });
    await setup.service.approvePairing({
      challenge: created.challenge,
      workspaceId: "workspace-1",
      sponsorUserId: "human-1",
    });
    const completePairing =
      setup.repository.completePairing.bind(setup.repository);
    setup.repository.completePairing = async (input) => {
      setup.clock.advance(31_000);
      return completePairing({ ...input, now: setup.clock.now() });
    };

    await expect(
      setup.service.redeemPairing({ challenge: created.challenge }),
    ).rejects.toMatchObject({ code: "PAIRING_CHALLENGE_EXPIRED" });
  });

  it("durably limits challenge creation per fingerprint without storing the raw client key", async () => {
    const setup = fixture();
    const clientRateLimitKey = "ip:203.0.113.44";
    for (let index = 0; index < 6; index += 1) {
      await setup.service.createPairingChallenge({
        agentName: `Agent ${index}`,
        requestedAccess: ["content.read"],
        clientRateLimitKey,
      });
    }

    await expect(
      setup.service.createPairingChallenge({
        agentName: "One too many",
        requestedAccess: ["content.read"],
        clientRateLimitKey,
      }),
    ).rejects.toMatchObject({
      code: "PAIRING_RATE_LIMITED",
      retryAfterMs: 10 * 60 * 1000,
    });
    expect([...setup.repository.rateLimits.keys()].join(" ")).not.toContain(
      "203.0.113.44",
    );
    await expect(
      setup.service.createPairingChallenge({
        agentName: "Different client",
        requestedAccess: ["content.read"],
        clientRateLimitKey: "ip:203.0.113.45",
      }),
    ).resolves.toMatchObject({ challenge: expect.any(String) });
  });

  it("limits redemption independently and resets the fixed window", async () => {
    const setup = fixture();
    const input = {
      challenge: "not-a-valid-challenge",
      clientRateLimitKey: "ip:198.51.100.9",
    };
    for (let index = 0; index < 20; index += 1) {
      await expect(setup.service.redeemPairing(input)).rejects.toMatchObject({
        code: "PAIRING_CHALLENGE_INVALID",
      });
    }
    await expect(setup.service.redeemPairing(input)).rejects.toMatchObject({
      code: "PAIRING_RATE_LIMITED",
    });

    setup.clock.advance(10 * 60 * 1000);
    await expect(setup.service.redeemPairing(input)).rejects.toMatchObject({
      code: "PAIRING_CHALLENGE_INVALID",
    });
  });

  it("opportunistically removes expired challenges and stale client buckets", async () => {
    const setup = fixture();
    await setup.service.createPairingChallenge({
      agentName: "Old Agent",
      requestedAccess: ["content.read"],
      ttlMs: 30_000,
      clientRateLimitKey: "ip:192.0.2.1",
    });
    expect(setup.repository.challenges.size).toBe(1);
    expect(setup.repository.rateLimits.size).toBe(1);

    setup.clock.advance(25 * 60 * 60 * 1000);
    await setup.service.createPairingChallenge({
      agentName: "Cleanup trigger",
      requestedAccess: ["content.read"],
      clientRateLimitKey: "ip:192.0.2.2",
    });

    expect(setup.repository.challenges.size).toBe(1);
    expect(
      [...setup.repository.rateLimits.keys()].some((key) =>
        key.endsWith(":challenge_create"),
      ),
    ).toBe(true);
    expect(setup.repository.rateLimits.size).toBe(1);
  });
});
