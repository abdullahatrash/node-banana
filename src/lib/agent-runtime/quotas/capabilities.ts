import { z } from "zod";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import {
  COMMON_DISCOVERY_ERRORS,
  QUERY_EFFECT,
  defineCapability,
} from "@/lib/agent-tools/registry";
import type {
  CapabilityErrorContract,
  CapabilityRegistration,
  JsonSchema,
  ResolvedSecurityContext,
} from "@/types/capabilities";
import type {
  CreateQuotaPolicyRevisionInput,
  EffectiveQuotaCapacity,
  QuotaBoundary,
  QuotaPolicy,
  QuotaPolicyRevision,
  QuotaReservation,
  QuotaWait,
  QuotaWaitState,
} from "./types";
import { QuotaServiceError } from "./service";

export const QUOTA_CAPABILITY_IDENTITIES = {
  effectivePoliciesGet: { name: "quota_policies.get_effective", version: 1 },
  reservationsList: { name: "quota_reservations.list", version: 1 },
  waitsList: { name: "quota_waits.list", version: 1 },
  policiesList: { name: "quota_policies.list", version: 1 },
  policyRevisionCreate: { name: "quota_policy_revisions.create", version: 1 },
  waitResume: { name: "quota_waits.resume", version: 1 },
} as const;

type QuotaCapabilityName =
  typeof QUOTA_CAPABILITY_IDENTITIES[keyof typeof QUOTA_CAPABILITY_IDENTITIES]["name"];

export type QuotaCapabilityIdentity = `${QuotaCapabilityName}@1`;
export type QuotaHumanCapabilityIdentity = Exclude<
  QuotaCapabilityIdentity,
  | "quota_policies.get_effective@1"
  | "quota_reservations.list@1"
  | "quota_waits.list@1"
>;

export interface QuotaCapabilityService {
  createPolicyRevision(input: CreateQuotaPolicyRevisionInput): Promise<{
    policy: QuotaPolicy;
    revision: QuotaPolicyRevision;
  }>;
  getEffectiveCapacity(input: {
    workspaceId: string;
    principalId: string;
    at: Date;
    boundary?: QuotaBoundary;
    dimension?: string;
  }): Promise<EffectiveQuotaCapacity[]>;
  listPolicies(workspaceId: string): Promise<Array<{
    policy: QuotaPolicy;
    revision: QuotaPolicyRevision;
  }>>;
  listReservations(input: {
    workspaceId: string;
    runId?: string;
    admittedPrincipalId?: string;
    limit?: number;
  }): Promise<QuotaReservation[]>;
  listWaits(input: {
    workspaceId: string;
    runId?: string;
    state?: QuotaWaitState;
    admittedPrincipalId?: string;
    limit?: number;
  }): Promise<QuotaWait[]>;
  getWait(input: { workspaceId: string; waitId: string }): Promise<QuotaWait | null>;
}

export interface QuotaWaitResumeCoordinator {
  resumeQuotaWait(input: {
    workspaceId: string;
    waitId: string;
    actor: { kind: "human"; userId: string };
    idempotencyKey: string;
  }): Promise<unknown>;
}

const lifecycle = {
  status: "active",
  introducedAt: "2026-08-01T00:00:00.000Z",
  recommended: true,
} as const;

const mutationEffect = {
  mutation: "runtime-state",
  visibility: "private",
  timing: "immediate",
  reversibility: "conditional",
  maySpendProviderBudget: false,
} as const;

const safeId = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/);
const exactDecimal = z
  .string()
  .max(81)
  .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/);
const dimension = z
  .string()
  .regex(/^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$/);
const boundary = z.enum([
  "run_admission",
  "run_concurrency",
  "provider_effect",
  "artifact_storage",
  "usage_settlement",
]);
const unit = z.enum(["count", "byte", "millisecond", "megapixel"]);
const waitState = z.enum(["waiting", "resumed", "cancelled"]);

const strictObject = (
  required: string[],
  properties: Record<string, JsonSchema>,
): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

