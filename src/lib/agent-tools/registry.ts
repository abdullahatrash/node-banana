import { z } from "zod";
import type { CredentialMetadataReader } from "@/types/credentials";
import { canonicalDigest } from "./canonical";
import type {
  CapabilityDefinition,
  CapabilityErrorContract,
  CapabilityIdentity,
  CapabilityLifecycleStatus,
  CapabilityRegistration,
  CapabilityRegistryReader,
  JsonSchema,
} from "./contracts";
import { CapabilityFailure } from "./errors";

const IDENTITY_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const INTRODUCED_AT = "2026-07-24T00:00:00.000Z";

export const QUERY_EFFECT = {
  mutation: "none",
  visibility: "private",
  timing: "immediate",
  reversibility: "reversible",
  maySpendProviderBudget: false,
} as const;

export const COMMON_DISCOVERY_ERRORS: CapabilityErrorContract[] = [
  {
    code: "CAPABILITY_IDENTITY_INVALID",
    category: "validation",
    retryable: false,
    description: "The request did not select one exact capability version.",
  },
  {
    code: "CAPABILITY_NOT_FOUND",
    category: "not_found",
    retryable: false,
    description: "The exact capability identity is not published.",
  },
  {
    code: "CAPABILITY_VERSION_RETIRED",
    category: "lifecycle",
    retryable: false,
    description:
      "The exact capability version remains inspectable but cannot execute.",
  },
  {
    code: "VALIDATION_FAILED",
    category: "validation",
    retryable: false,
    description: "The capability input does not satisfy its published schema.",
  },
  {
    code: "INTERNAL_ERROR",
    category: "internal",
    retryable: false,
    description: "The capability failed without exposing internal diagnostics.",
  },
];

const identitySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version"],
  properties: {
    name: { type: "string", pattern: IDENTITY_NAME.source },
    version: { type: "integer", minimum: 1 },
  },
};

const lifecycleSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "introducedAt", "recommended"],
  properties: {
    status: {
      type: "string",
      enum: ["experimental", "active", "deprecated", "retired"],
    },
    introducedAt: { type: "string", format: "date-time" },
    recommended: { type: "boolean" },
    deprecatedAt: { type: "string", format: "date-time" },
    retiredAt: { type: "string", format: "date-time" },
    sunsetAt: { type: "string", format: "date-time" },
    replacement: identitySchema,
  },
  allOf: [
    {
      if: { properties: { status: { const: "deprecated" } } },
      then: { required: ["deprecatedAt"] },
    },
    {
      if: { properties: { status: { const: "retired" } } },
      then: { required: ["retiredAt"] },
    },
    {
      if: { properties: { recommended: { const: true } } },
      then: { properties: { status: { const: "active" } } },
    },
  ],
};

const effectSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "mutation",
    "visibility",
    "timing",
    "reversibility",
    "maySpendProviderBudget",
  ],
  properties: {
    mutation: {
      type: "string",
      enum: ["none", "runtime-state", "external-system"],
    },
    visibility: {
      type: "string",
      enum: ["private", "publicly-visible"],
    },
    timing: {
      type: "string",
      enum: ["immediate", "durable-async", "future-trigger"],
    },
    reversibility: {
      type: "string",
      enum: ["reversible", "conditional", "irreversible"],
    },
    maySpendProviderBudget: { type: "boolean" },
  },
};

const approvalSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode"],
  properties: {
    mode: {
      type: "string",
      enum: ["none", "manages-approval", "required-before-effect"],
    },
  },
};

const idempotencySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode"],
  properties: {
    mode: {
      type: "string",
      enum: ["retry-safe", "intrinsic", "key-required"],
    },
  },
};

const errorContractSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "category", "retryable", "description"],
  properties: {
    code: { type: "string", pattern: "^[A-Z][A-Z0-9_]*$" },
    category: {
      type: "string",
      enum: [
        "validation",
        "not_found",
        "lifecycle",
        "authorization",
        "approval",
        "conflict",
        "internal",
      ],
    },
    retryable: { type: "boolean" },
    description: { type: "string", minLength: 1 },
  },
};

