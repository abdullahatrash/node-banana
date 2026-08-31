import { z } from "zod";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
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
import { ObservabilityError } from "./errors";
import { ObservabilityService } from "./service";
import type {
  DiagnosticTrace,
  OperationalMetricAggregate,
  ObservabilityRetentionPolicy,
  ObservabilityRetentionRevision,
  SupportBundleAuditEvent,
  SupportBundleDto,
  WorkspaceTelemetryOperatorGrant,
} from "./types";
import { SupportBundleApplication } from "./support-bundles";

export const OBSERVABILITY_CAPABILITY_IDENTITIES = {
  metricsList: { name: "operational_metrics.list", version: 1 },
  retentionGet: { name: "observability_retention.get", version: 1 },
  retentionSet: { name: "observability_retention.set", version: 1 },
  operatorGrantsList: { name: "telemetry_operator_grants.list", version: 1 },
  operatorGrantIssue: { name: "telemetry_operator_grants.issue", version: 1 },
  operatorGrantRevoke: { name: "telemetry_operator_grants.revoke", version: 1 },
  traceGet: { name: "diagnostic_traces.get", version: 1 },
  supportBundleCreate: { name: "support_bundles.create", version: 1 },
  supportBundleGet: { name: "support_bundles.get", version: 1 },
  supportBundlePayloadGet: { name: "support_bundles.payload.get", version: 1 },
  supportBundleRevoke: { name: "support_bundles.revoke", version: 1 },
  supportBundleAuditList: { name: "support_bundle_audit.list", version: 1 },
} as const;

type ObservabilityCapabilityName =
  typeof OBSERVABILITY_CAPABILITY_IDENTITIES[keyof typeof OBSERVABILITY_CAPABILITY_IDENTITIES]["name"];

export type ObservabilityCapabilityIdentity = `${ObservabilityCapabilityName}@1`;

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
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/);
const operatorTraceRef = z.string().regex(/^otr_[a-f0-9]{32}$/);
const isoDate = z.string().datetime({ offset: true });
const ttlSeconds = z.number().int().min(60).max(31_536_000);
const operatorScope = z.enum(["trace.read", "support_bundle.read"]);

function strictObject(
  required: string[],
  properties: Record<string, JsonSchema>,
): JsonSchema {
  return { type: "object", additionalProperties: false, required, properties };
}

const dateTime: JsonSchema = { type: "string", format: "date-time" };
const nullableString: JsonSchema = { type: ["string", "null"] };

const dimensionSchema: JsonSchema = {
  oneOf: [
    ["status", ["accepted", "waiting", "completed", "failed", "outcome_unknown"]],
    ["outcome", ["succeeded", "failed_known", "outcome_unknown", "denied", "wait"]],
    ["boundary", ["run_admission", "run_concurrency", "provider_effect", "usage_settlement", "artifact_storage"]],
    ["provider_family", ["google", "openai", "kie", "internal", "unknown"]],
    ["operation_family", ["workflow", "text", "image", "audio", "video", "storage", "unknown"]],
    ["reason_family", ["capacity", "policy", "suspension", "provider", "persistence", "validation", "unknown"]],
    ["scope", ["workspace", "principal"]],
  ].map(([key, values]) =>
    strictObject(["key", "value"], {
      key: { const: key },
      value: { type: "string", enum: values as string[] },
    }),
  ),
};

const metricSchema = strictObject(
  [
    "schema",
    "name",
    "dimensions",
    "windowStartsAt",
    "windowEndsAt",
    "count",
    "sum",
    "recordedAt",
  ],
  {
    schema: { const: "operational-metric-aggregate/v1" },
    name: {
      type: "string",
      enum: [
        "runtime.run.count",
        "runtime.provider.effect.count",
        "runtime.quota.decision.count",
        "runtime.artifact.bytes",
        "runtime.queue.wait_ms",
      ],
    },
    dimensions: { type: "array", maxItems: 4, items: dimensionSchema },
    windowStartsAt: dateTime,
    windowEndsAt: dateTime,
    count: { type: "integer", minimum: 0 },
    sum: { type: "number" },
    recordedAt: dateTime,
  },
);