const dateTime: JsonSchema = { type: "string", format: "date-time" };
const nullableDateTime: JsonSchema = { oneOf: [dateTime, { type: "null" }] };
const nullableString: JsonSchema = { type: ["string", "null"] };
const decimalSchema: JsonSchema = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
};
const stringArray: JsonSchema = {
  type: "array",
  items: { type: "string" },
  uniqueItems: true,
};

const subjectSchema = strictObject(["kind", "id"], {
  kind: {
    type: "string",
    enum: ["run", "step_attempt", "artifact", "usage_settlement"],
  },
  id: { type: "string" },
});

const windowSchema = strictObject(
  ["kind", "timezone", "startsAt", "endsAt"],
  {
    kind: {
      type: "string",
      enum: [
        "concurrent", "calendar_minute", "calendar_hour", "calendar_day",
        "calendar_week", "calendar_month", "lifetime",
      ],
    },
    timezone: { type: "string" },
    startsAt: dateTime,
    endsAt: nullableDateTime,
  },
);

const policySchema = strictObject(
  [
    "schema", "id", "workspaceId", "principalId", "scope", "kind",
    "boundary", "dimension", "unit", "window", "timezone",
    "reservationRule", "status", "currentRevisionId", "createdAt", "updatedAt",
  ],
  {
    schema: { const: "quota-policy/v1" },
    id: { type: "string" },
    workspaceId: { type: "string" },
    principalId: nullableString,
    scope: { type: "string", enum: ["workspace", "principal"] },
    kind: { type: "string", enum: ["admission", "concurrency", "rate", "storage", "usage"] },
    boundary: { type: "string", enum: boundary.options },
    dimension: { type: "string" },
    unit: { type: "string", enum: unit.options },
    window: {
      type: "string",
      enum: [
        "concurrent", "calendar_minute", "calendar_hour", "calendar_day",
        "calendar_week", "calendar_month", "lifetime",
      ],
    },
    timezone: { type: "string" },
    reservationRule: {
      type: "string",
      enum: ["consume", "release_on_terminal", "release_on_transition"],
    },
    status: { type: "string", enum: ["active", "revoked"] },
    currentRevisionId: { type: "string" },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
);

function revisionSchema(includeActor: boolean): JsonSchema {
  return strictObject(
    [
      "schema", "id", "policyId", "workspaceId", "principalId", "revision",
      "warningThreshold", "hardLimit", "exhaustionBehavior",
      ...(includeActor ? ["createdByUserId"] : []),
      "createdAt",
    ],
    {
      schema: { const: "quota-policy-revision/v1" },
      id: { type: "string" },
      policyId: { type: "string" },
      workspaceId: { type: "string" },
      principalId: nullableString,
      revision: { type: "integer", minimum: 1 },
      warningThreshold: decimalSchema,
      hardLimit: decimalSchema,
      exhaustionBehavior: { type: "string", enum: ["deny", "wait"] },
      ...(includeActor ? { createdByUserId: { type: "string" } } : {}),
      createdAt: dateTime,
    },
  );
}

const exhaustionEvidenceSchema = strictObject(
  [
    "schema", "policyId", "policyRevisionId", "scope", "dimension", "unit",
    "window", "hardLimit", "committed", "requested", "available",
    "blockingReservationIds", "evaluatedAt", "eligibleAt", "eligibility",
    "evidenceRef", "evidenceVersion",
  ],
  {
    schema: { const: "quota-exhaustion-evidence/v1" },
    policyId: { type: "string" },
    policyRevisionId: { type: "string" },
    scope: { type: "string", enum: ["workspace", "principal"] },
    dimension: { type: "string" },
    unit: { type: "string", enum: unit.options },
    window: windowSchema,
    hardLimit: decimalSchema,
    committed: decimalSchema,
    requested: decimalSchema,
    available: decimalSchema,
    blockingReservationIds: stringArray,
    evaluatedAt: dateTime,
    eligibleAt: nullableDateTime,
    eligibility: {
      oneOf: [
        strictObject(["kind", "eligibleAt"], {
          kind: { const: "window_renewal" },
          eligibleAt: dateTime,
        }),
        strictObject(["kind", "requiredAvailable"], {
          kind: { const: "capacity_release" },
          requiredAvailable: decimalSchema,
        }),
      ],
    },
    evidenceRef: { type: "string" },
    evidenceVersion: { const: 1 },
  },
);

const reservationSchema = strictObject(
  [
    "schema", "id", "workspaceId", "admittedPrincipalId", "principalId",
    "runId", "transitionKey", "boundary", "subject", "policyId",
    "policyRevisionId", "scope", "kind", "dimension", "unit", "window",
    "reservationRule", "reservedAmount", "heldAmount", "settledAmount",
    "releasedAmount", "overageAmount", "state", "createdAt", "updatedAt",
  ],
  {
    schema: { const: "quota-reservation/v1" },
    id: { type: "string" },
    workspaceId: { type: "string" },
    admittedPrincipalId: { type: "string" },
    principalId: nullableString,
    runId: nullableString,
    transitionKey: { type: "string" },
    boundary: { type: "string", enum: boundary.options },
    subject: subjectSchema,
    policyId: { type: "string" },
    policyRevisionId: { type: "string" },
    scope: { type: "string", enum: ["workspace", "principal"] },
    kind: { type: "string", enum: ["admission", "concurrency", "rate", "storage", "usage"] },
    dimension: { type: "string" },
    unit: { type: "string", enum: unit.options },
    window: windowSchema,
    reservationRule: {
      type: "string",
      enum: ["consume", "release_on_terminal", "release_on_transition"],
    },
    reservedAmount: decimalSchema,
    heldAmount: decimalSchema,
    settledAmount: decimalSchema,
    releasedAmount: decimalSchema,
    overageAmount: decimalSchema,
    state: { type: "string", enum: ["held", "settled", "released"] },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
);

const claimSchema = strictObject(["dimension", "unit", "amount"], {
  dimension: { type: "string" },
  unit: { type: "string", enum: unit.options },
  amount: decimalSchema,
});

const waitSchema = strictObject(
  [
    "schema", "id", "workspaceId", "admittedPrincipalId", "runId",
    "transitionKey", "boundary", "subject", "claims", "reasonCode",
    "evidence", "eligibleAt", "state", "resumeReason",
    "resumedBy", "resolutionReservationIds", "createdAt", "resolvedAt",
  ],
  {
    schema: { const: "quota-wait/v1" },
    id: { type: "string" },
    workspaceId: { type: "string" },
    admittedPrincipalId: { type: "string" },
    runId: { type: "string" },
    transitionKey: { type: "string" },
    boundary: { type: "string", enum: boundary.options },
    subject: subjectSchema,
    claims: { type: "array", items: claimSchema },
    reasonCode: { const: "QUOTA_RENEWABLE_CAPACITY_EXHAUSTED" },
    evidence: { type: "array", items: exhaustionEvidenceSchema },
    eligibleAt: nullableDateTime,
    state: { type: "string", enum: waitState.options },
    resumeReason: nullableString,
    resumedBy: {
      oneOf: [
        strictObject(["kind", "userId"], {
          kind: { const: "human" },
          userId: { type: "string" },
        }),
        strictObject(["kind", "principalId"], {
          kind: { const: "principal" },
          principalId: { type: "string" },
        }),
        strictObject(["kind"], { kind: { const: "system" } }),
        { type: "null" },
      ],
    },
    resolutionReservationIds: stringArray,
    createdAt: dateTime,
    resolvedAt: nullableDateTime,
  },
);

const capacitySchema = strictObject(
  [
    "schema", "policy", "revision", "window", "committed", "available",
    "blockingReservationIds", "warning", "exhausted", "evaluatedAt",
  ],
  {
    schema: { const: "effective-quota-capacity/v1" },
    policy: policySchema,
    revision: revisionSchema(false),
    window: windowSchema,
    committed: decimalSchema,
    available: decimalSchema,
    blockingReservationIds: stringArray,
    warning: { type: "boolean" },
    exhausted: { type: "boolean" },
    evaluatedAt: dateTime,
  },
);

const humanErrors: CapabilityErrorContract[] = [
  ...COMMON_DISCOVERY_ERRORS,
  {
    code: "HUMAN_CAPABILITY_NOT_AUTHORIZED",
    category: "authorization",
    retryable: false,
    description: "An authenticated Workspace owner or admin is required.",
  },
  {
    code: "IDEMPOTENCY_KEY_REQUIRED",
    category: "validation",
    retryable: false,
    description: "A transport Idempotency-Key is required for this mutation.",
  },
  {
    code: "QUOTA_INVALID_INPUT",
    category: "validation",
    retryable: false,
    description: "The Quota request violates a domain invariant.",
  },
  {
    code: "QUOTA_CONFLICT",
    category: "conflict",
    retryable: false,
    description: "The request conflicts with current Quota state.",
  },
  {
    code: "QUOTA_UNAVAILABLE",
    category: "not_found",
    retryable: false,
    description: "The selected Quota resource is unavailable.",
  },
  {
    code: "QUOTA_PERSISTENCE_UNAVAILABLE",
    category: "internal",
    retryable: true,
    description: "Quota persistence is temporarily unavailable.",
  },
];

const sharedErrors: CapabilityErrorContract[] = [
  ...COMMON_DISCOVERY_ERRORS,
  humanErrors.find((error) => error.code === "QUOTA_INVALID_INPUT")!,
  humanErrors.find((error) => error.code === "QUOTA_UNAVAILABLE")!,
];

function reader(context: ResolvedSecurityContext | undefined) {
  if (
    !context ||
    (context.kind === "human" &&
      context.role !== "owner" &&
      context.role !== "admin")
  ) {
    throw new CapabilityFailure({
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message:
        "Quota evidence requires the calling Agent or a Workspace owner or admin.",
    });
  }
  return context;
}

function administrator(context: ResolvedSecurityContext | undefined) {
  if (
    !context ||
    context.kind !== "human" ||
    (context.role !== "owner" && context.role !== "admin")
  ) {
    throw new CapabilityFailure({
      code: "HUMAN_CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Quota administration requires a Workspace owner or admin.",
    });
  }
  return context;
}

function mutationAdministrator(context: ResolvedSecurityContext | undefined) {
  const actor = administrator(context);
  if (!actor.idempotencyKey) {
    throw new CapabilityFailure({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      category: "validation",
      message: "Idempotency-Key is required for this Quota mutation.",
    });
  }
  return actor as typeof actor & { idempotencyKey: string };
}

async function quotaDomain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof QuotaServiceError)) throw error;
    throw new CapabilityFailure({
      code: error.code,
      category:
        error.code === "QUOTA_INVALID_INPUT"
          ? "validation"
          : error.code === "QUOTA_PERSISTENCE_UNAVAILABLE"
            ? "internal"
          : error.code === "QUOTA_UNAVAILABLE"
            ? "not_found"
            : "conflict",
      message: error.message,
      retryable: error.code === "QUOTA_PERSISTENCE_UNAVAILABLE",
    });
  }
}

