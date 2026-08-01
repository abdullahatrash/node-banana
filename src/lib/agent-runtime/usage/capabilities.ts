import { z } from "zod";
import {
  COMMON_DISCOVERY_ERRORS,
  QUERY_EFFECT,
  defineCapability,
} from "@/lib/agent-tools/registry";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { CapabilityRegistration, JsonSchema, ResolvedSecurityContext } from "@/types/capabilities";
import { UsageLedgerService, UsageServiceError } from "./service";
import type { UsageCursorCodec } from "./cursor";
import type { PricingSource, UsageMeteringEvent } from "./types";

export const USAGE_CAPABILITY_IDENTITIES = {
  recordGet: { name: "usage_records.get", version: 1 },
  recordList: { name: "usage_records.list", version: 1 },
  valuationGet: { name: "cost_valuations.get", version: 1 },
  valuationList: { name: "cost_valuations.list", version: 1 },
  summaryGet: { name: "usage_summaries.get", version: 1 },
  eventList: { name: "usage_events.list", version: 1 },
  agentViewGet: { name: "agent_usage.get", version: 1 },
} as const;

export type UsageCapabilityIdentity =
  `${typeof USAGE_CAPABILITY_IDENTITIES[keyof typeof USAGE_CAPABILITY_IDENTITIES]["name"]}@1`;

