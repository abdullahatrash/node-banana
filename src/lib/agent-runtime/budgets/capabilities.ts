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
import { BudgetService, BudgetServiceError } from "./service";
import type {
  BudgetPolicy,
  BudgetPolicyRevision,
  BudgetReservation,
  WorkspacePricingOverride,
} from "./types";

export const BUDGET_CAPABILITY_IDENTITIES = {
  effectivePoliciesGet: { name: "budget_policies.get_effective", version: 1 },
  statusGet: { name: "budget_status.get", version: 1 },
  reservationsList: { name: "budget_reservations.list", version: 1 },
  policiesList: { name: "budget_policies.list", version: 1 },
  policyRevisionCreate: {
    name: "budget_policy_revisions.create",
    version: 1,
  },
  pricingOverridesList: { name: "pricing_overrides.list", version: 1 },
  pricingOverrideCreate: { name: "pricing_overrides.create", version: 1 },
  pricingOverrideRevoke: { name: "pricing_overrides.revoke", version: 1 },
  spendControlGet: { name: "spend_controls.get", version: 1 },
  spendControlGetV2: { name: "spend_controls.get", version: 2 },
  spendControlSuspend: { name: "spend_controls.suspend", version: 1 },
  spendControlSuspendV2: { name: "spend_controls.suspend", version: 2 },
  spendControlResume: { name: "spend_controls.resume", version: 1 },
  spendControlResumeV2: { name: "spend_controls.resume", version: 2 },
} as const;

type BudgetCapabilityName =
  typeof BUDGET_CAPABILITY_IDENTITIES[keyof typeof BUDGET_CAPABILITY_IDENTITIES]["name"];

export type BudgetCapabilityIdentity = `${BudgetCapabilityName}@1`;
export type BudgetHumanCapabilityIdentity = Exclude<
  BudgetCapabilityIdentity,
  "budget_policies.get_effective@1" | "budget_reservations.list@1"
>;

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
const currency = z.string().regex(/^[A-Z]{3}$/);
const isoDate = z.string().datetime({ offset: true });
const period = z.enum([
  "calendar_day",
  "calendar_week",
  "calendar_month",
  "lifetime",
]);
const pricingUnit = z.enum(["count", "byte", "millisecond", "megapixel"]);

const strictObject = (
  required: string[],
  properties: Record<string, JsonSchema>,
): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

const nullableString: JsonSchema = { type: ["string", "null"] };
const dateTime: JsonSchema = { type: "string", format: "date-time" };
const decimalSchema: JsonSchema = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
};

