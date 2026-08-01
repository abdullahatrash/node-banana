import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  WorkflowStepExecutionResult,
  WorkflowStepExecutionInput,
  WorkflowStepReconciliationInput,
  WorkflowStepExecutor,
  WorkflowStepGeneratedOutput,
  WorkflowStepProviderMetadata,
  WorkflowStepProviderResult,
} from "./types";

const EXACT_OPERATION =
  /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+@[1-9][0-9]{0,8}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const SAFE_NAME = /^[a-z][a-z0-9_.-]{0,99}$/;
const USAGE_DIMENSION = /^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const OPAQUE_EVIDENCE_REF = /^evidence:sha256:[a-f0-9]{64}$/;

const byteArraySchema = z.custom<Uint8Array>(
  (value) =>
    ArrayBuffer.isView(value) &&
    (value as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1 &&
    !(value instanceof DataView),
);

export type ProviderEffectDisposition =
  | "not_created"
  | "accepted"
  | "terminal_failed"
  | "unknown";

export interface NormalizedProviderOperationIdentity {
  schema: "provider-operation-identity/v1";
  workflowOperationIdentity: string;
  workflowOperationContractDigest: string;
  provider: string;
  operation: string;
  model: string;
}

export interface ProviderUsageDimensionContract {
  dimension: string;
  unit: "count" | "byte" | "millisecond" | "megapixel";
  applicability: "always" | "response_dependent";
}

export interface ProviderAdapterContract<I, O> {
  schema: "provider-adapter-contract/v1";
  adapterRevision: string;
  inputSchemaDigest: string;
  outputSchemaDigest: string;
  identity: NormalizedProviderOperationIdentity;
  effectKeySupport: "native" | "unsupported";
  launchSafety: import("./types").WorkflowProviderLaunchSafety;
  observation: "none" | "provider_operation_ref";
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  usageDimensions: readonly ProviderUsageDimensionContract[];
}

export interface ProviderCredentialMaterial {
  profileId: string;
  version: number;
  secret: string;
}

export interface ProviderEffectRequest<I> {
  effectKey: string;
  intentDigest: string;
  intent: Readonly<I>;
  credentials: Readonly<Record<string, Readonly<ProviderCredentialMaterial>>>;
}

export interface ProviderObservationRequest<I>
  extends ProviderEffectRequest<I> {
  providerOperationRef: string;
}

export interface SafeProviderEvidence {
  providerRequestId: string | null;
  httpStatus: number | null;
  providerCode: string | null;
  operatorTraceRef: string | null;
  effectDisposition: ProviderEffectDisposition;
}

export type ProviderUsageEvidence =
  | {
      dimension: string;
      unit: ProviderUsageDimensionContract["unit"];
      source: "reported" | "measured" | "estimated";
      quantity: string;
    }
  | {
      dimension: string;
      unit: ProviderUsageDimensionContract["unit"];
      source: "unknown";
      quantity: null;
    };

export type ProviderRetryHint =
  | { retryable: false; retryAfterMs: null }
  | { retryable: true; retryAfterMs: number | null };

export type ProviderOutcome<O> =
  | {
      kind: "succeeded";
      providerOperationRef: string;
      outputs: O;
      evidence: SafeProviderEvidence;
      usage: readonly ProviderUsageEvidence[];
      reportedCost?: { amount: string; currency: string; evidenceRef: string } | null;
    }
  | {
      kind: "failed_known";
      providerOperationRef: string | null;
      failureCode: string;
      retryHint: ProviderRetryHint;
      evidence: SafeProviderEvidence;
      usage: readonly ProviderUsageEvidence[];
      reportedCost?: { amount: string; currency: string; evidenceRef: string } | null;
    }
  | {
      kind: "outcome_unknown";
      providerOperationRef: string | null;
      failureCode: string;
      pollAfterMs: number | null;
      evidence: SafeProviderEvidence;
      usage: readonly ProviderUsageEvidence[];
      reportedCost?: { amount: string; currency: string; evidenceRef: string } | null;
    };

export interface ProviderAdapter<I, O> {
  readonly contract: ProviderAdapterContract<I, O>;
  execute(input: ProviderEffectRequest<I>): Promise<ProviderOutcome<O>>;
  observe?(
    input: ProviderObservationRequest<I>,
  ): Promise<ProviderOutcome<O>>;
}

export interface ProviderTransportEffectRequest<I = unknown> {
  operation: NormalizedProviderOperationIdentity;
  effectKey: string;
  intentDigest: string;
  intent: Readonly<I>;
  credentials: Readonly<Record<string, Readonly<ProviderCredentialMaterial>>>;
}

export interface ProviderTransportObservationRequest<I = unknown>
  extends ProviderTransportEffectRequest<I> {
  providerOperationRef: string;
}

export interface ProviderTransportResponse {
  status: number;
  requestId: string | null;
  body: unknown;
}

export interface ProviderAdapterTransport {
  launch(
    request: ProviderTransportEffectRequest,
  ): Promise<ProviderTransportResponse>;
  observe(
    request: ProviderTransportObservationRequest,
  ): Promise<ProviderTransportResponse>;
}

export type ProviderTransportFaultKind =
  | "timeout"
  | "disconnect"
  | "idempotency_conflict";

export class ProviderTransportFault extends Error {
  constructor(
    readonly kind: ProviderTransportFaultKind,
    readonly effectDisposition: ProviderEffectDisposition,
    readonly providerOperationRef: string | null,
    readonly retryAfterMs: number | null = null,
  ) {
    super("Provider transport failed without safe response evidence.");
    this.name = "ProviderTransportFault";
  }
}

export class ProviderAdapterContractError extends Error {
  constructor() {
    super("Provider Adapter violated its normalized contract.");
    this.name = "ProviderAdapterContractError";
  }
}

const identitySchema = z
  .object({
    schema: z.literal("provider-operation-identity/v1"),
    workflowOperationIdentity: z.string().regex(EXACT_OPERATION),
    workflowOperationContractDigest: z.string().regex(SHA256),
    provider: z.string().regex(SAFE_NAME),
    operation: z.string().min(1).max(200).regex(SAFE_ID),
    model: z
      .string()
      .min(1)
      .max(200)
      .regex(SAFE_ID)
      .refine((value) => !/(?:^|[._:/-])latest$/i.test(value)),
  })
  .strict();

const usageDimensionSchema = z
  .object({
    dimension: z.string().regex(USAGE_DIMENSION),
    unit: z.enum(["count", "byte", "millisecond", "megapixel"]),
    applicability: z.enum(["always", "response_dependent"]),
  })
  .strict();

const evidenceSchema = z
  .object({
    providerRequestId: z.string().regex(SAFE_ID).nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    providerCode: z.string().regex(SAFE_ID).nullable(),
    operatorTraceRef: z.string().regex(SAFE_ID).nullable(),
    effectDisposition: z.enum([
      "not_created",
      "accepted",
      "terminal_failed",
      "unknown",
    ]),
  })
  .strict();

const usageSchema = z.discriminatedUnion("source", [
  z
    .object({
      dimension: z.string().regex(USAGE_DIMENSION),
      unit: z.enum(["count", "byte", "millisecond", "megapixel"]),
      source: z.enum(["reported", "measured", "estimated"]),
      quantity: z.string().regex(DECIMAL),
    })
    .strict(),
  z
    .object({
      dimension: z.string().regex(USAGE_DIMENSION),
      unit: z.enum(["count", "byte", "millisecond", "megapixel"]),
      source: z.literal("unknown"),
      quantity: z.null(),
    })
    .strict(),
]);

const retryHintSchema = z.discriminatedUnion("retryable", [
  z.object({ retryable: z.literal(false), retryAfterMs: z.null() }).strict(),
  z
    .object({
      retryable: z.literal(true),
      retryAfterMs: z.number().int().nonnegative().nullable(),
    })
    .strict(),
]);
const reportedCostSchema = z.object({
  amount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  evidenceRef: z.string().trim().min(1).max(500),
}).strict().nullable().optional();

function opaqueProviderCostEvidenceRef(value: string): string {
  const ref = value.trim();
  if (!ref || ref.length > 500 || /[\u0000-\u001f\u007f]/.test(ref)) {
    throw new ProviderAdapterContractError();
  }
  return OPAQUE_EVIDENCE_REF.test(ref)
    ? ref
    : `evidence:${canonicalDigest({ kind: "provider_cost", reference: ref })}`;
}

const rawOutcomeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("succeeded"),
      providerOperationRef: z.string().regex(SAFE_ID),
      outputs: z.unknown(),
      evidence: evidenceSchema,
      usage: z.array(usageSchema),
      reportedCost: reportedCostSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("failed_known"),
      providerOperationRef: z.string().regex(SAFE_ID).nullable(),
      failureCode: z.string().regex(SAFE_CODE),
      retryHint: retryHintSchema,
      evidence: evidenceSchema,
      usage: z.array(usageSchema),
      reportedCost: reportedCostSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("outcome_unknown"),
      providerOperationRef: z.string().regex(SAFE_ID).nullable(),
      failureCode: z.string().regex(SAFE_CODE),
      pollAfterMs: z.number().int().nonnegative().nullable(),
      evidence: evidenceSchema,
      usage: z.array(usageSchema),
      reportedCost: reportedCostSchema,
    })
    .strict(),
]);

const workflowGeneratedOutputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      mediaType: z.string().min(1).max(200),
      bytes: byteArraySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("image"),
      mediaType: z.string().min(1).max(200),
      bytes: byteArraySchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .strict(),
]);

const workflowProviderMetadataSchema = z
  .object({
    evidence: evidenceSchema,
    usage: z.array(usageSchema),
    reportedCost: reportedCostSchema,
    retryAfterMs: z.number().int().nonnegative().nullable(),
    pollAfterMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

const workflowExecutionResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("legacy"),
      output: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("generated"),
      providerOperationRef: z.string().regex(SAFE_ID),
      outputs: z.record(z.string().regex(SAFE_NAME), workflowGeneratedOutputSchema),
      providerMetadata: workflowProviderMetadataSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("failed_known"),
      failureCode: z.string().regex(SAFE_CODE),
      retryable: z.boolean(),
      providerOperationRef: z.string().regex(SAFE_ID).nullable(),
      providerMetadata: workflowProviderMetadataSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("outcome_unknown"),
      failureCode: z.string().regex(SAFE_CODE),
      providerOperationRef: z.string().regex(SAFE_ID).nullable(),
      providerMetadata: workflowProviderMetadataSchema.optional(),
    })
    .strict(),
]);

export function parseWorkflowStepExecutionResult(
  value: unknown,
): WorkflowStepExecutionResult {
  try {
    return workflowExecutionResultSchema.parse(value);
  } catch {
    throw new ProviderAdapterContractError();
  }
}

