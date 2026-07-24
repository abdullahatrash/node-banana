import { z } from "zod";
import { CREDENTIAL_SLOT_PROVIDERS } from "@/types";
import type {
  CapabilityErrorContract,
  CapabilityEffect,
  CapabilityRegistration,
} from "@/types/capabilities";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import type { CredentialVaultService } from "./service";
import type {
  CredentialAuditEvent,
  CredentialSpendGrant,
  SafeCredentialProfile,
} from "@/types/credentials";

export const CREDENTIAL_HUMAN_IDENTITIES = {
  list: { name: "credentials.profiles.list", version: 1 },
  create: { name: "credentials.profiles.create", version: 1 },
  reprovision: { name: "credentials.profiles.reprovision", version: 1 },
  rotate: { name: "credentials.profiles.rotate", version: 1 },
  status: { name: "credentials.profiles.status.set", version: 1 },
  versionRevoke: { name: "credentials.versions.revoke", version: 1 },
  grantsList: { name: "credentials.spend_grants.list", version: 1 },
  grantsCreate: { name: "credentials.spend_grants.create", version: 1 },
  grantsRevoke: { name: "credentials.spend_grants.revoke", version: 1 },
  auditList: { name: "credentials.audit.list", version: 1 },
  auditExport: { name: "credentials.audit.export", version: 1 },
} as const;

export type CredentialHumanCapabilityIdentity =
  | "credentials.profiles.list@1"
  | "credentials.profiles.create@1"
  | "credentials.profiles.reprovision@1"
  | "credentials.profiles.rotate@1"
  | "credentials.profiles.status.set@1"
  | "credentials.versions.revoke@1"
  | "credentials.spend_grants.list@1"
  | "credentials.spend_grants.create@1"
  | "credentials.spend_grants.revoke@1"
  | "credentials.audit.list@1"
  | "credentials.audit.export@1";

const lifecycle = {
  status: "active",
  introducedAt: "2026-07-24T00:00:00.000Z",
  recommended: true,
} as const;
const mutation = {
  mutation: "runtime-state",
  visibility: "private",
  timing: "immediate",
  reversibility: "conditional",
  maySpendProviderBudget: false,
} as const;
const query: CapabilityEffect = {
  mutation: "none",
  visibility: "private",
  timing: "immediate",
  reversibility: "reversible",
  maySpendProviderBudget: false,
};
const errorCatalog = {
  HUMAN_CAPABILITY_NOT_AUTHORIZED: {
    code: "HUMAN_CAPABILITY_NOT_AUTHORIZED",
    category: "authorization",
    retryable: false,
    description: "An authenticated Workspace owner or admin is required.",
  },
  CAPABILITY_NOT_AUTHORIZED: {
    code: "CAPABILITY_NOT_AUTHORIZED",
    category: "authorization",
    retryable: false,
    description: "The resolved human Security Context was denied by admission policy.",
  },
  VALIDATION_FAILED: {
    code: "VALIDATION_FAILED",
    category: "validation",
    retryable: false,
    description: "Input is invalid.",
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    code: "IDEMPOTENCY_KEY_REQUIRED",
    category: "validation",
    retryable: false,
    description:
      "A valid Idempotency-Key transport header is required for this mutation.",
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    category: "authorization",
    retryable: false,
    description: "The authenticated manager is not authorized for this Workspace operation.",
  },
  CONFLICT: {
    code: "CONFLICT",
    category: "conflict",
    retryable: false,
    description: "The requested mutation conflicts with current Credential state.",
  },
  INVALID_INPUT: {
    code: "INVALID_INPUT",
    category: "validation",
    retryable: false,
    description: "The domain input violates a Credential invariant.",
  },
  AUTHORIZATION_ADMISSION_UNAVAILABLE: {
    code: "AUTHORIZATION_ADMISSION_UNAVAILABLE",
    category: "internal",
    retryable: true,
    description: "Durable authorization admission could not be recorded.",
  },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    category: "internal",
    retryable: false,
    description: "The capability failed without exposing internal diagnostics.",
  },
} as const satisfies Record<string, CapabilityErrorContract>;

type DomainErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INVALID_INPUT";