const metricsPageSchema = strictObject(["schema", "items", "nextCursor"], {
  schema: { const: "operational-metric-page/v1" },
  items: { type: "array", maxItems: 100, items: metricSchema },
  nextCursor: nullableString,
});

const retentionPolicySchema = strictObject(
  ["schema", "id", "status", "currentRevisionId", "createdAt", "updatedAt"],
  {
    schema: { const: "observability-retention-policy/v1" },
    id: { type: "string" },
    status: { type: "string", enum: ["active", "expired"] },
    currentRevisionId: { type: "string" },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
);

const retentionRevisionSchema = strictObject(
  [
    "schema",
    "id",
    "policyId",
    "revision",
    "metricTtlSeconds",
    "traceTtlSeconds",
    "supportBundleTtlSeconds",
    "createdAt",
  ],
  {
    schema: { const: "observability-retention-revision/v1" },
    id: { type: "string" },
    policyId: { type: "string" },
    revision: { type: "integer", minimum: 1 },
    metricTtlSeconds: { type: "integer", minimum: 60 },
    traceTtlSeconds: { type: "integer", minimum: 60, maximum: 2_592_000 },
    supportBundleTtlSeconds: {
      type: "integer",
      minimum: 60,
      maximum: 604_800,
    },
    createdAt: dateTime,
  },
);

const retentionResultSchema = strictObject(["policy", "revision"], {
  policy: retentionPolicySchema,
  revision: retentionRevisionSchema,
});

const operatorGrantSchema = strictObject(
  ["schema", "id", "scopes", "status", "issuedAt", "expiresAt", "revokedAt"],
  {
    schema: { const: "workspace-telemetry-operator-grant/v1" },
    id: { type: "string" },
    scopes: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
      items: { type: "string", enum: operatorScope.options },
    },
    status: { type: "string", enum: ["active", "revoked", "expired"] },
    issuedAt: dateTime,
    expiresAt: dateTime,
    revokedAt: { oneOf: [dateTime, { type: "null" }] },
  },
);

const traceSchema = strictObject(
  [
    "schema",
    "operatorTraceRef",
    "category",
    "severity",
    "code",
    "stage",
    "outcome",
    "providerFamily",
    "httpStatus",
    "retryable",
    "durationMs",
    "attempt",
    "createdAt",
    "expiresAt",
  ],
  {
    schema: { const: "diagnostic-trace/v1" },
    operatorTraceRef: { type: "string", pattern: "^otr_[a-f0-9]{32}$" },
    category: {
      type: "string",
      enum: ["authorization", "provider", "persistence", "quota", "budget", "artifact", "runtime"],
    },
    severity: { type: "string", enum: ["info", "warning", "error"] },
    code: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,79}$" },
    stage: {
      type: "string",
      enum: ["admission", "planning", "execution", "settlement", "reconciliation", "storage"],
    },
    outcome: { type: "string", enum: ["succeeded", "failed", "unknown", "denied", "waiting"] },
    providerFamily: { type: "string", enum: ["google", "openai", "kie", "internal", "unknown"] },
    httpStatus: { type: ["integer", "null"], minimum: 100, maximum: 599 },
    retryable: { type: ["boolean", "null"] },
    durationMs: { type: ["integer", "null"], minimum: 0 },
    attempt: { type: ["integer", "null"], minimum: 1 },
    createdAt: dateTime,
    expiresAt: dateTime,
  },
);

const evidenceReferenceSchema = strictObject(
  ["schema", "resourceKind", "resourceId", "version", "digest"],
  {
    schema: { const: "contract-evidence-reference/v1" },
    resourceKind: {
      type: "string",
      enum: [
        "run",
        "run_event",
        "artifact",
        "usage_record",
        "cost_valuation",
        "budget_reservation",
        "quota_reservation",
        "quota_wait",
      ],
    },
    resourceId: { type: "string" },
    version: { type: "integer", minimum: 1 },
    digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
  },
);