const jsonSchemaDocument: JsonSchema = {
  $ref: "http://json-schema.org/draft-07/schema#",
};

export const CAPABILITY_DEFINITION_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "identity",
    "audience",
    "summary",
    "contractDigest",
    "lifecycle",
    "schemas",
    "effect",
    "approval",
    "idempotency",
    "errors",
  ],
  properties: {
    identity: identitySchema,
    audience: { type: "string", enum: ["agent", "human", "shared"] },
    summary: { type: "string", minLength: 1 },
    contractDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    lifecycle: lifecycleSchema,
    schemas: {
      type: "object",
      additionalProperties: false,
      required: ["input", "output"],
      properties: {
        input: jsonSchemaDocument,
        output: jsonSchemaDocument,
      },
    },
    effect: effectSchema,
    approval: approvalSchema,
    idempotency: idempotencySchema,
    errors: {
      type: "array",
      minItems: 1,
      items: errorContractSchema,
    },
  },
};

const capabilityListInput = z
  .object({
    lifecycle: z
      .array(z.enum(["experimental", "active", "deprecated", "retired"]))
      .min(1)
      .optional()
      .describe("Optional lifecycle states to include."),
  })
  .strict();

const capabilityGetInput = z
  .object({
    name: z
      .string()
      .regex(IDENTITY_NAME)
      .describe("Stable dotted capability name."),
    version: z.number().int().positive().describe("Exact contract version."),
  })
  .strict();

const capabilityPageSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "registryDigest"],
  properties: {
    items: { type: "array", items: CAPABILITY_DEFINITION_SCHEMA },
    registryDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
  },
};

export const CAPABILITY_LIST_IDENTITY: CapabilityIdentity = {
  name: "capabilities.list",
  version: 1,
};

export const CAPABILITY_GET_IDENTITY: CapabilityIdentity = {
  name: "capabilities.get",
  version: 1,
};

export const AGENT_CURRENT_GET_IDENTITY: CapabilityIdentity = {
  name: "agents.current.get",
  version: 1,
};

export const CREDENTIAL_PROFILE_GET_IDENTITY: CapabilityIdentity = {
  name: "credentials.profile.get",
  version: 1,
};

export const CREDENTIAL_PROFILE_LIST_IDENTITY: CapabilityIdentity = {
  name: "credentials.profile.list",
  version: 1,
};

function identityKey(identity: CapabilityIdentity): string {
  return `${identity.name}@${identity.version}`;
}

function freezeContractValue<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freezeContractValue(child);
    }
    Object.freeze(value);
  }
  return value;
}

function validateIdentity(identity: CapabilityIdentity): void {
  if (
    !IDENTITY_NAME.test(identity.name) ||
    !Number.isSafeInteger(identity.version) ||
    identity.version < 1
  ) {
    throw new TypeError(
      `Invalid capability identity: ${identity.name}@${identity.version}`,
    );
  }
}

function immutableContract(
  registration: CapabilityRegistration,
): Omit<CapabilityDefinition, "contractDigest" | "lifecycle"> {
  return {
    identity: registration.identity,
    audience: registration.audience ?? "agent",
    summary: registration.summary,
    schemas: {
      input:
        registration.inputSchema ??
        z.toJSONSchema(registration.input, { target: "draft-7" }),
      output: registration.outputSchema,
    },
    effect: registration.effect,
    approval: registration.approval,
    idempotency: registration.idempotency,
    errors: registration.errors,
  };
}

export function contractDigestFor(
  definition: Omit<CapabilityDefinition, "contractDigest" | "lifecycle">,
): string {
  return canonicalDigest(definition);
}

export function authorizationContractDigestFor(
  identity: CapabilityIdentity,
  authorization: CapabilityRegistration["authorization"],
): string {
  return canonicalDigest({ identity, authorization });
}

export class CapabilityRegistry implements CapabilityRegistryReader {
  private readonly registrations: Map<string, CapabilityRegistration>;
  private readonly definitions: Map<string, CapabilityDefinition>;
  readonly digest: string;