const universalHumanErrorCodes = [
  "HUMAN_CAPABILITY_NOT_AUTHORIZED",
  "CAPABILITY_NOT_AUTHORIZED",
  "VALIDATION_FAILED",
  "AUTHORIZATION_ADMISSION_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

function humanErrors(
  ...domainCodes: DomainErrorCode[]
): CapabilityErrorContract[] {
  return [...universalHumanErrorCodes, ...domainCodes].map(
    (code) => errorCatalog[code],
  );
}
const id = z.string().trim().min(1).max(200);
const secret = z.string().min(8).max(10_000);
const objectOutput = {
  type: "object",
  additionalProperties: false,
} as const;
const nullableString = { type: ["string", "null"] } as const;
const nullableInteger = { type: ["integer", "null"] } as const;
const profileOutput = {
  ...objectOutput,
  required: [
    "id",
    "workspaceId",
    "name",
    "provider",
    "slotId",
    "slotName",
    "status",
    "activeVersion",
    "secretHint",
    "rotatedAt",
    "reprovisionable",
  ],
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    name: { type: "string" },
    provider: { type: "string" },
    slotId: nullableString,
    slotName: nullableString,
    status: { type: "string", enum: ["active", "disabled"] },
    activeVersion: nullableInteger,
    secretHint: nullableString,
    rotatedAt: nullableString,
    reprovisionable: { type: "boolean" },
  },
} as const;
const grantOutput = {
  ...objectOutput,
  required: [
    "id",
    "workspaceId",
    "principalId",
    "profileId",
    "mode",
    "limitCents",
    "spentCents",
    "status",
    "createdByUserId",
    "createdAt",
    "revokedAt",
  ],
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    principalId: { type: "string" },
    profileId: { type: "string" },
    mode: { type: "string", enum: ["bounded", "audited_unbounded"] },
    limitCents: nullableInteger,
    spentCents: { type: "integer", minimum: 0 },
    status: { type: "string", enum: ["active", "revoked"] },
    createdByUserId: { type: "string" },
    createdAt: { type: "string" },
    revokedAt: nullableString,
  },
} as const;
const auditEventOutput = {
  ...objectOutput,
  required: [
    "id",
    "workspaceId",
    "source",
    "eventType",
    "outcome",
    "reason",
    "actorUserId",
    "principalId",
    "profileId",
    "correlationRef",
    "idempotencyKey",
    "effectRef",
    "effectSequence",
    "createdAt",
  ],
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    source: { type: "string", enum: ["credential", "agent"] },
    eventType: { type: "string" },
    outcome: {
      type: "string",
      enum: ["pending", "succeeded", "denied", "failed", "unknown", "released"],
    },
    reason: nullableString,
    actorUserId: nullableString,
    principalId: nullableString,
    profileId: nullableString,
    correlationRef: nullableString,
    idempotencyKey: nullableString,
    effectRef: nullableString,
    effectSequence: nullableInteger,
    createdAt: { type: "string" },
  },
} as const;

function human(context: {
  securityContext?: import("@/types/capabilities").ResolvedSecurityContext;
}) {
  if (!context.securityContext || context.securityContext.kind !== "human") {
    throw new CapabilityFailure({
      code: "HUMAN_CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Credential management requires a Workspace owner or admin.",
    });
  }
  return context.securityContext;
}

function humanMutation(context: {
  securityContext?: import("@/types/capabilities").ResolvedSecurityContext;
}): Extract<
  import("@/types/capabilities").ResolvedSecurityContext,
  { kind: "human" }
> & { idempotencyKey: string } {
  const actor = human(context);
  if (!actor.idempotencyKey) {
    throw new CapabilityFailure({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      category: "validation",
      message: "Idempotency-Key is required for this credential mutation.",
    });
  }
  return actor as typeof actor & { idempotencyKey: string };
}

function registration<Input, Output>(
  value: CapabilityRegistration<Input, Output>,
): CapabilityRegistration<Input, Output> {
  return value;
}

function profileDto(profile: SafeCredentialProfile) {
  return {
    ...profile,
    rotatedAt: profile.rotatedAt?.toISOString() ?? null,
  };
}

function grantDto(grant: CredentialSpendGrant) {
  return {
    ...grant,
    createdAt: grant.createdAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
  };
}

function auditDto(event: CredentialAuditEvent) {
  return { ...event, createdAt: event.createdAt.toISOString() };
}