const lifecycle = {
  status: "active",
  introducedAt: "2026-08-01T00:00:00.000Z",
  recommended: true,
} as const;
const id = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const safeName = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:/-]+$/);
const isoDate = z.string().datetime({ offset: true });
const interval = {
  from: isoDate.optional(),
  to: isoDate.optional(),
};
const limit = z.number().int().min(1).max(100).default(50);
const cursor = z.string().min(1).max(2_048).optional();
const strictObject = (
  required: string[],
  properties: Record<string, JsonSchema>,
): JsonSchema => ({ type: "object", additionalProperties: false, required, properties });
const nullableString: JsonSchema = { type: ["string", "null"] };
const decimal: JsonSchema = { type: "string", pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$" };
const dateTime: JsonSchema = { type: "string", format: "date-time" };
const bindingSchema = strictObject(
  ["workspaceId", "principalId", "workflowId", "runId", "stepAttemptId", "stepId", "attempt", "provider", "providerOperation", "providerOperationRef", "model", "effectKey"],
  {
    workspaceId: { type: "string" }, principalId: { type: "string" }, workflowId: { type: "string" },
    runId: { type: "string" }, stepAttemptId: { type: "string" }, stepId: { type: "string" },
    attempt: { type: "integer", minimum: 1 }, provider: { type: "string" }, providerOperation: { type: "string" },
    providerOperationRef: nullableString, model: { type: "string" }, effectKey: { type: "string" },
  },
);
const evidenceSchema = strictObject(
  ["providerRequestId", "httpStatus", "providerCode", "operatorTraceRef", "effectDisposition"],
  {
    providerRequestId: nullableString, httpStatus: { type: ["integer", "null"], minimum: 100, maximum: 599 },
    providerCode: nullableString, operatorTraceRef: nullableString,
    effectDisposition: { type: "string", enum: ["not_created", "accepted", "terminal_failed", "unknown"] },
  },
);
const usageRequired = ["schema", "id", "settlementId", "binding", "interval", "dimension", "unit", "source", "quantity", "outcome", "evidence", "directArtifactId", "lineageArtifactIds", "supersedesUsageRecordId", "correctionReason", "recordedAt"];
const usageProperties: Record<string, JsonSchema> = {
    schema: { const: "usage-record/v1" }, id: { type: "string" }, settlementId: { type: "string" }, binding: bindingSchema,
    interval: strictObject(["startedAt", "endedAt"], { startedAt: dateTime, endedAt: dateTime }),
    dimension: { type: "string" }, unit: { type: "string", enum: ["count", "byte", "millisecond", "megapixel"] },
    outcome: { type: "string", enum: ["succeeded", "failed_known", "outcome_unknown"] },
    evidence: evidenceSchema,
    directArtifactId: nullableString, lineageArtifactIds: { type: "array", items: { type: "string" }, uniqueItems: true },
    supersedesUsageRecordId: nullableString, correctionReason: nullableString, recordedAt: dateTime,
};
const usageRecordSchema: JsonSchema = { type: "object", oneOf: [
  strictObject(usageRequired, { ...usageProperties, source: { const: "unknown" }, quantity: { type: "null" } }),
  strictObject(usageRequired, { ...usageProperties, source: { type: "string", enum: ["reported", "measured", "estimated"] }, quantity: decimal }),
] };
const pricingSnapshotSchema = strictObject(
  ["schema", "id", "workspaceId", "source", "provider", "providerOperation", "model", "dimension", "unit", "price", "currency", "perQuantity", "version", "sourceUrl", "effectiveFrom", "effectiveTo", "recordedAt"],
  {
    schema: { const: "pricing-snapshot/v1" }, id: { type: "string" }, workspaceId: nullableString,
    source: { type: "string", enum: ["workspace_override", "builtin_catalog"] }, provider: { type: "string" },
    providerOperation: { type: "string" }, model: { type: "string" }, dimension: { type: "string" },
    unit: { type: "string", enum: ["count", "byte", "millisecond", "megapixel"] }, price: decimal,
    currency: { type: "string", pattern: "^[A-Z]{3}$" }, perQuantity: decimal, version: { type: "string" },
    sourceUrl: nullableString, effectiveFrom: dateTime, effectiveTo: { oneOf: [dateTime, { type: "null" }] }, recordedAt: dateTime,
  },
);
const valuationRequired = ["schema", "id", "settlementId", "workspaceId", "principalId", "runId", "stepAttemptId", "usageRecordIds", "basis", "pricingSource", "amount", "currency", "providerCostEvidenceRef", "pricingSnapshotIds", "pricingSnapshots", "fxSnapshotId", "supersedesCostValuationId", "recordedAt"];
const valuationProperties: Record<string, JsonSchema> = {
    schema: { const: "cost-valuation/v1" }, id: { type: "string" }, settlementId: { type: "string" },
    workspaceId: { type: "string" }, principalId: { type: "string" }, runId: { type: "string" }, stepAttemptId: { type: "string" },
    usageRecordIds: { type: "array", items: { type: "string" }, minItems: 1 },
    providerCostEvidenceRef: nullableString,
    pricingSnapshotIds: { type: "array", items: { type: "string" } }, fxSnapshotId: nullableString,
    pricingSnapshots: { type: "array", items: pricingSnapshotSchema },
    supersedesCostValuationId: nullableString, recordedAt: dateTime,
};
const valuationSchema: JsonSchema = { type: "object", oneOf: [
  strictObject(valuationRequired, { ...valuationProperties, basis: { const: "unknown" }, pricingSource: { const: "unknown" }, amount: { type: "null" }, currency: { type: "null" }, providerCostEvidenceRef: { type: "null" }, pricingSnapshotIds: { type: "array", maxItems: 0 }, pricingSnapshots: { type: "array", maxItems: 0 }, fxSnapshotId: { type: "null" } }),
  strictObject(valuationRequired, { ...valuationProperties, basis: { const: "provider_reported" }, pricingSource: { const: "provider_reported" }, amount: decimal, currency: { type: "string", pattern: "^[A-Z]{3}$" }, providerCostEvidenceRef: { type: "string", pattern: "^evidence:sha256:[a-f0-9]{64}$" }, pricingSnapshotIds: { type: "array", maxItems: 0 }, pricingSnapshots: { type: "array", maxItems: 0 } }),
  strictObject(valuationRequired, { ...valuationProperties, basis: { const: "runtime_calculated" }, pricingSource: { type: "string", enum: ["workspace_override", "builtin_catalog", "mixed"] }, amount: decimal, currency: { type: "string", pattern: "^[A-Z]{3}$" }, providerCostEvidenceRef: { type: "null" }, pricingSnapshotIds: { type: "array", items: { type: "string" }, minItems: 1 }, pricingSnapshots: { type: "array", items: pricingSnapshotSchema, minItems: 1 } }),
] };
const measurementRequired = ["usageRecordId", "interval", "dimension", "unit", "source", "quantity"];
const measurementProperties: Record<string, JsonSchema> = {
    usageRecordId: { type: "string" },
    interval: strictObject(["startedAt", "endedAt"], { startedAt: dateTime, endedAt: dateTime }),
    dimension: { type: "string" }, unit: { type: "string", enum: ["count", "byte", "millisecond", "megapixel"] },
};
const measurementSchema: JsonSchema = { type: "object", oneOf: [
  strictObject(measurementRequired, { ...measurementProperties, source: { const: "unknown" }, quantity: { type: "null" } }),
  strictObject(measurementRequired, { ...measurementProperties, source: { type: "string", enum: ["reported", "measured", "estimated"] }, quantity: decimal }),
] };
const eventSchema = strictObject(
  ["schema", "id", "settlementId", "workspaceId", "principalId", "runId", "stepAttemptId", "effectKey", "type", "usageRecordIds", "costValuationId", "measurements", "details", "occurredAt"],
  {
    schema: { const: "usage-metering-event/v1" }, id: { type: "string" }, settlementId: { type: "string" }, workspaceId: { type: "string" },
    principalId: { type: "string" }, runId: { type: "string" }, stepAttemptId: { type: "string" }, effectKey: { type: "string" },
    type: { type: "string", enum: ["usage.settled", "usage.corrected", "cost.valued", "artifact.attributed"] },
    usageRecordIds: { type: "array", items: { type: "string" } }, costValuationId: nullableString,
    measurements: { type: "array", items: measurementSchema },
    details: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] } }, occurredAt: dateTime,
  },
);
const summarySchema = strictObject(
  ["schema", "quantityTotals", "costSubtotals", "unknownValuationCount", "complete"],
  {
    schema: { const: "usage-summary/v1" },
    quantityTotals: { type: "array", items: strictObject(["dimension", "unit", "source", "quantity", "unknownCount"], {
      dimension: { type: "string" }, unit: { type: "string" }, source: { type: "string" }, quantity: { oneOf: [decimal, { type: "null" }] },
      unknownCount: { type: "integer", minimum: 0 },
    }) },
    costSubtotals: { type: "array", items: strictObject(["currency", "amount", "knownCount"], {
      currency: { type: "string", pattern: "^[A-Z]{3}$" }, amount: decimal, knownCount: { type: "integer", minimum: 1 },
    }) },
    unknownValuationCount: { type: "integer", minimum: 0 }, complete: { type: "boolean" },
  },
);
const page = (schema: string, item: JsonSchema): JsonSchema => strictObject(
  ["schema", "items", "nextCursor"],
  { schema: { const: schema }, items: { type: "array", items: item }, nextCursor: nullableString },
);