const bundleSelectionSchema = strictObject(
  ["reference", "projectionKind", "projectedContentDigest", "projectedSizeBytes"],
  {
    reference: evidenceReferenceSchema,
    projectionKind: {
      type: "string",
      enum: [
        "run_summary",
        "run_event_summary",
        "artifact_metadata",
        "usage_summary",
        "cost_summary",
        "budget_summary",
        "quota_reservation_summary",
        "quota_wait_summary",
      ],
    },
    projectedContentDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    projectedSizeBytes: { type: "integer", minimum: 1 },
  },
);

const bundleSchema = strictObject(
  [
    "schema",
    "id",
    "state",
    "selections",
    "purpose",
    "selectionDigest",
    "contentDigest",
    "sizeBytes",
    "createdAt",
    "expiresAt",
    "storedAt",
  ],
  {
    schema: { const: "support-bundle/v1" },
    id: { type: "string" },
    state: { type: "string", enum: ["stored", "expired", "revoked"] },
    selections: { type: "array", minItems: 1, maxItems: 100, items: bundleSelectionSchema },
    purpose: { type: "string", enum: ["incident_diagnosis", "support_case"] },
    selectionDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    contentDigest: {
      oneOf: [
        { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        { type: "null" },
      ],
    },
    sizeBytes: { type: "integer", minimum: 1 },
    createdAt: dateTime,
    expiresAt: dateTime,
    storedAt: dateTime,
  },
);

const bundlePayloadSchema = strictObject(
  ["bundle", "content"],
  {
    bundle: bundleSchema,
    content: strictObject(
      ["mediaType", "encoding", "data", "digest", "sizeBytes"],
      {
        mediaType: { const: "application/json" },
        encoding: { const: "base64" },
        data: { type: "string", pattern: "^[A-Za-z0-9+/]*={0,2}$" },
        digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        sizeBytes: { type: "integer", minimum: 1, maximum: 10_000_000 },
      },
    ),
  },
);

const selectionRequest = z.discriminatedUnion("resourceKind", [
  z.object({ resourceKind: z.literal("run"), resourceId: safeId, projectionKind: z.literal("run_summary") }).strict(),
  z.object({ resourceKind: z.literal("run_event"), resourceId: safeId, projectionKind: z.literal("run_event_summary") }).strict(),
  z.object({ resourceKind: z.literal("artifact"), resourceId: safeId, projectionKind: z.literal("artifact_metadata") }).strict(),
  z.object({ resourceKind: z.literal("usage_record"), resourceId: safeId, projectionKind: z.literal("usage_summary") }).strict(),
  z.object({ resourceKind: z.literal("cost_valuation"), resourceId: safeId, projectionKind: z.literal("cost_summary") }).strict(),
  z.object({ resourceKind: z.literal("budget_reservation"), resourceId: safeId, projectionKind: z.literal("budget_summary") }).strict(),
  z.object({ resourceKind: z.literal("quota_reservation"), resourceId: safeId, projectionKind: z.literal("quota_reservation_summary") }).strict(),
  z.object({ resourceKind: z.literal("quota_wait"), resourceId: safeId, projectionKind: z.literal("quota_wait_summary") }).strict(),
]);

const supportAuditSchema = strictObject(
  ["schema", "id", "bundleId", "eventType", "actorType", "occurredAt"],
  {
    schema: { const: "support-bundle-audit-event/v1" },
    id: { type: "string" },
    bundleId: { type: "string" },
    eventType: {
      type: "string",
      enum: ["bundle.stored", "bundle.expired", "bundle.revoked", "bundle.read", "bundle.read_denied"],
    },
    actorType: { type: "string", enum: ["user", "operator", "system"] },
    occurredAt: dateTime,
  },
);

const errors: CapabilityErrorContract[] = [
  ...COMMON_DISCOVERY_ERRORS,
  {
    code: "OBSERVABILITY_INVALID_INPUT",
    category: "validation",
    retryable: false,
    description: "The observability request is invalid.",
  },
  {
    code: "OBSERVABILITY_CONFLICT",
    category: "conflict",
    retryable: false,
    description: "The mutation conflicts with immutable observability evidence.",
  },
  {
    code: "OBSERVABILITY_UNAVAILABLE",
    category: "not_found",
    retryable: false,
    description: "The selected observability resource is unavailable.",
  },
];

const humanErrors: CapabilityErrorContract[] = [
  ...errors,
  {
    code: "HUMAN_CAPABILITY_NOT_AUTHORIZED",
    category: "authorization",
    retryable: false,
    description: "An authenticated Workspace member with the required role is required.",
  },
  {
    code: "IDEMPOTENCY_KEY_REQUIRED",
    category: "validation",
    retryable: false,
    description: "A transport Idempotency-Key is required for this mutation.",
  },
];

function security(context: ResolvedSecurityContext | undefined) {
  if (!context) {
    throw new CapabilityFailure({
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Observability evidence is not authorized.",
    });
  }
  return context;
}

function human(context: ResolvedSecurityContext | undefined) {
  const actor = security(context);
  if (actor.kind !== "human") {
    throw new CapabilityFailure({
      code: "HUMAN_CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Observability operator access requires a human Workspace member.",
    });
  }
  return actor;
}

function administrator(context: ResolvedSecurityContext | undefined) {
  const actor = human(context);
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new CapabilityFailure({
      code: "HUMAN_CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Observability administration requires a Workspace owner or admin.",
    });
  }
  return actor;
}