const policySchema = strictObject(
  [
    "schema",
    "id",
    "workspaceId",
    "principalId",
    "scope",
    "currency",
    "period",
    "timezone",
    "status",
    "currentRevisionId",
    "createdAt",
    "updatedAt",
  ],
  {
    schema: { const: "budget-policy/v1" },
    id: { type: "string" },
    workspaceId: { type: "string" },
    principalId: nullableString,
    scope: { type: "string", enum: ["workspace", "principal"] },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    period: {
      type: "string",
      enum: ["calendar_day", "calendar_week", "calendar_month", "lifetime"],
    },
    timezone: { type: "string" },
    status: { type: "string", enum: ["active", "revoked"] },
    currentRevisionId: { type: "string" },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
);

function revisionSchema(includeActor: boolean): JsonSchema {
  return strictObject(
    [
      "schema",
      "id",
      "policyId",
      "workspaceId",
      "principalId",
      "revision",
      "warningThreshold",
      "hardLimit",
      "unknownPriceTreatment",
      "unknownPriceAllowance",
      ...(includeActor ? ["createdByUserId"] : []),
      "createdAt",
    ],
    {
      schema: { const: "budget-policy-revision/v1" },
      id: { type: "string" },
      policyId: { type: "string" },
      workspaceId: { type: "string" },
      principalId: nullableString,
      revision: { type: "integer", minimum: 1 },
      warningThreshold: decimalSchema,
      hardLimit: decimalSchema,
      unknownPriceTreatment: {
        type: "string",
        enum: ["deny", "fixed_allowance"],
      },
      unknownPriceAllowance: { oneOf: [decimalSchema, { type: "null" }] },
      ...(includeActor ? { createdByUserId: { type: "string" } } : {}),
      createdAt: dateTime,
    },
  );
}

const periodWindowSchema = strictObject(
  ["kind", "timezone", "startsAt", "endsAt"],
  {
    kind: {
      type: "string",
      enum: ["calendar_day", "calendar_week", "calendar_month", "lifetime"],
    },
    timezone: { type: "string" },
    startsAt: dateTime,
    endsAt: { oneOf: [dateTime, { type: "null" }] },
  },
);

const reservationSchema = strictObject(
  [
    "schema",
    "id",
    "workspaceId",
    "principalId",
    "admittedPrincipalId",
    "runId",
    "policyId",
    "policyRevisionId",
    "scope",
    "period",
    "currency",
    "reservedAmount",
    "heldAmount",
    "settledAmount",
    "releasedAmount",
    "state",
    "pricingSnapshotIds",
    "createdAt",
    "updatedAt",
  ],
  {
    schema: { const: "budget-reservation/v1" },
    id: { type: "string" },
    workspaceId: { type: "string" },
    principalId: nullableString,
    admittedPrincipalId: { type: "string" },
    runId: { type: "string" },
    policyId: { type: "string" },
    policyRevisionId: { type: "string" },
    scope: { type: "string", enum: ["workspace", "principal"] },
    period: periodWindowSchema,
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    reservedAmount: decimalSchema,
    heldAmount: decimalSchema,
    settledAmount: decimalSchema,
    releasedAmount: decimalSchema,
    state: {
      type: "string",
      enum: ["held", "settled", "released", "outcome_unknown", "held_unknown_cost"],
    },
    pricingSnapshotIds: {
      type: "array",
      items: { type: "string" },
      uniqueItems: true,
    },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
);

const pricingOverrideSchema = strictObject(
  [
    "schema",
    "id",
    "workspaceId",
    "provider",
    "providerOperation",
    "model",
    "serviceTier",
    "dimension",
    "unit",
    "price",
    "currency",
    "perQuantity",
    "runCeiling",
    "sourceRef",
    "effectiveFrom",
    "status",
    "createdByUserId",
    "createdAt",
    "revokedAt",
    "revokedByUserId",
  ],
  {
    schema: { const: "workspace-pricing-override/v1" },
    id: { type: "string" },
    workspaceId: { type: "string" },
    provider: { type: "string" },
    providerOperation: { type: "string" },
    model: { type: "string" },
    serviceTier: { type: "string" },
    dimension: { type: "string" },
    unit: {
      type: "string",
      enum: ["count", "byte", "millisecond", "megapixel"],
    },
    price: decimalSchema,
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    perQuantity: decimalSchema,
    runCeiling: decimalSchema,
    sourceRef: { type: "string" },
    effectiveFrom: dateTime,
    status: { type: "string", enum: ["active", "revoked"] },
    createdByUserId: { type: "string" },
    createdAt: dateTime,
    revokedAt: { oneOf: [dateTime, { type: "null" }] },
    revokedByUserId: nullableString,
  },
);

const effectivePolicyListSchema = strictObject(
  ["schema", "items"],
  {
    schema: { const: "effective-budget-policy-list/v1" },
    items: {
      type: "array",
      items: strictObject(
        ["policy", "revision"],
        { policy: policySchema, revision: revisionSchema(false) },
      ),
      maxItems: 2,
    },
  },
);

const budgetStatusSchema = strictObject(
  ["schema", "workspaceId", "principalId", "evaluatedAt", "items"],
  {
    schema: { const: "budget-status/v1" },
    workspaceId: { type: "string" },
    principalId: { type: "string" },
    evaluatedAt: dateTime,
    items: {
      type: "array",
      maxItems: 2,
      items: strictObject(
        [
          "scope", "policyId", "policyRevisionId", "currency", "period",
          "warningThreshold", "hardLimit", "committed", "available",
          "warningState", "certainty", "unknownReservationCount",
        ],
        {
          scope: { type: "string", enum: ["workspace", "principal"] },
          policyId: { type: "string" },
          policyRevisionId: { type: "string" },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
          period: periodWindowSchema,
          warningThreshold: decimalSchema,
          hardLimit: decimalSchema,
          committed: decimalSchema,
          available: decimalSchema,
          warningState: {
            type: "string",
            enum: ["below_warning", "warning", "hard_limit_reached"],
          },
          certainty: {
            type: "string",
            enum: ["known", "contains_unknown_cost"],
          },
          unknownReservationCount: { type: "integer", minimum: 0 },
        },
      ),
    },
  },
);

const policyListSchema = strictObject(
  ["schema", "items"],
  {
    schema: { const: "budget-policy-list/v1" },
    items: {
      type: "array",
      items: strictObject(
        ["policy", "revision"],
        { policy: policySchema, revision: revisionSchema(true) },
      ),
    },
  },
);

const policyRevisionInputProperties: Record<string, JsonSchema> = {
  principalId: nullableString,
  currency: { type: "string", pattern: "^[A-Z]{3}$" },
  period: {
    type: "string",
    enum: ["calendar_day", "calendar_week", "calendar_month", "lifetime"],
  },
  timezone: { type: "string", minLength: 1, maxLength: 255 },
  warningThreshold: decimalSchema,
  hardLimit: decimalSchema,
};
const policyRevisionInputSchema: JsonSchema = {
  type: "object",
  oneOf: [
    strictObject(
      [
        "principalId", "currency", "period", "timezone", "warningThreshold",
        "hardLimit", "unknownPriceTreatment", "unknownPriceAllowance",
      ],
      {
        ...policyRevisionInputProperties,
        unknownPriceTreatment: { const: "deny" },
        unknownPriceAllowance: { type: "null" },
      },
    ),
    strictObject(
      [
        "principalId", "currency", "period", "timezone", "warningThreshold",
        "hardLimit", "unknownPriceTreatment", "unknownPriceAllowance",
      ],
      {
        ...policyRevisionInputProperties,
        unknownPriceTreatment: { const: "fixed_allowance" },
        unknownPriceAllowance: decimalSchema,
      },
    ),
  ],
};

const reservationListSchema = strictObject(
  ["schema", "items"],
  {
    schema: { const: "budget-reservation-list/v1" },
    items: { type: "array", items: reservationSchema },
  },
);

const pricingOverrideListSchema = strictObject(
  ["schema", "items"],
  {
    schema: { const: "workspace-pricing-override-list/v1" },
    items: { type: "array", items: pricingOverrideSchema },
  },
);

const spendControlSchema = strictObject(
  ["schema", "workspaceId", "suspended"],
  {
    schema: { const: "workspace-spend-control/v1" },
    workspaceId: { type: "string" },
    suspended: { type: "boolean" },
  },
);

const spendControlEvidenceSchema = strictObject(
  [
    "schema", "workspaceId", "suspended", "revision", "reason",
    "actorUserId", "recordedAt", "policyEventId", "authorizationEvidenceRef",
  ],
  {
    schema: { const: "workspace-spend-control/v2" },
    workspaceId: { type: "string" },
    suspended: { type: "boolean" },
    revision: { type: "integer", minimum: 0 },
    reason: nullableString,
    actorUserId: nullableString,
    recordedAt: { oneOf: [dateTime, { type: "null" }] },
    policyEventId: nullableString,
    authorizationEvidenceRef: nullableString,
  },
);

const spendControlMutationEvidenceSchema = strictObject(
  [
    "schema", "workspaceId", "suspended", "revision", "reason",
    "actorUserId", "recordedAt", "policyEventId", "authorizationEvidenceRef",
  ],
  {
    schema: { const: "workspace-spend-control/v2" },
    workspaceId: { type: "string" },
    suspended: { type: "boolean" },
    revision: { type: "integer", minimum: 1 },
    reason: { type: "string", minLength: 1, maxLength: 500 },
    actorUserId: { type: "string", minLength: 1 },
    recordedAt: dateTime,
    policyEventId: { type: "string", minLength: 1 },
    authorizationEvidenceRef: { type: "string", minLength: 1, maxLength: 200 },
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
    code: "BUDGET_INVALID_INPUT",
    category: "validation",
    retryable: false,
    description: "The Budget request violates a domain invariant.",
  },
  {
    code: "BUDGET_NOT_ADMISSIBLE",
    category: "conflict",
    retryable: false,
    description: "Current Budget state does not admit the request.",
  },
  {
    code: "BUDGET_CONFLICT",
    category: "conflict",
    retryable: false,
    description: "The request conflicts with current Budget state.",
  },
  {
    code: "BUDGET_UNAVAILABLE",
    category: "not_found",
    retryable: false,
    description: "The selected Budget resource is unavailable.",
  },
];

const sharedErrors: CapabilityErrorContract[] = [
  ...COMMON_DISCOVERY_ERRORS,
  humanErrors.find((error) => error.code === "BUDGET_INVALID_INPUT")!,
];

const spendControlReadErrors: CapabilityErrorContract[] = [
  ...COMMON_DISCOVERY_ERRORS,
  {
    code: "BUDGET_UNAVAILABLE",
    category: "internal",
    retryable: true,
    description: "Durable Emergency Spend Suspension evidence is unavailable or inconsistent.",
  },
];

function reader(context: ResolvedSecurityContext | undefined) {
  if (!context) {
    throw new CapabilityFailure({
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Budget evidence is not authorized.",
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
      message: "Budget administration requires a Workspace owner or admin.",
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
      message: "Idempotency-Key is required for this Budget mutation.",
    });
  }
  return actor as typeof actor & { idempotencyKey: string };
}

function spendControlAuthorizationEvidence(context: {
  authorizationAdmission?: { operatorTraceRef?: string };
}): string {
  const value = context.authorizationAdmission?.operatorTraceRef?.trim();
  if (!value || value.length > 200) {
    throw new CapabilityFailure({
      code: "BUDGET_UNAVAILABLE",
      category: "internal",
      message: "Emergency Spend Suspension authorization evidence is unavailable.",
      retryable: true,
    });
  }
  return value;
}

async function domain<T>(
  operation: () => Promise<T>,
  options: { unavailableIsInternal?: boolean } = {},
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof BudgetServiceError)) throw error;
    throw new CapabilityFailure({
      code: error.code,
      category:
        error.code === "BUDGET_INVALID_INPUT"
          ? "validation"
          : error.code === "BUDGET_UNAVAILABLE" && !options.unavailableIsInternal
            ? "not_found"
            : error.code === "BUDGET_UNAVAILABLE"
              ? "internal"
              : "conflict",
      message: error.message,
      retryable: error.code === "BUDGET_UNAVAILABLE" && options.unavailableIsInternal,
    });
  }
}