function reader(context: ResolvedSecurityContext | undefined) {
  if (!context) {
    throw new CapabilityFailure({
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Usage evidence is not authorized.",
    });
  }
  return context;
}

function scopedPrincipal(
  context: ResolvedSecurityContext,
  requested?: string,
): string | undefined {
  if (context.kind === "agent") {
    if (requested && requested !== context.principalId) {
      throw new CapabilityFailure({
        code: "CAPABILITY_NOT_AUTHORIZED",
        category: "authorization",
        message: "Usage evidence is not authorized.",
      });
    }
    return context.principalId;
  }
  return requested;
}

function publicJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function callerId(context: ResolvedSecurityContext): string {
  return context.kind === "agent" ? `agent:${context.principalId}` : `human:${context.userId}`;
}

function pagePosition(input: {
  cursor?: string;
  workspaceId: string;
  callerId: string;
  collection: string;
  filters: unknown;
  codec?: UsageCursorCodec;
}): { recordedAt: Date; id: string } | undefined {
  if (!input.cursor) return undefined;
  const filterDigest = canonicalDigest(input.filters);
  if (!input.codec) throw new CapabilityFailure({ code: "USAGE_CURSOR_INVALID", category: "validation", message: "Usage cursor is invalid or unavailable." });
  try {
    return input.codec.open({
      cursor: input.cursor,
      workspaceId: input.workspaceId,
      callerId: input.callerId,
      collection: input.collection,
      filterDigest,
    });
  } catch {
    throw new CapabilityFailure({ code: "USAGE_CURSOR_INVALID", category: "validation", message: "Usage cursor is invalid or unavailable." });
  }
}