function mutationAdministrator(context: ResolvedSecurityContext | undefined) {
  const actor = administrator(context);
  if (!actor.idempotencyKey) {
    throw new CapabilityFailure({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      category: "validation",
      message: "Idempotency-Key is required for this observability mutation.",
    });
  }
  return actor as typeof actor & { idempotencyKey: string };
}

async function domain<T>(
  operation: () => Promise<T>,
  options: { nonEnumerating?: boolean } = {},
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ObservabilityError)) throw error;
    const hidden =
      options.nonEnumerating &&
      (error.code === "OBSERVABILITY_FORBIDDEN" ||
        error.code === "OBSERVABILITY_UNAVAILABLE");
    throw new CapabilityFailure({
      code: hidden ? "OBSERVABILITY_UNAVAILABLE" : error.code,
      category:
        hidden || error.code === "OBSERVABILITY_UNAVAILABLE"
          ? "not_found"
          : error.code === "OBSERVABILITY_INVALID_INPUT"
            ? "validation"
            : error.code === "OBSERVABILITY_CONFLICT"
              ? "conflict"
              : "authorization",
      message: hidden
        ? "The selected observability resource is unavailable."
        : error.message,
    });
  }
}

function metricDto(metric: OperationalMetricAggregate) {
  return {
    schema: metric.schema,
    name: metric.name,
    dimensions: metric.dimensions.map(({ key, value }) => ({ key, value })),
    windowStartsAt: metric.windowStartsAt.toISOString(),
    windowEndsAt: metric.windowEndsAt.toISOString(),
    count: metric.count,
    sum: metric.sum,
    recordedAt: metric.recordedAt.toISOString(),
  };
}

function retentionDto(input: {
  policy: ObservabilityRetentionPolicy;
  revision: ObservabilityRetentionRevision;
}) {
  const { policy, revision } = input;
  return {
    policy: {
      schema: policy.schema,
      id: policy.id,
      status: policy.status,
      currentRevisionId: policy.currentRevisionId,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    },
    revision: {
      schema: revision.schema,
      id: revision.id,
      policyId: revision.policyId,
      revision: revision.revision,
      metricTtlSeconds: revision.metricTtlSeconds,
      traceTtlSeconds: revision.traceTtlSeconds,
      supportBundleTtlSeconds: revision.supportBundleTtlSeconds,
      createdAt: revision.createdAt.toISOString(),
    },
  };
}

function grantDto(grant: WorkspaceTelemetryOperatorGrant) {
  return {
    schema: grant.schema,
    id: grant.id,
    scopes: [...grant.scopes],
    status: grant.status,
    issuedAt: grant.issuedAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
  };
}

