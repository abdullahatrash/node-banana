import { describe, expect, it } from "vitest";
import {
  createCredentialHumanRegistrations,
} from "@/lib/credential-vault";
import { CredentialVaultService } from "@/lib/credential-vault/service";
import { InMemoryCredentialVaultRepository } from "@/lib/credential-vault/memory-repository";
import {
  CapabilityDispatcher,
  createCapabilityRegistry,
} from "@/lib/agent-tools";

const cipher = {
  encrypt: (value: string) =>
    `vault:${Buffer.from(value).toString("base64url")}`,
  decrypt: () => {
    throw new Error("not used");
  },
};

function setup() {
  const repository = new InMemoryCredentialVaultRepository();
  repository.addAdministrator("workspace-1", "owner-1");
  const vault = new CredentialVaultService(repository, cipher);
  const registry = createCapabilityRegistry(
    createCredentialHumanRegistrations(vault),
  );
  const dispatcher = new CapabilityDispatcher(registry, {
    authorize: async (request) => ({
      allowed:
        request.audience === "human" &&
        request.securityContext.kind === "human" &&
        (request.securityContext.role === "owner" ||
          request.securityContext.role === "admin"),
    }),
  });
  return { repository, registry, dispatcher };
}

const humanContext = {
  workspaceId: "workspace-1",
  userId: "owner-1",
  role: "owner" as const,
};

describe("human Credential capabilities in the canonical dispatcher", () => {
  it("publishes the complete exact human-only management surface", () => {
    const { registry } = setup();
    expect(
      registry
        .listDefinitions()
        .map((definition) => ({
          identity: `${definition.identity.name}@${definition.identity.version}`,
          audience: definition.audience,
        })),
    ).toEqual([
      { identity: "credentials.audit.export@1", audience: "human" },
      { identity: "credentials.audit.list@1", audience: "human" },
      { identity: "credentials.profiles.create@1", audience: "human" },
      { identity: "credentials.profiles.list@1", audience: "human" },
      { identity: "credentials.profiles.reprovision@1", audience: "human" },
      { identity: "credentials.profiles.rotate@1", audience: "human" },
      { identity: "credentials.profiles.status.set@1", audience: "human" },
      { identity: "credentials.spend_grants.create@1", audience: "human" },
      { identity: "credentials.spend_grants.list@1", audience: "human" },
      { identity: "credentials.spend_grants.revoke@1", audience: "human" },
      { identity: "credentials.versions.revoke@1", audience: "human" },
    ]);
  });

  it("publishes exact idempotency and error contracts per operation", () => {
    const { registry } = setup();
    const definitions = Object.fromEntries(
      registry.listDefinitions().map((definition) => [
        `${definition.identity.name}@${definition.identity.version}`,
        {
          idempotency: definition.idempotency.mode,
          errors: definition.errors.map((error) => error.code),
        },
      ]),
    );
    const universal = [
      "HUMAN_CAPABILITY_NOT_AUTHORIZED",
      "CAPABILITY_NOT_AUTHORIZED",
      "VALIDATION_FAILED",
      "AUTHORIZATION_ADMISSION_UNAVAILABLE",
      "INTERNAL_ERROR",
    ];
    expect(definitions).toEqual({
      "credentials.audit.export@1": {
        idempotency: "retry-safe",
        errors: [...universal, "INVALID_INPUT"],
      },
      "credentials.audit.list@1": {
        idempotency: "retry-safe",
        errors: [...universal, "INVALID_INPUT"],
      },
      "credentials.profiles.create@1": {
        idempotency: "key-required",
        errors: [
          ...universal,
          "IDEMPOTENCY_KEY_REQUIRED",
          "INVALID_INPUT",
          "CONFLICT",
          "FORBIDDEN",
        ],
      },
      "credentials.profiles.list@1": {
        idempotency: "retry-safe",
        errors: universal,
      },
      "credentials.profiles.reprovision@1": {
        idempotency: "key-required",
        errors: [
          ...universal,
          "IDEMPOTENCY_KEY_REQUIRED",
          "INVALID_INPUT",
          "CONFLICT",
        ],
      },
      "credentials.profiles.rotate@1": {
        idempotency: "key-required",
        errors: [
          ...universal,
          "IDEMPOTENCY_KEY_REQUIRED",
          "INVALID_INPUT",
          "CONFLICT",
        ],
      },
      "credentials.profiles.status.set@1": {
        idempotency: "intrinsic",
        errors: [...universal, "FORBIDDEN", "CONFLICT"],
      },
      "credentials.spend_grants.create@1": {
        idempotency: "key-required",
        errors: [
          ...universal,
          "IDEMPOTENCY_KEY_REQUIRED",
          "INVALID_INPUT",
          "CONFLICT",
          "FORBIDDEN",
        ],
      },
      "credentials.spend_grants.list@1": {
        idempotency: "retry-safe",
        errors: universal,
      },
      "credentials.spend_grants.revoke@1": {
        idempotency: "intrinsic",
        errors: [...universal, "FORBIDDEN"],
      },
      "credentials.versions.revoke@1": {
        idempotency: "intrinsic",
        errors: [...universal, "CONFLICT"],
      },
    });
  });

  it("uses one redacted dispatcher path for handoff and listing", async () => {
    const { dispatcher } = setup();
    const secret = "private-provider-key";
    const profile = await dispatcher.dispatch(
      {
        capability: "credentials.profiles.create@1",
        input: {
          name: "Production",
          provider: "openai",
          slotName: "primary",
          secret,
        },
      },
      {
        securityContext: {
          kind: "human",
          ...humanContext,
          idempotencyKey: "application-profile-create",
        },
      },
    );
    const profiles = await dispatcher.dispatch(
      { capability: "credentials.profiles.list@1", input: {} },
      { securityContext: { kind: "human", ...humanContext } },
    );
    expect(profile.type).toBe("capability_result");
    expect(profiles.type).toBe("capability_result");
    expect(JSON.stringify({ profile, profiles })).not.toContain(secret);
    expect(JSON.stringify({ profile, profiles })).not.toContain(
      "secretCiphertext",
    );
  });

  it("denies agents and members through the canonical audience gate", async () => {
    const { dispatcher, repository } = setup();
    const member = await dispatcher.dispatch(
      {
        capability: "credentials.profiles.create@1",
        input: {
          name: "Denied",
          provider: "openai",
          slotName: "primary",
          secret: "private-provider-key",
        },
      },
      {
        securityContext: {
          kind: "human",
          ...humanContext,
          role: "member",
        },
      },
    );
    expect(member).toMatchObject({
      type: "capability_error",
      code: "CAPABILITY_NOT_AUTHORIZED",
    });
    expect(repository.versions.size).toBe(0);
  });
});