function assertUniqueUsage(
  contract: ProviderAdapterContract<unknown, unknown>,
  usage: readonly ProviderUsageEvidence[],
): void {
  const declared = new Map(
    contract.usageDimensions.map((item) => [item.dimension, item]),
  );
  const seen = new Set<string>();
  for (const item of usage) {
    const dimension = declared.get(item.dimension);
    if (!dimension || dimension.unit !== item.unit || seen.has(item.dimension)) {
      throw new ProviderAdapterContractError();
    }
    seen.add(item.dimension);
  }
  if (
    contract.usageDimensions.some(
      (item) => item.applicability === "always" && !seen.has(item.dimension),
    )
  ) {
    throw new ProviderAdapterContractError();
  }
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) {
    return false;
  }
  outer: for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

function hasForbiddenSecretBytes(
  value: unknown,
  forbidden: readonly Uint8Array[],
  seen = new WeakSet<object>(),
): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (
    ArrayBuffer.isView(value) &&
    (value as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1 &&
    !(value instanceof DataView)
  ) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return forbidden.some((secret) => containsBytes(bytes, secret));
  }
  return Object.values(value).some((child) =>
    hasForbiddenSecretBytes(child, forbidden, seen),
  );
}

function assertSecretSafe(value: unknown, forbidden: readonly string[]): void {
  const serialized = JSON.stringify(value);
  const encoded = forbidden
    .filter((secret) => secret.length > 0)
    .map((secret) => new TextEncoder().encode(secret));
  if (
    forbidden.some(
      (secret) => secret.length > 0 && serialized.includes(secret),
    ) ||
    hasForbiddenSecretBytes(value, encoded)
  ) {
    throw new ProviderAdapterContractError();
  }
}