async function resumeDomain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (code === "QUOTA_INVALID_INPUT") {
      throw new CapabilityFailure({
        code,
        category: "validation",
        message: error instanceof Error ? error.message : "Quota Wait input is invalid.",
      });
    }
    if (code === "IDEMPOTENCY_CONFLICT" || code === "QUOTA_CONFLICT") {
      throw new CapabilityFailure({
        code: "QUOTA_CONFLICT",
        category: "conflict",
        message: error instanceof Error ? error.message : "Quota Wait replay conflicts.",
      });
    }
    if (
      code === "QUOTA_UNAVAILABLE" ||
      code === "WORKFLOW_RUN_NOT_RESUMABLE" ||
      code === "WORKFLOW_RUN_UNAVAILABLE"
    ) {
      throw new CapabilityFailure({
        code: "QUOTA_UNAVAILABLE",
        category: "not_found",
        message: error instanceof Error ? error.message : "Quota Wait is unavailable.",
      });
    }
    throw error;
  }
}

function policyDto(policy: QuotaPolicy) {
  return {
    ...policy,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  };
}

function revisionDto(revision: QuotaPolicyRevision, includeActor: boolean) {
  const { createdByUserId, ...safe } = revision;
  return {
    ...safe,
    ...(includeActor ? { createdByUserId } : {}),
    createdAt: revision.createdAt.toISOString(),
  };
}

