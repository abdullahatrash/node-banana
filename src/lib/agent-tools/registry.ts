import { z } from "zod";
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

const definitionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "identity",
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
    identity: {
      type: "object",
      additionalProperties: false,
      required: ["name", "version"],
      properties: {
        name: { type: "string", pattern: IDENTITY_NAME.source },
        version: { type: "integer", minimum: 1 },
      },
    },
    summary: { type: "string", minLength: 1 },
    contractDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    lifecycle: { type: "object" },
    schemas: {
      type: "object",
      required: ["input", "output"],
      properties: {
        input: { type: "object" },
        output: { type: "object" },
      },
    },
    effect: { type: "object" },
    approval: { type: "object" },
    idempotency: { type: "object" },
    errors: { type: "array" },
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
    items: { type: "array", items: definitionSchema },
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
    summary: registration.summary,
    schemas: {
      input: z.toJSONSchema(registration.input, { target: "draft-7" }),
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
        outputSchema: freezeContractValue({ ...registration.outputSchema }),
        effect: freezeContractValue({ ...registration.effect }),
        approval: freezeContractValue({ ...registration.approval }),
        idempotency: freezeContractValue({ ...registration.idempotency }),
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

function activeLifecycle() {
  return {
    status: "active",
    introducedAt: INTRODUCED_AT,
    recommended: true,
  } as const;
}

export function createDiscoveryRegistrations(): CapabilityRegistration[] {
  return [
    {
      identity: CAPABILITY_LIST_IDENTITY,
      summary:
        "Discover exact published capability versions and immutable contracts.",
      lifecycle: activeLifecycle(),
      input: capabilityListInput,
      outputSchema: capabilityPageSchema,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      errors: COMMON_DISCOVERY_ERRORS,
      handler: (input, context) => ({
        items: context.registry.listDefinitions(input.lifecycle),
        registryDigest: context.registry.digest,
      }),
    },
    {
      identity: CAPABILITY_GET_IDENTITY,
      summary: "Inspect one exact published capability contract.",
      lifecycle: activeLifecycle(),
      input: capabilityGetInput,
      outputSchema: definitionSchema,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
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
    },
  ];
}

/** Production registry. Only discovery capabilities are in scope for #150. */
export const CAPABILITY_REGISTRY = createCapabilityRegistry(
  createDiscoveryRegistrations(),
);