export function validateProviderAdapterContract<I, O>(
  contract: ProviderAdapterContract<I, O>,
): void {
  try {
    identitySchema.parse(contract.identity);
    z
      .object({
        schema: z.literal("provider-adapter-contract/v1"),
        adapterRevision: z.string().regex(SAFE_ID),
        inputSchemaDigest: z.string().regex(SHA256),
        outputSchemaDigest: z.string().regex(SHA256),
        effectKeySupport: z.enum(["native", "unsupported"]),
        launchSafety: z
          .object({
            mode: z.enum(["native_effect_key", "durable_at_most_once"]),
            guard: z.literal("workflow-step-attempt/v1"),
            replay: z.enum(["provider_deduplicated", "never_launch"]),
          })
          .strict(),
        observation: z.enum(["none", "provider_operation_ref"]),
        usageDimensions: z.array(usageDimensionSchema),
      })
      .strict()
      .parse({
        schema: contract.schema,
        adapterRevision: contract.adapterRevision,
        inputSchemaDigest: contract.inputSchemaDigest,
        outputSchemaDigest: contract.outputSchemaDigest,
        effectKeySupport: contract.effectKeySupport,
        launchSafety: contract.launchSafety,
        observation: contract.observation,
        usageDimensions: contract.usageDimensions,
      });
    const names = contract.usageDimensions.map((item) => item.dimension);
    if (new Set(names).size !== names.length) {
      throw new ProviderAdapterContractError();
    }
    if (
      (contract.effectKeySupport === "native" &&
        (contract.launchSafety.mode !== "native_effect_key" ||
          contract.launchSafety.replay !== "provider_deduplicated")) ||
      (contract.effectKeySupport === "unsupported" &&
        (contract.launchSafety.mode !== "durable_at_most_once" ||
          contract.launchSafety.replay !== "never_launch"))
    ) {
      throw new ProviderAdapterContractError();
    }
  } catch (error) {
    if (error instanceof ProviderAdapterContractError) throw error;
    throw new ProviderAdapterContractError();
  }
}

export function canonicalProviderAdapterContractDigest<I, O>(
  contract: ProviderAdapterContract<I, O>,
): string {
  validateProviderAdapterContract(contract);
  return canonicalDigest({
    schema: contract.schema,
    adapterRevision: contract.adapterRevision,
    inputSchemaDigest: contract.inputSchemaDigest,
    outputSchemaDigest: contract.outputSchemaDigest,
    identity: contract.identity,
    effectKeySupport: contract.effectKeySupport,
    launchSafety: contract.launchSafety,
    observation: contract.observation,
    usageDimensions: contract.usageDimensions,
  });
}

export function canonicalProviderSchemaDigest(descriptor: unknown): string {
  return canonicalDigest(descriptor);
}