function paginate<T extends { id: string }>(input: {
  items: T[];
  limit: number;
  workspaceId: string;
  callerId: string;
  collection: string;
  filters: unknown;
  occurredAt: (item: T) => Date;
  codec?: UsageCursorCodec;
}): { items: T[]; nextCursor: string | null } {
  const pageItems = input.items.slice(0, input.limit);
  const last = pageItems.at(-1);
  if (input.items.length <= input.limit || !last) return { items: pageItems, nextCursor: null };
  if (!input.codec) throw new CapabilityFailure({ code: "USAGE_CURSOR_INVALID", category: "internal", message: "Usage cursor is unavailable." });
  return {
    items: pageItems,
    nextCursor: input.codec.seal({
      workspaceId: input.workspaceId,
      callerId: input.callerId,
      collection: input.collection,
      filterDigest: canonicalDigest(input.filters),
      position: { recordedAt: input.occurredAt(last), id: last.id },
    }),
  };
}

async function domain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof UsageServiceError)) throw error;
    throw new CapabilityFailure({
      code: error.code,
      category:
        error.code === "USAGE_INVALID_INPUT"
          ? "validation"
          : error.code === "USAGE_CONFLICT"
            ? "conflict"
            : "not_found",
      message: error.message,
    });
  }
}

function registration<Input, Output>(
  input: Omit<
    CapabilityRegistration<Input, Output>,
    "effect" | "approval" | "idempotency" | "authorization" | "errors"
  >,
): CapabilityRegistration<Input, Output> {
  return defineCapability({
    ...input,
    audience: "shared",
    effect: QUERY_EFFECT,
    approval: { mode: "none" },
    idempotency: { mode: "retry-safe" },
    authorization: { resources: [] },
    errors: [
      ...COMMON_DISCOVERY_ERRORS,
      { code: "USAGE_UNAVAILABLE", category: "not_found", retryable: false, description: "Usage evidence is unavailable." },
      { code: "USAGE_CONFLICT", category: "conflict", retryable: false, description: "Usage evidence conflicts." },
      { code: "USAGE_INVALID_INPUT", category: "validation", retryable: false, description: "Usage query is invalid." },
      { code: "USAGE_CURSOR_INVALID", category: "validation", retryable: false, description: "Usage cursor is invalid or unavailable." },
    ],
  });
}

function window(input: { from?: string; to?: string }) {
  return {
    ...(input.from ? { from: new Date(input.from) } : {}),
    ...(input.to ? { to: new Date(input.to) } : {}),
  };
}