function traceDto(trace: DiagnosticTrace) {
  return {
    schema: trace.schema,
    operatorTraceRef: trace.operatorTraceRef,
    category: trace.category,
    severity: trace.severity,
    code: trace.code,
    stage: trace.stage,
    outcome: trace.outcome,
    providerFamily: trace.providerFamily,
    httpStatus: trace.httpStatus,
    retryable: trace.retryable,
    durationMs: trace.durationMs,
    attempt: trace.attempt,
    createdAt: trace.createdAt.toISOString(),
    expiresAt: trace.expiresAt.toISOString(),
  };
}

function bundleDto(bundle: SupportBundleDto) {
  return {
    schema: bundle.schema,
    id: bundle.id,
    state: bundle.state,
    selections: bundle.selections.map((selection) => ({
      reference: {
        schema: selection.reference.schema,
        resourceKind: selection.reference.resourceKind,
        resourceId: selection.reference.resourceId,
        version: selection.reference.version,
        digest: selection.reference.digest,
      },
      projectionKind: selection.projectionKind,
      projectedContentDigest: selection.projectedContentDigest,
      projectedSizeBytes: selection.projectedSizeBytes,
    })),
    purpose: bundle.consent.purpose,
    selectionDigest: bundle.consent.selectionDigest,
    contentDigest: bundle.contentDigest,
    sizeBytes: bundle.sizeBytes,
    createdAt: bundle.createdAt.toISOString(),
    expiresAt: bundle.expiresAt.toISOString(),
    storedAt: bundle.storedAt.toISOString(),
  };
}