function windowDto(window: EffectiveQuotaCapacity["window"]) {
  return {
    ...window,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt?.toISOString() ?? null,
  };
}

function evidenceDto(evidence: QuotaWait["evidence"][number]) {
  return {
    ...evidence,
    window: windowDto(evidence.window),
    evaluatedAt: evidence.evaluatedAt.toISOString(),
    eligibleAt: evidence.eligibleAt?.toISOString() ?? null,
    eligibility: evidence.eligibility.kind === "window_renewal"
      ? {
          ...evidence.eligibility,
          eligibleAt: evidence.eligibility.eligibleAt.toISOString(),
        }
      : evidence.eligibility,
  };
}

function capacityDto(capacity: EffectiveQuotaCapacity) {
  return {
    ...capacity,
    policy: policyDto(capacity.policy),
    revision: revisionDto(capacity.revision, false),
    window: windowDto(capacity.window),
    evaluatedAt: capacity.evaluatedAt.toISOString(),
  };
}

function reservationDto(reservation: QuotaReservation) {
  return {
    ...reservation,
    window: windowDto(reservation.window),
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

function waitDto(wait: QuotaWait) {
  const { resumeIdempotencyKey: _internalResumeIdempotencyKey, ...publicWait } = wait;
  return {
    ...publicWait,
    evidence: wait.evidence.map(evidenceDto),
    eligibleAt: wait.eligibleAt?.toISOString() ?? null,
    createdAt: wait.createdAt.toISOString(),
    resolvedAt: wait.resolvedAt?.toISOString() ?? null,
  };
}

function sharedRegistration<Input, Output>(
  value: Omit<
    CapabilityRegistration<Input, Output>,
    "audience" | "effect" | "approval" | "idempotency" | "authorization" | "errors"
  >,
): CapabilityRegistration<Input, Output> {
  return defineCapability({
    ...value,
    audience: "shared",
    effect: QUERY_EFFECT,
    approval: { mode: "none" },
    idempotency: { mode: "retry-safe" },
    authorization: { resources: [] },
    errors: sharedErrors,
  });
}

function humanRegistration<Input, Output>(
  value: Omit<
    CapabilityRegistration<Input, Output>,
    "audience" | "approval" | "authorization" | "errors"
  >,
): CapabilityRegistration<Input, Output> {
  return defineCapability({
    ...value,
    audience: "human",
    approval: { mode: "none" },
    authorization: { resources: [] },
    errors: humanErrors,
  });
}

export function createQuotaRegistrations(
  service: QuotaCapabilityService,
  options: {
    now?: () => Date;
    waitResumeCoordinator: QuotaWaitResumeCoordinator;
  },
): CapabilityRegistration[] {
  const now = options.now ?? (() => new Date());
  return [
    sharedRegistration({
      identity: QUOTA_CAPABILITY_IDENTITIES.effectivePoliciesGet,
      summary: "Read effective Workspace and Agent Principal Quota capacity.",
      lifecycle,
      input: z.object({
        principalId: safeId.optional(),
        boundary: boundary.optional(),
        dimension: dimension.optional(),
      }).strict(),
      outputSchema: strictObject(["schema", "items"], {
        schema: { const: "effective-quota-capacity-list/v1" },
        items: { type: "array", items: capacitySchema },
      }),
      handler: async (input, context) => {
        const caller = reader(context.securityContext);
        const principalId = caller.kind === "agent" ? caller.principalId : input.principalId;
        if (
          caller.kind === "agent" &&
          input.principalId &&
          input.principalId !== caller.principalId
        ) {
          throw new CapabilityFailure({
            code: "CAPABILITY_NOT_AUTHORIZED",
            category: "authorization",
            message: "Effective Quota capacity is not authorized.",
          });
        }
        if (!principalId) {
          throw new CapabilityFailure({
            code: "QUOTA_INVALID_INPUT",
            category: "validation",
            message: "principalId is required for a human effective-capacity read.",
          });
        }
        const items = await quotaDomain(() => service.getEffectiveCapacity({
          workspaceId: caller.workspaceId,
          principalId,
          at: now(),
          ...(input.boundary ? { boundary: input.boundary } : {}),
          ...(input.dimension ? { dimension: input.dimension } : {}),
        }));
        return {
          schema: "effective-quota-capacity-list/v1" as const,
          items: items.map(capacityDto),
        };
      },
    }),
    sharedRegistration({
      identity: QUOTA_CAPABILITY_IDENTITIES.reservationsList,
      summary: "List safe Workspace-scoped Quota Reservation evidence.",
      lifecycle,
      input: z.object({
        runId: safeId.optional(),
        principalId: safeId.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict(),
      outputSchema: strictObject(["schema", "items"], {
        schema: { const: "quota-reservation-list/v1" },
        items: { type: "array", items: reservationSchema },
      }),
      handler: async (input, context) => {
        const caller = reader(context.securityContext);
        if (
          caller.kind === "agent" &&
          input.principalId &&
          input.principalId !== caller.principalId
        ) {
          throw new CapabilityFailure({
            code: "CAPABILITY_NOT_AUTHORIZED",
            category: "authorization",
            message: "Quota Reservations are not authorized.",
          });
        }
        const admittedPrincipalId = caller.kind === "agent"
          ? caller.principalId
          : input.principalId;
        const items = (await quotaDomain(() => service.listReservations({
          workspaceId: caller.workspaceId,
          ...(input.runId ? { runId: input.runId } : {}),
          ...(admittedPrincipalId ? { admittedPrincipalId } : {}),
          limit: input.limit ?? 100,
        }))).filter((item) =>
          caller.kind === "agent"
            ? item.admittedPrincipalId === caller.principalId
            : !input.principalId || item.admittedPrincipalId === input.principalId);
        return {
          schema: "quota-reservation-list/v1" as const,
          items: items.map(reservationDto),
        };
      },
    }),
    sharedRegistration({
      identity: QUOTA_CAPABILITY_IDENTITIES.waitsList,
      summary: "List Quota Wait eligibility and canonical resumption evidence.",
      lifecycle,
      input: z.object({
        runId: safeId.optional(),
        principalId: safeId.optional(),
        state: waitState.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict(),
      outputSchema: strictObject(["schema", "items"], {
        schema: { const: "quota-wait-list/v1" },
        items: { type: "array", items: waitSchema },
      }),
      handler: async (input, context) => {
        const caller = reader(context.securityContext);
        if (
          caller.kind === "agent" &&
          input.principalId &&
          input.principalId !== caller.principalId
        ) {
          throw new CapabilityFailure({
            code: "CAPABILITY_NOT_AUTHORIZED",
            category: "authorization",
            message: "Quota Waits are not authorized.",
          });
        }
        const admittedPrincipalId = caller.kind === "agent"
          ? caller.principalId
          : input.principalId;
        const items = (await quotaDomain(() => service.listWaits({
          workspaceId: caller.workspaceId,
          ...(input.runId ? { runId: input.runId } : {}),
          ...(input.state ? { state: input.state } : {}),
          ...(admittedPrincipalId ? { admittedPrincipalId } : {}),
          limit: input.limit ?? 100,
        }))).filter((item) =>
          caller.kind === "agent"
            ? item.admittedPrincipalId === caller.principalId
            : !input.principalId || item.admittedPrincipalId === input.principalId);
        return {
          schema: "quota-wait-list/v1" as const,
          items: items.map(waitDto),
        };
      },
    }),
    humanRegistration({
      identity: QUOTA_CAPABILITY_IDENTITIES.policiesList,
      summary: "List current versioned Workspace and Agent Principal Quota policies.",
      lifecycle,
      input: z.object({}).strict(),
      outputSchema: strictObject(["schema", "items"], {
        schema: { const: "quota-policy-list/v1" },
        items: {
          type: "array",
          items: strictObject(["policy", "revision"], {
            policy: policySchema,
            revision: revisionSchema(true),
          }),
        },
      }),
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (_input, context) => {
        const actor = administrator(context.securityContext);
        const items = await quotaDomain(() => service.listPolicies(actor.workspaceId));
        return {
          schema: "quota-policy-list/v1" as const,
          items: items.map(({ policy, revision }) => ({
            policy: policyDto(policy),
            revision: revisionDto(revision, true),
          })),
        };
      },
    }),
    humanRegistration({
      identity: QUOTA_CAPABILITY_IDENTITIES.policyRevisionCreate,
      summary: "Create an immutable Workspace or Agent Principal Quota policy revision.",
      lifecycle,
      input: z.object({
        principalId: safeId.nullable(),
        kind: z.enum(["admission", "concurrency", "rate", "storage", "usage"]),
        boundary,
        dimension,
        unit,
        window: z.enum([
          "concurrent", "calendar_minute", "calendar_hour", "calendar_day",
          "calendar_week", "calendar_month", "lifetime",
        ]),
        timezone: z.string().trim().min(1).max(255),
        reservationRule: z.enum(["consume", "release_on_terminal", "release_on_transition"]),
        warningThreshold: exactDecimal,
        hardLimit: exactDecimal,
        exhaustionBehavior: z.enum(["deny", "wait"]),
      }).strict(),
      outputSchema: strictObject(["policy", "revision"], {
        policy: policySchema,
        revision: revisionSchema(true),
      }),
      effect: mutationEffect,
      idempotency: { mode: "key-required" },
      handler: async (input, context) => {
        const actor = mutationAdministrator(context.securityContext);
        const result = await quotaDomain(() => service.createPolicyRevision({
          ...input,
          workspaceId: actor.workspaceId,
          actorUserId: actor.userId,
          idempotencyKey: actor.idempotencyKey,
          recordedAt: now(),
        }));
        return {
          policy: policyDto(result.policy),
          revision: revisionDto(result.revision, true),
        };
      },
    }),
    humanRegistration({
      identity: QUOTA_CAPABILITY_IDENTITIES.waitResume,
      summary: "Re-evaluate one canonical Quota Wait and resume the same Run when capacity is available.",
      lifecycle,
      input: z.object({ waitId: safeId }).strict(),
      outputSchema: strictObject(["wait"], { wait: waitSchema }),
      effect: mutationEffect,
      idempotency: { mode: "key-required" },
      handler: async (input, context) => {
        const actor = mutationAdministrator(context.securityContext);
        await resumeDomain(() => options.waitResumeCoordinator.resumeQuotaWait({
          workspaceId: actor.workspaceId,
          waitId: input.waitId,
          actor: { kind: "human", userId: actor.userId },
          idempotencyKey: actor.idempotencyKey,
        }));
        const wait = await quotaDomain(() => service.getWait({
          workspaceId: actor.workspaceId,
          waitId: input.waitId,
        }));
        if (!wait) {
          throw new CapabilityFailure({
            code: "QUOTA_UNAVAILABLE",
            category: "not_found",
            message: "Quota Wait resume evidence is unavailable.",
          });
        }
        return { wait: waitDto(wait) };
      },
    }),
  ];
}
