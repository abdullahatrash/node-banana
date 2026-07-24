import {
  AGENT_CURRENT_GET_IDENTITY,
  CAPABILITY_DISPATCHER,
} from "@/lib/agent-tools";
import {
  AgentAuthError,
  AgentAuthService,
  InMemoryAgentAuthRepository,
  createAgentAuthenticatedDispatcher,
} from "@/lib/agent-auth";

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
  const service = new AgentAuthService(
    repository,
    clock,
    { 1: "test-agent-pepper-that-is-not-a-better-auth-secret" },
    1,
  );
  repository.addMembership("workspace-1", "human-1", "owner");
  return { repository, clock, service };
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
  await setup.service.approvePairing({
    challenge: created.challenge,
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
  const dispatcher = createAgentAuthenticatedDispatcher({
    agentKey,
    service: setup.service,
    dispatcher: CAPABILITY_DISPATCHER,
  });
  return dispatcher.dispatch({
    capability: AGENT_CURRENT_GET_IDENTITY,
    input: {},
  });
}

describe("Workspace Agent pairing and authentication", () => {
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
        access: ["content.read", "content.publish"],
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
      actorUserId: "human-1",
      name: "CI replacement",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect((await dispatchIdentity(setup, redeemed.agentKey)).type).toBe(
      "capability_result",
    );
    expect((await dispatchIdentity(setup, rotated.agentKey)).type).toBe(
      "capability_result",
    );

    await setup.service.revokeKey({
      keyId: redeemed.key.id,
      actorUserId: "human-1",
    });
    expect(await dispatchIdentity(setup, redeemed.agentKey)).toMatchObject({
      type: "capability_error",
      code: "AGENT_AUTHENTICATION_FAILED",
      category: "authorization",
    });
    expect((await dispatchIdentity(setup, rotated.agentKey)).type).toBe(
      "capability_result",
    );
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
          actorUserId: "human-1",
          status: "suspended",
        }),
      code: "AGENT_PRINCIPAL_SUSPENDED",
    },
    {
      label: "principal revocation",
      mutate: async (
        setup: ReturnType<typeof fixture>,
        principalId: string,
      ) =>
        setup.service.setPrincipalStatus({
          principalId,
          actorUserId: "human-1",
          status: "revoked",
        }),
      code: "AGENT_PRINCIPAL_REVOKED",
    },
    {
      label: "sponsor loss or downgrade",
      mutate: async (setup: ReturnType<typeof fixture>) => {
        setup.repository.addMembership("workspace-1", "human-1", "member");
      },
      code: "AGENT_SPONSOR_LOST",
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

  it("uses a uniform capability auth failure for missing, malformed, expired, and revoked keys", async () => {
    const setup = fixture();
    const { redeemed } = await pairAgent(
      setup,
      new Date("2026-07-24T12:01:00.000Z"),
    );
    setup.clock.advance(61_000);

    for (const key of [undefined, "bad-key", redeemed.agentKey]) {
      const response = await dispatchIdentity(setup, key ?? "");
      expect(response).toMatchObject({
        type: "capability_error",
        code: "AGENT_AUTHENTICATION_FAILED",
      });
    }
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
});