export function parseProviderOutcome<I, O>(
  contract: ProviderAdapterContract<I, O>,
  value: unknown,
  options: { forbiddenSubstrings?: readonly string[] } = {},
): ProviderOutcome<O> {
  try {
    validateProviderAdapterContract(contract);
    const parsed = rawOutcomeSchema.parse(value);
    if (
      parsed.kind === "succeeded" &&
      parsed.evidence.effectDisposition !== "accepted"
    ) {
      throw new ProviderAdapterContractError();
    }
    if (
      parsed.kind === "failed_known" &&
      !["not_created", "terminal_failed"].includes(
        parsed.evidence.effectDisposition,
      )
    ) {
      throw new ProviderAdapterContractError();
    }
    if (
      parsed.kind === "outcome_unknown" &&
      !["accepted", "unknown"].includes(parsed.evidence.effectDisposition)
    ) {
      throw new ProviderAdapterContractError();
    }
    assertUniqueUsage(
      contract as ProviderAdapterContract<unknown, unknown>,
      parsed.usage,
    );
    const safeParsed = parsed.reportedCost
      ? {
          ...parsed,
          reportedCost: {
            ...parsed.reportedCost,
            evidenceRef: opaqueProviderCostEvidenceRef(parsed.reportedCost.evidenceRef),
          },
        }
      : parsed;
    const result =
      parsed.kind === "succeeded"
        ? { ...safeParsed, outputs: contract.outputSchema.parse(parsed.outputs) }
        : safeParsed;
    assertSecretSafe(result, options.forbiddenSubstrings ?? []);
    return result as ProviderOutcome<O>;
  } catch (error) {
    if (error instanceof ProviderAdapterContractError) throw error;
    throw new ProviderAdapterContractError();
  }
}

function unknownUsage<I, O>(
  contract: ProviderAdapterContract<I, O>,
): ProviderUsageEvidence[] {
  return contract.usageDimensions
    .filter((item) => item.applicability === "always")
    .map((item) => ({
      dimension: item.dimension,
      unit: item.unit,
      source: "unknown" as const,
      quantity: null,
    }));
}

function adapterException<I, O>(
  contract: ProviderAdapterContract<I, O>,
): ProviderOutcome<O> {
  return {
    kind: "outcome_unknown",
    providerOperationRef: null,
    failureCode: "PROVIDER_ADAPTER_EXCEPTION",
    pollAfterMs: null,
    evidence: {
      providerRequestId: null,
      httpStatus: null,
      providerCode: null,
      operatorTraceRef: null,
      effectDisposition: "unknown",
    },
    usage: unknownUsage(contract),
  };
}

function freezeValue<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    if (ArrayBuffer.isView(value)) return value;
    for (const child of Object.values(value)) freezeValue(child);
    Object.freeze(value);
  }
  return value;
}

function prepareRequest<I, O>(
  contract: ProviderAdapterContract<I, O>,
  input: ProviderEffectRequest<I>,
): ProviderEffectRequest<I> {
  if (!SAFE_ID.test(input.effectKey) || !SHA256.test(input.intentDigest)) {
    throw new ProviderAdapterContractError();
  }
  const intent = contract.inputSchema.parse(structuredClone(input.intent));
  const credentials = Object.fromEntries(
    Object.entries(input.credentials).map(([name, credential]) => {
      if (
        !SAFE_NAME.test(name) ||
        !SAFE_ID.test(credential.profileId) ||
        !Number.isInteger(credential.version) ||
        credential.version < 1 ||
        credential.secret.length === 0
      ) {
        throw new ProviderAdapterContractError();
      }
      return [name, { ...credential }];
    }),
  );
  return freezeValue({ ...input, intent, credentials });
}

function forbiddenSecrets<I>(input: ProviderEffectRequest<I>): string[] {
  return Object.values(input.credentials).map((item) => item.secret);
}