  constructor(registrations: CapabilityRegistration[]) {
    this.registrations = new Map();
    this.definitions = new Map();

    const recommendedNames = new Set<string>();
    for (const registration of registrations) {
      validateIdentity(registration.identity);
      const key = identityKey(registration.identity);
      if (this.registrations.has(key)) {
        throw new TypeError(`Duplicate capability identity: ${key}`);
      }
      if (
        registration.lifecycle.recommended &&
        registration.lifecycle.status !== "active"
      ) {
        throw new TypeError(`Only an active capability may be recommended: ${key}`);
      }
      if (registration.lifecycle.recommended) {
        if (recommendedNames.has(registration.identity.name)) {
          throw new TypeError(
            `Only one active version may be recommended: ${registration.identity.name}`,
          );
        }
        recommendedNames.add(registration.identity.name);
      }
      if (
        registration.lifecycle.status === "deprecated" &&
        !registration.lifecycle.deprecatedAt
      ) {
        throw new TypeError(`Deprecated capability lacks deprecatedAt: ${key}`);
      }
      if (
        registration.lifecycle.status === "retired" &&
        !registration.lifecycle.retiredAt
      ) {
        throw new TypeError(`Retired capability lacks retiredAt: ${key}`);
      }

      const storedRegistration = Object.freeze({
        ...registration,
        identity: freezeContractValue({ ...registration.identity }),
        lifecycle: freezeContractValue({ ...registration.lifecycle }),
        inputSchema: registration.inputSchema
          ? freezeContractValue({ ...registration.inputSchema })
          : undefined,
        outputSchema: freezeContractValue({ ...registration.outputSchema }),
        effect: freezeContractValue({ ...registration.effect }),
        approval: freezeContractValue({ ...registration.approval }),
        idempotency: freezeContractValue({ ...registration.idempotency }),
        authorization: freezeContractValue({
          resources: registration.authorization.resources.map((selector) => ({
            ...selector,
          })),
        }),
        errors: freezeContractValue(
          registration.errors.map((error) => ({ ...error })),
        ),
      });
      const contract = immutableContract(storedRegistration);
      const definition: CapabilityDefinition = freezeContractValue({
        ...contract,
        contractDigest: contractDigestFor(contract),
        lifecycle: storedRegistration.lifecycle,
      });
      this.registrations.set(key, storedRegistration);
      this.definitions.set(key, definition);
    }

    this.digest = canonicalDigest(
      this.listDefinitions().map((definition) => ({
        identity: definition.identity,
        contractDigest: definition.contractDigest,
        lifecycle: definition.lifecycle,
      })),
    );
  }

  listDefinitions(
    statuses?: CapabilityLifecycleStatus[],
  ): CapabilityDefinition[] {
    const allowed = statuses ? new Set(statuses) : undefined;
    return [...this.definitions.values()]
      .filter((definition) => allowed?.has(definition.lifecycle.status) ?? true)
      .sort(
        (left, right) =>
          left.identity.name.localeCompare(right.identity.name) ||
          left.identity.version - right.identity.version,
      );
  }

  getDefinition(identity: CapabilityIdentity): CapabilityDefinition | undefined {
    return this.definitions.get(identityKey(identity));
  }

  getRegistration(
    identity: CapabilityIdentity,
  ): CapabilityRegistration | undefined {
    return this.registrations.get(identityKey(identity));
  }
}

export function createCapabilityRegistry(
  registrations: CapabilityRegistration[],
): CapabilityRegistry {
  return new CapabilityRegistry(registrations);
}

export function defineCapability<Input, Output>(
  registration: CapabilityRegistration<Input, Output>,
): CapabilityRegistration<Input, Output> {
  return registration;
}

function activeLifecycle() {
  return {
    status: "active",
    introducedAt: INTRODUCED_AT,
    recommended: true,
  } as const;
}