function policyDto(policy: BudgetPolicy) {
  return {
    ...policy,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  };
}

function revisionDto(revision: BudgetPolicyRevision, includeActor: boolean) {
  const { createdByUserId, ...safe } = revision;
  return {
    ...safe,
    ...(includeActor ? { createdByUserId } : {}),
    createdAt: revision.createdAt.toISOString(),
  };
}

function reservationDto(reservation: BudgetReservation) {
  return {
    ...reservation,
    period: {
      ...reservation.period,
      startsAt: reservation.period.startsAt.toISOString(),
      endsAt: reservation.period.endsAt?.toISOString() ?? null,
    },
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

function pricingOverrideDto(item: WorkspacePricingOverride) {
  return {
    ...item,
    effectiveFrom: item.effectiveFrom.toISOString(),
    createdAt: item.createdAt.toISOString(),
    revokedAt: item.revokedAt?.toISOString() ?? null,
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

export function createBudgetRegistrations(
  service: BudgetService,
  options: { now?: () => Date } = {},
): CapabilityRegistration[] {
  const now = options.now ?? (() => new Date());
  return [
    sharedRegistration({
      identity: BUDGET_CAPABILITY_IDENTITIES.effectivePoliciesGet,
      summary: "Read the effective Workspace and Agent Principal Budget policies.",
      lifecycle,
      input: z.object({ principalId: safeId.optional() }).strict(),
      outputSchema: effectivePolicyListSchema,
      handler: async (input, context) => {
        const caller = reader(context.securityContext);
        const principalId =
          caller.kind === "agent"
            ? caller.principalId
            : input.principalId;
        if (
          caller.kind === "agent" &&
          input.principalId &&
          input.principalId !== caller.principalId
        ) {
          throw new CapabilityFailure({
            code: "CAPABILITY_NOT_AUTHORIZED",
            category: "authorization",
            message: "Effective Budget policies are not authorized.",
          });
        }
        if (!principalId) {
          throw new CapabilityFailure({
            code: "BUDGET_INVALID_INPUT",
            category: "validation",
            message: "principalId is required for a human effective-policy read.",
          });
        }
        const items = await domain(() =>
          service.getEffectivePolicies({
            workspaceId: caller.workspaceId,
            principalId,
          }),
        );
        return {
          schema: "effective-budget-policy-list/v1" as const,
          items: items.map(({ policy, revision }) => ({
            policy: policyDto(policy),
            revision: revisionDto(revision, false),
          })),
        };
      },
    }),
    sharedRegistration({
      identity: BUDGET_CAPABILITY_IDENTITIES.statusGet,
      summary: "Read canonical current Budget warning and uncertainty status without deriving totals in a client.",
      lifecycle,
      input: z.object({ principalId: safeId.optional() }).strict(),
      outputSchema: budgetStatusSchema,
      handler: async (input, context) => {
        const caller = reader(context.securityContext);
        const principalId = caller.kind === "agent"
          ? caller.principalId
          : input.principalId;
        if (
          caller.kind === "agent" &&
          input.principalId &&
          input.principalId !== caller.principalId
        ) {
          throw new CapabilityFailure({
            code: "CAPABILITY_NOT_AUTHORIZED",
            category: "authorization",
            message: "Budget status is not authorized.",
          });
        }
        if (!principalId) {
          throw new CapabilityFailure({
            code: "BUDGET_INVALID_INPUT",
            category: "validation",
            message: "principalId is required for a human Budget status read.",
          });
        }
        const status = await domain(() => service.getCurrentStatus({
          workspaceId: caller.workspaceId,
          principalId,
          at: now(),
        }));
        return {
          schema: "budget-status/v1" as const,
          ...status,
          evaluatedAt: status.evaluatedAt.toISOString(),
          items: status.items.map((item) => ({
            ...item,
            period: {
              ...item.period,
              startsAt: item.period.startsAt.toISOString(),
              endsAt: item.period.endsAt?.toISOString() ?? null,
            },
          })),
        };
      },
    }),
    sharedRegistration({
      identity: BUDGET_CAPABILITY_IDENTITIES.reservationsList,
      summary: "List safe Budget Reservation evidence without payment or provider secrets.",
      lifecycle,
      input: z
        .object({ runId: safeId.optional(), principalId: safeId.optional() })
        .strict(),
      outputSchema: reservationListSchema,
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
            message: "Budget Reservations are not authorized.",
          });
        }
        const items = await domain(() =>
          service.listReservations({
            workspaceId: caller.workspaceId,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(caller.kind === "agent"
              ? { principalId: caller.principalId }
              : input.principalId
                ? { principalId: input.principalId }
                : {}),
          }),
        );
        return {
          schema: "budget-reservation-list/v1" as const,
          items: items.map(reservationDto),
        };
      },
    }),
    humanRegistration({
      identity: BUDGET_CAPABILITY_IDENTITIES.policiesList,
      summary: "List current Workspace and Agent Principal Budget policy revisions.",
      lifecycle,
      input: z.object({}).strict(),
      outputSchema: policyListSchema,
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (_input, context) => {
        const actor = administrator(context.securityContext);
        const items = await domain(() => service.listPolicies(actor.workspaceId));
        return {
          schema: "budget-policy-list/v1" as const,
          items: items.map(({ policy, revision }) => ({
            policy: policyDto(policy),
            revision: revisionDto(revision, true),
          })),
        };
      },
    }),
    humanRegistration({
      identity: BUDGET_CAPABILITY_IDENTITIES.policyRevisionCreate,
      summary: "Create an immutable revision of a Workspace or Agent Principal Budget policy.",
      lifecycle,
      input: z.discriminatedUnion("unknownPriceTreatment", [
        z.object({
          principalId: safeId.nullable(),
          currency,
          period,
          timezone: z.string().trim().min(1).max(255),
          warningThreshold: exactDecimal,
          hardLimit: exactDecimal,
          unknownPriceTreatment: z.literal("deny"),
          unknownPriceAllowance: z.null().optional().default(null),
        }).strict(),
        z.object({
          principalId: safeId.nullable(),
          currency,
          period,
          timezone: z.string().trim().min(1).max(255),
          warningThreshold: exactDecimal,
          hardLimit: exactDecimal,
          unknownPriceTreatment: z.literal("fixed_allowance"),
          unknownPriceAllowance: exactDecimal,
        }).strict(),
      ]),
      inputSchema: policyRevisionInputSchema,
      outputSchema: strictObject(
        ["policy", "revision"],
        { policy: policySchema, revision: revisionSchema(true) },
      ),
      effect: mutationEffect,
      idempotency: { mode: "key-required" },
      handler: async (input, context) => {
        const actor = mutationAdministrator(context.securityContext);
        const result = await domain(() =>
          service.createPolicyRevision({
            ...input,
            workspaceId: actor.workspaceId,
            actorUserId: actor.userId,
            idempotencyKey: actor.idempotencyKey,
            recordedAt: now(),
          }),
        );
        return {
          policy: policyDto(result.policy),
          revision: revisionDto(result.revision, true),
        };
      },
    }),
    humanRegistration({
      identity: BUDGET_CAPABILITY_IDENTITIES.pricingOverridesList,
      summary: "List versioned Workspace Pricing Overrides.",
      lifecycle,
      input: z.object({}).strict(),
      outputSchema: pricingOverrideListSchema,
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (_input, context) => {
        const actor = administrator(context.securityContext);
        const items = await domain(() =>
          service.listPricingOverrides(actor.workspaceId),
        );
        return {
          schema: "workspace-pricing-override-list/v1" as const,
          items: items.map(pricingOverrideDto),
        };
      },
    }),
    humanRegistration({
      identity: BUDGET_CAPABILITY_IDENTITIES.pricingOverrideCreate,
      summary: "Create a versioned Workspace Pricing Override for future admissions.",
      lifecycle,
      input: z.object({
        provider: safeId,
        providerOperation: safeId,
        model: safeId,
        serviceTier: safeId,
        dimension: z
          .string()
          .regex(/^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$/),
        unit: pricingUnit,
        price: exactDecimal,
        currency,
        perQuantity: exactDecimal,
        runCeiling: exactDecimal,
        sourceRef: safeId,
        effectiveFrom: isoDate,
      }).strict(),
      outputSchema: pricingOverrideSchema,
      effect: mutationEffect,
      idempotency: { mode: "key-required" },
      handler: async (input, context) => {
        const actor = mutationAdministrator(context.securityContext);
        const item = await domain(() =>
          service.createPricingOverride({
            ...input,
            effectiveFrom: new Date(input.effectiveFrom),
            workspaceId: actor.workspaceId,
            actorUserId: actor.userId,
            idempotencyKey: actor.idempotencyKey,
            recordedAt: now(),
          }),
        );
        return pricingOverrideDto(item);
      },
    }),
    humanRegistration({
      identity: BUDGET_CAPABILITY_IDENTITIES.pricingOverrideRevoke,
      summary: "Revoke one Workspace Pricing Override for future admissions.",
      lifecycle,
      input: z.object({ overrideId: safeId }).strict(),
      outputSchema: strictObject(
        ["overrideId", "revoked"],
        { overrideId: { type: "string" }, revoked: { const: true } },
      ),
      effect: mutationEffect,
      idempotency: { mode: "intrinsic" },
      handler: async (input, context) => {
        const actor = administrator(context.securityContext);
        await domain(() =>
          service.revokePricingOverride({
            workspaceId: actor.workspaceId,
            overrideId: input.overrideId,
            actorUserId: actor.userId,
            recordedAt: now(),
          }),
        );
        return { overrideId: input.overrideId, revoked: true as const };
      },
    }),
    humanRegistration({
      identity: BUDGET_CAPABILITY_IDENTITIES.spendControlGet,
      summary: "Read the Workspace Emergency Spend Suspension state.",
      lifecycle: { ...lifecycle, recommended: false },
      input: z.object({}).strict(),
      outputSchema: spendControlSchema,
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (_input, context) => {
        const actor = administrator(context.securityContext);
        const control = await domain(() =>
          service.getSpendControl(actor.workspaceId),
        );
        return { schema: "workspace-spend-control/v1" as const, ...control };
      },
    }),
    ...([true, false] as const).map((suspended) =>
      humanRegistration({
        identity: suspended
          ? BUDGET_CAPABILITY_IDENTITIES.spendControlSuspend
          : BUDGET_CAPABILITY_IDENTITIES.spendControlResume,
        summary: suspended
          ? "Suspend new and not-yet-started Workspace provider spend."
          : "Resume Workspace provider spend after an emergency suspension.",
        lifecycle: { ...lifecycle, recommended: false },
        input: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
        outputSchema: spendControlSchema,
        effect: mutationEffect,
        idempotency: { mode: "intrinsic" },
        handler: async (input, context) => {
          const actor = administrator(context.securityContext);
          await domain(() =>
            service.setSpendSuspended({
              workspaceId: actor.workspaceId,
              suspended,
              reason: input.reason,
              actorUserId: actor.userId,
              recordedAt: now(),
            }),
          );
          return {
            schema: "workspace-spend-control/v1" as const,
            workspaceId: actor.workspaceId,
            suspended,
          };
        },
      }),
    ),
    defineCapability({
      identity: BUDGET_CAPABILITY_IDENTITIES.spendControlGetV2,
      audience: "shared",
      summary: "Read durable Workspace Emergency Spend Suspension policy and security evidence.",
      lifecycle,
      input: z.object({}).strict(),
      outputSchema: spendControlEvidenceSchema,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: spendControlReadErrors,
      handler: async (_input, context) => {
        const actor = reader(context.securityContext);
        const evidence = await domain(
          () => service.getSpendControlEvidence(actor.workspaceId),
          { unavailableIsInternal: true },
        );
        return evidence
          ? {
              schema: "workspace-spend-control/v2" as const,
              ...evidence,
              actorUserId: actor.kind === "human" ? evidence.actorUserId : null,
              recordedAt: evidence.recordedAt.toISOString(),
              authorizationEvidenceRef: actor.kind === "human"
                ? evidence.authorizationEvidenceRef
                : null,
            }
          : {
              schema: "workspace-spend-control/v2" as const,
              workspaceId: actor.workspaceId,
              suspended: false,
              revision: 0,
              reason: null,
              actorUserId: null,
              recordedAt: null,
              policyEventId: null,
              authorizationEvidenceRef: null,
            };
      },
    }),
    ...([true, false] as const).map((suspended) =>
      humanRegistration({
        identity: suspended
          ? BUDGET_CAPABILITY_IDENTITIES.spendControlSuspendV2
          : BUDGET_CAPABILITY_IDENTITIES.spendControlResumeV2,
        summary: suspended
          ? "Suspend future Workspace provider spend and return exact durable policy/security evidence."
          : "Remove Emergency Spend Suspension and return exact durable policy/security evidence.",
        lifecycle,
        input: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
        outputSchema: spendControlMutationEvidenceSchema,
        effect: mutationEffect,
        idempotency: { mode: "intrinsic" },
        handler: async (input, context) => {
          const actor = administrator(context.securityContext);
          const evidence = await domain(() =>
            service.setSpendSuspendedWithEvidence({
              workspaceId: actor.workspaceId,
              suspended,
              reason: input.reason,
              actorUserId: actor.userId,
              authorizationEvidenceRef: spendControlAuthorizationEvidence(context),
              recordedAt: now(),
            }),
          );
          return {
            schema: "workspace-spend-control/v2" as const,
            ...evidence,
            recordedAt: evidence.recordedAt.toISOString(),
          };
        },
      }),
    ),
  ];
}