export async function executeProviderEffect<I, O>(
  adapter: ProviderAdapter<I, O>,
  input: ProviderEffectRequest<I>,
): Promise<ProviderOutcome<O>> {
  validateProviderAdapterContract(adapter.contract);
  const prepared = prepareRequest(adapter.contract, input);
  try {
    return parseProviderOutcome(
      adapter.contract,
      await adapter.execute(prepared),
      { forbiddenSubstrings: forbiddenSecrets(prepared) },
    );
  } catch {
    return adapterException(adapter.contract);
  }
}

export async function observeProviderEffect<I, O>(
  adapter: ProviderAdapter<I, O>,
  input: ProviderObservationRequest<I>,
): Promise<ProviderOutcome<O>> {
  validateProviderAdapterContract(adapter.contract);
  if (
    adapter.contract.observation !== "provider_operation_ref" ||
    !adapter.observe ||
    !SAFE_ID.test(input.providerOperationRef)
  ) {
    return adapterException(adapter.contract);
  }
  const prepared = prepareRequest(adapter.contract, input);
  try {
    const result = parseProviderOutcome(
      adapter.contract,
      await adapter.observe({
        ...prepared,
        providerOperationRef: input.providerOperationRef,
      }),
      { forbiddenSubstrings: forbiddenSecrets(prepared) },
    );
    if (
      result.providerOperationRef !== null &&
      result.providerOperationRef !== input.providerOperationRef
    ) {
      return adapterException(adapter.contract);
    }
    return result;
  } catch {
    return adapterException(adapter.contract);
  }
}

export type WorkflowProviderOutputs = Record<
  string,
  WorkflowStepGeneratedOutput
>;

export interface WorkflowProviderInvocation<I> {
  intent: I;
  credentials: Readonly<
    Record<string, Readonly<ProviderCredentialMaterial>>
  >;
}

export type ResolveWorkflowProviderInvocation<I> = (
  input: WorkflowStepExecutionInput,
) =>
  | WorkflowProviderInvocation<I>
  | Promise<WorkflowProviderInvocation<I>>;

/**
 * Server-only boundary that owns plaintext credential lifetime. The runtime
 * supplies the normalized adapter callback but never receives the secret.
 */
export interface WorkflowProviderInvocationBoundary<I> {
  invoke(
    input: WorkflowStepExecutionInput,
    execute: (
      invocation: WorkflowProviderInvocation<I>,
    ) => Promise<ProviderOutcome<WorkflowProviderOutputs>>,
  ): Promise<ProviderOutcome<WorkflowProviderOutputs>>;
  observe?(
    input: WorkflowStepExecutionInput & { providerOperationRef: string },
    observe: (
      invocation: WorkflowProviderInvocation<I>,
    ) => Promise<ProviderOutcome<WorkflowProviderOutputs>>,
  ): Promise<ProviderOutcome<WorkflowProviderOutputs>>;
  /** Non-launching recovery from a server-owned durable settlement. */
  recover?(
    input: WorkflowStepReconciliationInput,
  ): Promise<ProviderOutcome<WorkflowProviderOutputs>>;
}

function isInvocationBoundary<I>(
  value:
    | ResolveWorkflowProviderInvocation<I>
    | WorkflowProviderInvocationBoundary<I>,
): value is WorkflowProviderInvocationBoundary<I> {
  return typeof value === "object" && value !== null && "invoke" in value;
}

function metadata<O>(outcome: ProviderOutcome<O>): WorkflowStepProviderMetadata {
  return {
    evidence: outcome.evidence,
    usage: [...outcome.usage],
    reportedCost: outcome.reportedCost ?? null,
    retryAfterMs:
      outcome.kind === "failed_known" ? outcome.retryHint.retryAfterMs : null,
    pollAfterMs:
      outcome.kind === "outcome_unknown" ? outcome.pollAfterMs : null,
  };
}