export function createCredentialHumanRegistrations(
  vault: CredentialVaultService,
): CapabilityRegistration[] {
  const common = {
    audience: "human" as const,
    lifecycle,
    approval: { mode: "none" as const },
    idempotency: { mode: "retry-safe" as const },
    authorization: { resources: [] },
  };
  return [
    registration({
      ...common,
      identity: CREDENTIAL_HUMAN_IDENTITIES.list,
      summary: "List redacted Credential Profiles, including legacy reprovisionable entries.",
      errors: humanErrors(),
      input: z.object({}).strict(),
      outputSchema: { ...objectOutput, required: ["profiles"], properties: { profiles: { type: "array", items: profileOutput } } },
      effect: query,
      handler: async (_input, context) => {
        const actor = human(context);
        return {
          profiles: (await vault.listProfiles(actor.workspaceId)).map(profileDto),
        };
      },
    }),
    registration({
      ...common,
      idempotency: { mode: "key-required" as const },
      identity: CREDENTIAL_HUMAN_IDENTITIES.create,
      summary: "Vault a new Credential Profile through a redacted handoff.",
      errors: humanErrors(
        "IDEMPOTENCY_KEY_REQUIRED",
        "INVALID_INPUT",
        "CONFLICT",
        "FORBIDDEN",
      ),
      input: z.object({ name: z.string().trim().min(1).max(120), provider: z.enum(CREDENTIAL_SLOT_PROVIDERS), slotName: z.string().trim().min(1).max(120), secret }).strict(),
      outputSchema: profileOutput,
      effect: mutation,
      handler: async (input, context) => {
        const actor = humanMutation(context);
        return profileDto(await vault.createProfile({ ...input, workspaceId: actor.workspaceId, actorUserId: actor.userId, idempotencyKey: actor.idempotencyKey }));
      },
    }),
    registration({
      ...common,
      idempotency: { mode: "key-required" as const },
      identity: CREDENTIAL_HUMAN_IDENTITIES.reprovision,
      summary: "Reprovision one disabled Credential Profile that has no usable active version.",
      errors: humanErrors(
        "IDEMPOTENCY_KEY_REQUIRED",
        "INVALID_INPUT",
        "CONFLICT",
      ),
      input: z.object({ profileId: id, provider: z.enum(CREDENTIAL_SLOT_PROVIDERS), slotName: z.string().trim().min(1).max(120), secret }).strict(),
      outputSchema: profileOutput,
      effect: mutation,
      handler: async (input, context) => {
        const actor = humanMutation(context);
        return profileDto(await vault.reprovisionProfile({ ...input, workspaceId: actor.workspaceId, actorUserId: actor.userId, idempotencyKey: actor.idempotencyKey }));
      },
    }),
    registration({
      ...common,
      idempotency: { mode: "key-required" as const },
      identity: CREDENTIAL_HUMAN_IDENTITIES.rotate,
      summary: "Rotate a Credential Profile with bounded overlap.",
      errors: humanErrors(
        "IDEMPOTENCY_KEY_REQUIRED",
        "INVALID_INPUT",
        "CONFLICT",
      ),
      input: z.object({ profileId: id, expectedActiveVersion: z.number().int().positive(), overlapSeconds: z.number().int().min(0).max(86_400).optional(), secret }).strict(),
      outputSchema: profileOutput,
      effect: mutation,
      handler: async (input, context) => {
        const actor = humanMutation(context);
        return profileDto(await vault.rotateProfile({ ...input, workspaceId: actor.workspaceId, actorUserId: actor.userId, idempotencyKey: actor.idempotencyKey }));
      },
    }),
    registration({
      ...common,
      idempotency: { mode: "intrinsic" as const },
      identity: CREDENTIAL_HUMAN_IDENTITIES.status,
      summary: "Enable or disable a Credential Profile.",
      errors: humanErrors("FORBIDDEN", "CONFLICT"),
      input: z.object({ profileId: id, status: z.enum(["active", "disabled"]) }).strict(),
      outputSchema: profileOutput,
      effect: mutation,
      handler: async (input, context) => {
        const actor = human(context);
        return profileDto(await vault.setProfileStatus({ ...input, workspaceId: actor.workspaceId, actorUserId: actor.userId }));
      },
    }),
    registration({
      ...common,
      idempotency: { mode: "intrinsic" as const },
      identity: CREDENTIAL_HUMAN_IDENTITIES.versionRevoke,
      summary: "Emergency-revoke one Credential version.",
      errors: humanErrors("CONFLICT"),
      input: z.object({ profileId: id, version: z.number().int().positive() }).strict(),
      outputSchema: { ...objectOutput, required: ["revoked"], properties: { revoked: { type: "boolean" } } },
      effect: mutation,
      handler: async (input, context) => {
        const actor = human(context);
        await vault.revokeVersion({ ...input, workspaceId: actor.workspaceId, actorUserId: actor.userId });
        return { revoked: true };
      },
    }),
    registration({
      ...common,
      identity: CREDENTIAL_HUMAN_IDENTITIES.grantsList,
      summary: "List Credential Spend Grants and immutable usage projections.",
      errors: humanErrors(),
      input: z.object({}).strict(),
      outputSchema: { ...objectOutput, required: ["grants"], properties: { grants: { type: "array", items: grantOutput } } },
      effect: query,
      handler: async (_input, context) => {
        const actor = human(context);
        return {
          grants: (await vault.listSpendGrants(actor.workspaceId)).map(grantDto),
        };
      },
    }),
    registration({
      ...common,
      idempotency: { mode: "key-required" as const },
      identity: CREDENTIAL_HUMAN_IDENTITIES.grantsCreate,
      summary: "Create an explicit bounded or audited-unbounded Credential Spend Grant.",
      errors: humanErrors(
        "IDEMPOTENCY_KEY_REQUIRED",
        "INVALID_INPUT",
        "CONFLICT",
        "FORBIDDEN",
      ),
      input: z.object({ principalId: id, profileId: id, mode: z.enum(["bounded", "audited_unbounded"]), limitCents: z.number().int().positive().max(2_147_483_647).optional() }).strict().refine((value) => value.mode === "bounded" ? value.limitCents !== undefined : value.limitCents === undefined),
      outputSchema: grantOutput,
      effect: mutation,
      handler: async (input, context) => {
        const actor = humanMutation(context);
        return grantDto(await vault.createSpendGrant({ ...input, workspaceId: actor.workspaceId, actorUserId: actor.userId, idempotencyKey: actor.idempotencyKey }));
      },
    }),
    registration({
      ...common,
      idempotency: { mode: "intrinsic" as const },
      identity: CREDENTIAL_HUMAN_IDENTITIES.grantsRevoke,
      summary: "Revoke one Credential Spend Grant.",
      errors: humanErrors("FORBIDDEN"),
      input: z.object({ grantId: id }).strict(),
      outputSchema: { ...objectOutput, required: ["revoked"], properties: { revoked: { type: "boolean" } } },
      effect: mutation,
      handler: async (input, context) => {
        const actor = human(context);
        await vault.revokeSpendGrant({ ...input, workspaceId: actor.workspaceId, actorUserId: actor.userId });
        return { revoked: true };
      },
    }),
    registration({
      ...common,
      identity: CREDENTIAL_HUMAN_IDENTITIES.auditList,
      summary:
        "List one time-ordered human-and-Agent security audit view for Credential operations.",
      errors: humanErrors("INVALID_INPUT"),
      input: z
        .object({
          limit: z.number().int().min(1).max(250).optional(),
          cursor: z.string().min(1).max(1000).optional(),
        })
        .strict(),
      outputSchema: {
        ...objectOutput,
        required: ["events", "nextCursor"],
        properties: {
          events: {
            type: "array",
            items: auditEventOutput,
          },
          nextCursor: nullableString,
        },
      },
      effect: query,
      handler: async (input, context) => {
        const actor = human(context);
        const page = await vault.listAuditEvents({
          workspaceId: actor.workspaceId,
          ...input,
        });
        return {
          events: page.events.map(auditDto),
          nextCursor: page.nextCursor,
        };
      },
    }),
    registration({
      ...common,
      identity: CREDENTIAL_HUMAN_IDENTITIES.auditExport,
      summary:
        "Export one bounded page of the unified Credential security audit as JSONL.",
      errors: humanErrors("INVALID_INPUT"),
      input: z
        .object({
          limit: z.number().int().min(1).max(250).optional(),
          cursor: z.string().min(1).max(1000).optional(),
        })
        .strict(),
      outputSchema: {
        ...objectOutput,
        required: ["contentType", "data", "nextCursor"],
        properties: {
          contentType: { type: "string", enum: ["application/x-ndjson"] },
          data: { type: "string" },
          nextCursor: nullableString,
        },
      },
      effect: query,
      handler: async (input, context) => {
        const actor = human(context);
        const page = await vault.listAuditEvents({
          workspaceId: actor.workspaceId,
          ...input,
        });
        return {
          contentType: "application/x-ndjson" as const,
          data: page.events.map(auditDto).map((event) => JSON.stringify(event)).join("\n"),
          nextCursor: page.nextCursor,
        };
      },
    }),
  ];
}