export function createUsageRegistrations(service: UsageLedgerService, cursorCodec?: UsageCursorCodec): CapabilityRegistration[] {
  return [
    registration({
      identity: USAGE_CAPABILITY_IDENTITIES.recordGet,
      summary: "Read one immutable Usage Record and its safe evidence.",
      lifecycle,
      input: z.object({ usageRecordId: id }).strict(),
      outputSchema: usageRecordSchema,
      handler: async (input, context) => {
        const principal = reader(context.securityContext);
        const record = await domain(() => service.getUsageRecord(principal.workspaceId, input.usageRecordId));
        if (record && principal.kind === "agent" && record.binding.principalId !== principal.principalId) {
          throw new CapabilityFailure({ code: "USAGE_UNAVAILABLE", category: "not_found", message: "Usage evidence is unavailable." });
        }
        if (!record) throw new CapabilityFailure({ code: "USAGE_UNAVAILABLE", category: "not_found", message: "Usage evidence is unavailable." });
        return publicJson(record);
      },
    }),
    registration({
      identity: USAGE_CAPABILITY_IDENTITIES.recordList,
      summary: "List immutable Usage Records without provider payloads or billing administration.",
      lifecycle,
      input: z.object({
        runId: id.optional(), stepAttemptId: id.optional(), principalId: id.optional(),
        provider: safeName.optional(), model: safeName.optional(), artifactId: id.optional(),
        ...interval, limit, cursor,
      }).strict(),
      outputSchema: page("usage-record-page/v1", usageRecordSchema),
      handler: async (input, context) => {
        const principal = reader(context.securityContext);
        const principalId = scopedPrincipal(principal, input.principalId);
        const filters = { runId: input.runId, stepAttemptId: input.stepAttemptId, principalId, provider: input.provider, model: input.model, artifactId: input.artifactId, from: input.from, to: input.to };
        const before = pagePosition({ cursor: input.cursor, workspaceId: principal.workspaceId, callerId: callerId(principal), collection: "usage_records.list@1", filters, codec: cursorCodec });
        const records = await domain(() => service.listUsageRecords(principal.workspaceId, {
          runId: input.runId,
          stepAttemptId: input.stepAttemptId,
          principalId,
          provider: input.provider,
          model: input.model,
          artifactId: input.artifactId,
          ...window(input),
          before,
          limit: input.limit + 1,
        }));
        return publicJson({ schema: "usage-record-page/v1", ...paginate({ items: records, limit: input.limit, workspaceId: principal.workspaceId, callerId: callerId(principal), collection: "usage_records.list@1", filters, occurredAt: (record) => record.recordedAt, codec: cursorCodec }) });
      },
    }),
    registration({
      identity: USAGE_CAPABILITY_IDENTITIES.valuationGet,
      summary: "Read one immutable exact-decimal Cost Valuation.",
      lifecycle,
      input: z.object({ costValuationId: id }).strict(),
      outputSchema: valuationSchema,
      handler: async (input, context) => {
        const principal = reader(context.securityContext);
        const value = await domain(() => service.getCostValuation(principal.workspaceId, input.costValuationId));
        if (!value || (principal.kind === "agent" && value.principalId !== principal.principalId)) throw new CapabilityFailure({ code: "USAGE_UNAVAILABLE", category: "not_found", message: "Cost valuation is unavailable." });
        return publicJson(value);
      },
    }),
    registration({
      identity: USAGE_CAPABILITY_IDENTITIES.valuationList,
      summary: "List immutable Cost Valuations and their pricing evidence.",
      lifecycle,
      input: z.object({
        usageRecordId: id.optional(), runId: id.optional(), principalId: id.optional(),
        pricingSource: z.enum(["provider_reported", "workspace_override", "builtin_catalog", "mixed", "unknown"]).optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).optional(), ...interval, limit, cursor,
      }).strict(),
      outputSchema: page("cost-valuation-page/v1", valuationSchema),
      handler: async (input, context) => {
        const principal = reader(context.securityContext);
        const principalId = scopedPrincipal(principal, input.principalId);
        const filters = { usageRecordId: input.usageRecordId, runId: input.runId, principalId, pricingSource: input.pricingSource, currency: input.currency, from: input.from, to: input.to };
        const before = pagePosition({ cursor: input.cursor, workspaceId: principal.workspaceId, callerId: callerId(principal), collection: "cost_valuations.list@1", filters, codec: cursorCodec });
        const values = await domain(() => service.listCostValuations(principal.workspaceId, {
          usageRecordId: input.usageRecordId,
          runId: input.runId,
          principalId,
          pricingSource: input.pricingSource as PricingSource | undefined,
          currency: input.currency,
          ...window(input),
          before,
          limit: input.limit + 1,
        }));
        return publicJson({ schema: "cost-valuation-page/v1", ...paginate({ items: values, limit: input.limit, workspaceId: principal.workspaceId, callerId: callerId(principal), collection: "cost_valuations.list@1", filters, occurredAt: (value) => value.recordedAt, codec: cursorCodec }) });
      },
    }),
    registration({
      identity: USAGE_CAPABILITY_IDENTITIES.summaryGet,
      summary: "Summarize known and unknown usage and cost without treating unknown as zero.",
      lifecycle,
      input: z.object({ runId: id.optional(), principalId: id.optional(), ...interval }).strict(),
      outputSchema: summarySchema,
      handler: async (input, context) => {
        const principal = reader(context.securityContext);
        return publicJson(await domain(() => service.getSummary(principal.workspaceId, {
          runId: input.runId,
          principalId: scopedPrincipal(principal, input.principalId),
          ...window(input),
        })));
      },
    }),
    registration({
      identity: USAGE_CAPABILITY_IDENTITIES.eventList,
      summary: "List safe append-only usage Metering Events.",
      lifecycle,
      input: z.object({
        types: z.array(z.enum(["usage.settled", "usage.corrected", "cost.valued", "artifact.attributed"])).max(4).optional(),
        ...interval, limit, cursor,
      }).strict(),
      outputSchema: page("usage-metering-event-page/v1", eventSchema),
      handler: async (input, context) => {
        const principal = reader(context.securityContext);
        const principalId = scopedPrincipal(principal);
        const filters = { types: input.types, principalId, from: input.from, to: input.to };
        const before = pagePosition({ cursor: input.cursor, workspaceId: principal.workspaceId, callerId: callerId(principal), collection: "usage_events.list@1", filters, codec: cursorCodec });
        const events = await domain(() => service.listMeteringEvents(principal.workspaceId, {
          types: input.types as UsageMeteringEvent["type"][] | undefined,
          principalId,
          ...window(input),
          before,
          limit: input.limit + 1,
        }));
        return publicJson({ schema: "usage-metering-event-page/v1", ...paginate({ items: events, limit: input.limit, workspaceId: principal.workspaceId, callerId: callerId(principal), collection: "usage_events.list@1", filters, occurredAt: (event) => event.occurredAt, codec: cursorCodec }) });
      },
    }),
    registration({
      identity: USAGE_CAPABILITY_IDENTITIES.agentViewGet,
      summary: "Read the authenticated Agent Principal's own usage and price certainty.",
      lifecycle,
      input: z.object({ principalId: id.optional(), ...interval }).strict(),
      outputSchema: strictObject(
        ["schema", "principalId", "summary", "recentUsageRecords", "recentCostValuations", "recentMeteringEvents", "reservationEvidence"],
        {
          schema: { const: "agent-usage-view/v1" }, principalId: { type: "string" }, summary: summarySchema,
          recentUsageRecords: { type: "array", items: usageRecordSchema },
          recentCostValuations: { type: "array", items: valuationSchema },
          recentMeteringEvents: { type: "array", items: eventSchema },
          reservationEvidence: strictObject(["state", "reasonCode"], {
            state: { const: "unsupported" },
            reasonCode: { const: "RUNTIME_BUDGET_AND_QUOTA_NOT_AVAILABLE" },
          }),
        },
      ),
      handler: async (input, context) => {
        const principal = reader(context.securityContext);
        const targetPrincipalId = scopedPrincipal(principal, input.principalId);
        if (!targetPrincipalId) {
          throw new CapabilityFailure({ code: "USAGE_INVALID_INPUT", category: "validation", message: "Principal ID is required." });
        }
        return publicJson(await domain(() => service.getAgentUsage(
          principal.workspaceId,
          targetPrincipalId,
          window(input),
        )));
      },
    }),
  ];
}