export function createDiscoveryRegistrations(): CapabilityRegistration[] {
  return [
    defineCapability({
      identity: CAPABILITY_LIST_IDENTITY,
      summary:
        "Discover exact published capability versions and immutable contracts.",
      lifecycle: activeLifecycle(),
      input: capabilityListInput,
      outputSchema: capabilityPageSchema,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: COMMON_DISCOVERY_ERRORS,
      handler: (input, context) => ({
        items: context.registry.listDefinitions(input.lifecycle),
        registryDigest: context.registry.digest,
      }),
    }),
    defineCapability({
      identity: CAPABILITY_GET_IDENTITY,
      summary: "Inspect one exact published capability contract.",
      lifecycle: activeLifecycle(),
      input: capabilityGetInput,
      outputSchema: CAPABILITY_DEFINITION_SCHEMA,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: COMMON_DISCOVERY_ERRORS,
      handler: ({ name, version }, context) => {
        const identity = { name, version };
        const definition = context.registry.getDefinition(identity);
        if (!definition) {
          throw new CapabilityFailure({
            code: "CAPABILITY_NOT_FOUND",
            category: "not_found",
            message: `Capability ${identityKey(identity)} is not published.`,
            details: { identity },
          });
        }
        return definition;
      },
    }),
  ];
}

export function createAgentIdentityRegistrations(): CapabilityRegistration[] {
  return [
    defineCapability({
      identity: AGENT_CURRENT_GET_IDENTITY,
      summary:
        "Return the authenticated Agent Principal and Workspace security context.",
      lifecycle: activeLifecycle(),
      input: z.object({}).strict(),
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["principalId", "workspaceId", "keyId", "access"],
        properties: {
          principalId: { type: "string", minLength: 1 },
          workspaceId: { type: "string", minLength: 1 },
          keyId: { type: "string", minLength: 1 },
          access: { type: "array", items: { type: "string" } },
        },
      },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: [
        ...COMMON_DISCOVERY_ERRORS,
        {
          code: "AGENT_AUTHENTICATION_FAILED",
          category: "authorization",
          retryable: false,
          description: "The transport did not resolve an active Agent Principal.",
        },
        {
          code: "AGENT_PRINCIPAL_SUSPENDED",
          category: "authorization",
          retryable: false,
          description: "The resolved Agent Principal is suspended.",
        },
        {
          code: "AGENT_PRINCIPAL_REVOKED",
          category: "authorization",
          retryable: false,
          description: "The resolved Agent Principal is revoked.",
        },
        {
          code: "AGENT_SPONSOR_LOST",
          category: "authorization",
          retryable: false,
          description:
            "The Agent Principal no longer has an accountable Workspace owner or admin sponsor.",
        },
        {
          code: "AGENT_WORKSPACE_UNAVAILABLE",
          category: "authorization",
          retryable: false,
          description: "The Agent Principal's Workspace is unavailable.",
        },
      ],
      handler: (_input, context) => {
        const securityContext = context.securityContext;
        if (!securityContext || securityContext.kind !== "agent") {
          throw new CapabilityFailure({
            code: "AGENT_AUTHENTICATION_FAILED",
            category: "authorization",
            message: "Agent authentication failed.",
          });
        }
        return {
          principalId: securityContext.principalId,
          workspaceId: securityContext.workspaceId,
          keyId: securityContext.keyId,
          // Retained for the published @1 output contract. Enrollment access
          // is no longer carried in the authentication proof or used as
          // runtime authority.
          access: [],
        };
      },
    }),
  ];
}