function toWorkflowProviderResult(
  outcome: ProviderOutcome<WorkflowProviderOutputs>,
): WorkflowStepProviderResult {
  if (outcome.kind === "succeeded") {
    return {
      kind: "generated",
      providerOperationRef: outcome.providerOperationRef,
      outputs: outcome.outputs,
      providerMetadata: metadata(outcome),
    };
  }
  if (outcome.kind === "failed_known") {
    return {
      kind: "failed_known",
      providerOperationRef: outcome.providerOperationRef,
      failureCode: outcome.failureCode,
      retryable: outcome.retryHint.retryable,
      providerMetadata: metadata(outcome),
    };
  }
  return {
    kind: "outcome_unknown",
    providerOperationRef: outcome.providerOperationRef,
    failureCode: outcome.failureCode,
    providerMetadata: metadata(outcome),
  };
}

export function createWorkflowStepExecutorFromProviderAdapter<I>(
  adapterModule: string,
  adapter: ProviderAdapter<I, WorkflowProviderOutputs>,
  invocationBoundary:
    | ResolveWorkflowProviderInvocation<I>
    | WorkflowProviderInvocationBoundary<I>,
): WorkflowStepExecutor {
  validateProviderAdapterContract(adapter.contract);
  return {
    provider: adapter.contract.identity.provider,
    providerOperation: adapter.contract.identity.operation,
    model: adapter.contract.identity.model,
    providerResolution: {
      adapterModule,
      adapterContractDigest: canonicalProviderAdapterContractDigest(
        adapter.contract,
      ),
      provider: adapter.contract.identity.provider,
      providerOperation: adapter.contract.identity.operation,
      model: adapter.contract.identity.model,
      effectKeySupport: adapter.contract.effectKeySupport,
      observation: adapter.contract.observation,
      launchSafety: adapter.contract.launchSafety,
    },
    execute: async (input) => {
      const execute = (invocation: WorkflowProviderInvocation<I>) =>
        executeProviderEffect(adapter, {
          effectKey: input.effectKey,
          intentDigest: input.intentDigest,
          intent: invocation.intent,
          credentials: invocation.credentials,
        });
      const outcome = isInvocationBoundary(invocationBoundary)
        ? await invocationBoundary.invoke(input, execute)
        : await execute(await invocationBoundary(input));
      return toWorkflowProviderResult(outcome);
    },
    reconcile:
      adapter.contract.observation === "provider_operation_ref" ||
      (isInvocationBoundary(invocationBoundary) && invocationBoundary.recover)
          ? async (input) => {
            if (
              adapter.contract.observation === "none" &&
              isInvocationBoundary(invocationBoundary) &&
              invocationBoundary.recover
            ) {
              return toWorkflowProviderResult(
                await invocationBoundary.recover(input),
              );
            }
            if (input.providerOperationRef === null) {
              return {
                kind: "outcome_unknown",
                failureCode: "PROVIDER_OPERATION_REFERENCE_UNAVAILABLE",
                providerOperationRef: null,
              };
            }
            const providerOperationRef = input.providerOperationRef;
            const observe = (invocation: WorkflowProviderInvocation<I>) =>
              observeProviderEffect(adapter, {
                effectKey: input.effectKey,
                intentDigest: input.intentDigest,
                providerOperationRef,
                intent: invocation.intent,
                credentials: invocation.credentials,
              });
            const outcome = isInvocationBoundary(invocationBoundary)
              ? invocationBoundary.observe
                ? await invocationBoundary.observe(
                    {
                      ...input,
                      providerOperationRef,
                    },
                    observe,
                  )
                : {
                    kind: "outcome_unknown" as const,
                    providerOperationRef,
                    failureCode: "PROVIDER_EFFECT_RECONCILIATION_REQUIRED",
                    pollAfterMs: null,
                    evidence: {
                      providerRequestId: null,
                      httpStatus: null,
                      providerCode: null,
                      operatorTraceRef: null,
                      effectDisposition: "unknown" as const,
                    },
                    usage: [],
                  }
              : await observe(await invocationBoundary(input));
            return toWorkflowProviderResult(outcome);
          }
        : undefined,
  };
}