function supportAuditDto(event: SupportBundleAuditEvent) {
  return {
    schema: event.schema,
    id: event.id,
    bundleId: event.bundleId,
    eventType: event.eventType,
    actorType: event.actorType,
    occurredAt: event.occurredAt.toISOString(),
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
    errors,
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

export function createObservabilityRegistrations(
  service: ObservabilityService,
  supportBundles: SupportBundleApplication,
  options: { now?: () => Date } = {},
): CapabilityRegistration[] {
  const now = options.now ?? (() => new Date());
  return [
    sharedRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.metricsList,
      summary: "List bounded, low-cardinality operational metric aggregates.",
      lifecycle,
      input: z.object({ cursor: z.string().max(4096).nullable().default(null), limit: z.number().int().min(1).max(100).default(50) }).strict(),
      outputSchema: metricsPageSchema,
      handler: async (input, context) => {
        const caller = security(context.securityContext);
        const result = await domain(() => service.listMetrics({ workspaceId: caller.workspaceId, cursor: input.cursor, limit: input.limit, at: now() }));
        return { schema: "operational-metric-page/v1" as const, items: result.metrics.map(metricDto), nextCursor: result.nextCursor };
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.retentionGet,
      summary: "Read the current versioned Workspace observability retention policy.",
      lifecycle,
      input: z.object({}).strict(),
      outputSchema: retentionResultSchema,
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (_input, context) => {
        const actor = administrator(context.securityContext);
        const current = await domain(() => service.getRetention({ workspaceId: actor.workspaceId }));
        if (!current) throw new CapabilityFailure({ code: "OBSERVABILITY_UNAVAILABLE", category: "not_found", message: "The selected observability resource is unavailable." });
        return retentionDto(current);
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.retentionSet,
      summary: "Narrow the versioned Workspace observability retention policy.",
      lifecycle,
      input: z.object({ metricTtlSeconds: ttlSeconds, traceTtlSeconds: ttlSeconds.max(2_592_000), supportBundleTtlSeconds: ttlSeconds.max(604_800) }).strict(),
      outputSchema: retentionResultSchema,
      effect: mutationEffect,
      idempotency: { mode: "key-required" },
      handler: async (input, context) => {
        const actor = mutationAdministrator(context.securityContext);
        return retentionDto(await domain(() => service.setRetention({ ...input, workspaceId: actor.workspaceId, actorUserId: actor.userId, idempotencyKey: actor.idempotencyKey, recordedAt: now() })));
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.operatorGrantsList,
      summary: "List active, unexpired Telemetry Operator Grants for the authenticated operator.",
      lifecycle,
      input: z.object({ limit: z.number().int().min(1).max(100).default(50) }).strict(),
      outputSchema: strictObject(["schema", "items"], { schema: { const: "telemetry-operator-grant-list/v1" }, items: { type: "array", maxItems: 100, items: operatorGrantSchema } }),
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (input, context) => {
        const actor = human(context.securityContext);
        const grants = await domain(() => service.listOperatorGrants({ workspaceId: actor.workspaceId, operatorId: actor.userId, at: now(), limit: input.limit }));
        return { schema: "telemetry-operator-grant-list/v1" as const, items: grants.map(grantDto) };
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.operatorGrantIssue,
      summary: "Issue a time-bounded Telemetry Operator Grant to the authenticated operator.",
      lifecycle,
      input: z.object({ scopes: z.array(operatorScope).min(1).max(2).refine((values) => new Set(values).size === values.length), expiresAt: isoDate }).strict(),
      outputSchema: operatorGrantSchema,
      effect: mutationEffect,
      idempotency: { mode: "key-required" },
      handler: async (input, context) => {
        const actor = mutationAdministrator(context.securityContext);
        const grant = await domain(() => service.issueOperatorGrant({ workspaceId: actor.workspaceId, operatorId: actor.userId, scopes: input.scopes, expiresAt: new Date(input.expiresAt), issuedByUserId: actor.userId, actorRole: actor.role, idempotencyKey: actor.idempotencyKey, recordedAt: now() }));
        return grantDto(grant);
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.operatorGrantRevoke,
      summary: "Revoke one Telemetry Operator Grant in the authenticated Workspace.",
      lifecycle,
      input: z.object({ grantId: safeId }).strict(),
      outputSchema: strictObject(["grantId", "revoked"], { grantId: { type: "string" }, revoked: { const: true } }),
      effect: mutationEffect,
      idempotency: { mode: "intrinsic" },
      handler: async (input, context) => {
        const actor = administrator(context.securityContext);
        await domain(() => service.revokeOperatorGrant({ workspaceId: actor.workspaceId, grantId: input.grantId, revokedByUserId: actor.userId, actorRole: actor.role, recordedAt: now() }));
        return { grantId: input.grantId, revoked: true as const };
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.traceGet,
      summary: "Read one sanitized Diagnostic Trace through an active operator grant.",
      lifecycle,
      input: z.object({ operatorTraceRef, operatorGrantId: safeId }).strict(),
      outputSchema: traceSchema,
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (input, context) => {
        const actor = human(context.securityContext);
        const trace = await domain(() => service.readTrace({ workspaceId: actor.workspaceId, operatorTraceRef: input.operatorTraceRef, operatorGrantId: input.operatorGrantId, operatorId: actor.userId, at: now() }), { nonEnumerating: true });
        if (!trace) throw new CapabilityFailure({ code: "OBSERVABILITY_UNAVAILABLE", category: "not_found", message: "The selected observability resource is unavailable." });
        return traceDto(trace);
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.supportBundleCreate,
      summary: "Freeze exact, explicitly consented canonical evidence projections into a short-lived Support Bundle.",
      lifecycle,
      input: z.object({
        selections: z.array(selectionRequest).min(1).max(100),
        purpose: z.enum(["incident_diagnosis", "support_case"]),
        consentExpiresAt: isoDate,
        consentConfirmed: z.literal(true),
      }).strict(),
      outputSchema: bundleSchema,
      effect: mutationEffect,
      idempotency: { mode: "key-required" },
      handler: async (input, context) => {
        const actor = mutationAdministrator(context.securityContext);
        const bundle = await domain(() => supportBundles.create({
          workspaceId: actor.workspaceId,
          actorUserId: actor.userId,
          selections: input.selections,
          purpose: input.purpose,
          consentExpiresAt: new Date(input.consentExpiresAt),
          idempotencyKey: actor.idempotencyKey,
          recordedAt: now(),
        }), { nonEnumerating: true });
        return bundleDto(bundle);
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.supportBundleGet,
      summary: "Read frozen Support Bundle metadata through an active operator grant.",
      lifecycle,
      input: z.object({ bundleId: safeId, operatorGrantId: safeId }).strict(),
      outputSchema: bundleSchema,
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (input, context) => {
        const actor = human(context.securityContext);
        const bundle = await domain(() => service.readSupportBundle({ workspaceId: actor.workspaceId, bundleId: input.bundleId, operatorGrantId: input.operatorGrantId, operatorId: actor.userId, at: now() }), { nonEnumerating: true });
        if (!bundle) throw new CapabilityFailure({ code: "OBSERVABILITY_UNAVAILABLE", category: "not_found", message: "The selected observability resource is unavailable." });
        return bundleDto(bundle);
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.supportBundlePayloadGet,
      summary: "Read and integrity-verify the immutable selected content of one authorized Support Bundle.",
      lifecycle,
      input: z.object({ bundleId: safeId, operatorGrantId: safeId }).strict(),
      outputSchema: bundlePayloadSchema,
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (input, context) => {
        const actor = human(context.securityContext);
        const result = await domain(() => supportBundles.readPayload({ workspaceId: actor.workspaceId, bundleId: input.bundleId, operatorGrantId: input.operatorGrantId, operatorId: actor.userId, at: now() }), { nonEnumerating: true });
        if (!result) throw new CapabilityFailure({ code: "OBSERVABILITY_UNAVAILABLE", category: "not_found", message: "The selected observability resource is unavailable." });
        const serialized = canonicalJson(result.payload);
        const bytes = Buffer.from(serialized, "utf8");
        return {
          bundle: bundleDto(result.bundle),
          content: {
            mediaType: "application/json" as const,
            encoding: "base64" as const,
            data: bytes.toString("base64"),
            digest: canonicalDigest(result.payload),
            sizeBytes: bytes.byteLength,
          },
        };
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.supportBundleRevoke,
      summary: "Revoke one frozen Support Bundle before its automatic expiry.",
      lifecycle,
      input: z.object({ bundleId: safeId }).strict(),
      outputSchema: strictObject(["bundleId", "revoked"], { bundleId: { type: "string" }, revoked: { const: true } }),
      effect: mutationEffect,
      idempotency: { mode: "intrinsic" },
      handler: async (input, context) => {
        const actor = administrator(context.securityContext);
        await domain(() => supportBundles.revoke({ workspaceId: actor.workspaceId, bundleId: input.bundleId, actorUserId: actor.userId, actorRole: actor.role, recordedAt: now() }));
        return { bundleId: input.bundleId, revoked: true as const };
      },
    }),
    humanRegistration({
      identity: OBSERVABILITY_CAPABILITY_IDENTITIES.supportBundleAuditList,
      summary: "List the audited lifecycle and access history of one authorized Support Bundle.",
      lifecycle,
      input: z.object({ bundleId: safeId, operatorGrantId: safeId, limit: z.number().int().min(1).max(100).default(100) }).strict(),
      outputSchema: strictObject(["schema", "items"], { schema: { const: "support-bundle-audit-list/v1" }, items: { type: "array", maxItems: 100, items: supportAuditSchema } }),
      effect: QUERY_EFFECT,
      idempotency: { mode: "retry-safe" },
      handler: async (input, context) => {
        const actor = human(context.securityContext);
        const bundle = await domain(() => service.readSupportBundle({ workspaceId: actor.workspaceId, bundleId: input.bundleId, operatorGrantId: input.operatorGrantId, operatorId: actor.userId, at: now() }), { nonEnumerating: true });
        if (!bundle) throw new CapabilityFailure({ code: "OBSERVABILITY_UNAVAILABLE", category: "not_found", message: "The selected observability resource is unavailable." });
        const events = await domain(() => service.listSupportBundleAudit({ workspaceId: actor.workspaceId, bundleId: input.bundleId, limit: input.limit }), { nonEnumerating: true });
        return { schema: "support-bundle-audit-list/v1" as const, items: events.map(supportAuditDto) };
      },
    }),
  ];
}