export function createCredentialProfileRegistrations(
  metadataReader: CredentialMetadataReader,
): CapabilityRegistration[] {
  function activeProfile(
    profile: Awaited<ReturnType<CredentialMetadataReader["getSafeProfile"]>>,
  ): profile is NonNullable<typeof profile> & {
    slotId: string;
    slotName: string;
    activeVersion: number;
    secretHint: string;
    rotatedAt: Date;
    status: "active";
  } {
    return Boolean(
      profile &&
        !profile.reprovisionable &&
        profile.status === "active" &&
        profile.slotId &&
        profile.slotName &&
        profile.activeVersion &&
        profile.secretHint &&
        profile.rotatedAt,
    );
  }
  const redactedProfileSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "name",
      "provider",
      "slotId",
      "slotName",
      "status",
      "activeVersion",
      "secretHint",
      "rotatedAt",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      provider: { type: "string" },
      slotId: { type: "string" },
      slotName: { type: "string" },
      status: { type: "string", enum: ["active"] },
      activeVersion: { type: "integer", minimum: 1 },
      secretHint: { type: "string" },
      rotatedAt: { type: "string", format: "date-time" },
    },
  } as const;
  return [
    defineCapability({
      identity: CREDENTIAL_PROFILE_LIST_IDENTITY,
      summary:
        "List redacted metadata for every Credential Profile authorized by the effective server-side resource intersection.",
      lifecycle: activeLifecycle(),
      input: z.object({}).strict(),
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["profiles"],
        properties: {
          profiles: { type: "array", items: redactedProfileSchema },
        },
      },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: COMMON_DISCOVERY_ERRORS,
      handler: async (_input, context) => {
        const securityContext = context.securityContext;
        if (!securityContext || securityContext.kind !== "agent") {
          throw new CapabilityFailure({
            code: "CREDENTIAL_PROFILE_UNAVAILABLE",
            category: "authorization",
            message: "Credential Profile metadata is unavailable.",
          });
        }
        const authorizedProfileIds =
          context.authorizationAdmission?.effectiveResources
            ?.credentialProfileIds ?? [];
        const profiles = await Promise.all(
          authorizedProfileIds.map((profileId) =>
            metadataReader.getSafeProfile({
              workspaceId: securityContext.workspaceId,
              profileId,
            }),
          ),
        );
        return {
          profiles: profiles.filter(activeProfile).map((profile) => ({
            id: profile.id,
            name: profile.name,
            provider: profile.provider,
            slotId: profile.slotId,
            slotName: profile.slotName,
            status: profile.status,
            activeVersion: profile.activeVersion,
            secretHint: profile.secretHint,
            rotatedAt: profile.rotatedAt.toISOString(),
          })),
        };
      },
    }),
    defineCapability({
      identity: CREDENTIAL_PROFILE_GET_IDENTITY,
      summary:
        "Read redacted metadata for one authorized Credential Profile.",
      lifecycle: activeLifecycle(),
      input: z
        .object({ credentialProfileId: z.string().min(1).max(200) })
        .strict(),
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "provider",
          "slotId",
          "slotName",
          "status",
          "activeVersion",
          "secretHint",
          "rotatedAt",
        ],
        properties: redactedProfileSchema.properties,
      },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: {
        resources: [
          {
            kind: "credential_profile",
            inputPath: "credentialProfileId",
          },
        ],
      },
      errors: [
        ...COMMON_DISCOVERY_ERRORS,
        {
          code: "CREDENTIAL_PROFILE_UNAVAILABLE",
          category: "not_found",
          retryable: false,
          description: "Credential Profile metadata is unavailable.",
        },
      ],
      handler: async ({ credentialProfileId }, context) => {
        const securityContext = context.securityContext;
        if (!securityContext || securityContext.kind !== "agent") {
          throw new CapabilityFailure({
            code: "CREDENTIAL_PROFILE_UNAVAILABLE",
            category: "authorization",
            message: "Credential Profile metadata is unavailable.",
          });
        }
        const profile = await metadataReader.getSafeProfile({
          workspaceId: securityContext.workspaceId,
          profileId: credentialProfileId,
        });
        if (!activeProfile(profile)) {
          throw new CapabilityFailure({
            code: "CREDENTIAL_PROFILE_UNAVAILABLE",
            category: "not_found",
            message: "Credential Profile metadata is unavailable.",
          });
        }
        return {
          id: profile.id,
          name: profile.name,
          provider: profile.provider,
          slotId: profile.slotId,
          slotName: profile.slotName,
          status: profile.status,
          activeVersion: profile.activeVersion,
          secretHint: profile.secretHint,
          rotatedAt: profile.rotatedAt.toISOString(),
        };
      },
    }),
  ];
}
