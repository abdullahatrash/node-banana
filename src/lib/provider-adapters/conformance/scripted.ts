import { z } from "zod";
import {
  ProviderTransportFault,
  type ProviderAdapter,
  type ProviderAdapterContract,
  type ProviderAdapterTransport,
  type ProviderEffectRequest,
  type ProviderObservationRequest,
  type ProviderOutcome,
  type ProviderUsageEvidence,
} from "@/lib/agent-runtime/runs/provider-adapter";

const byteArraySchema = z.custom<Uint8Array>(
  (value) =>
    ArrayBuffer.isView(value) &&
    (value as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1 &&
    !(value instanceof DataView),
);

const textOutputSchema = z
  .object({
    text: z
      .object({
        kind: z.literal("text"),
        mediaType: z.literal("text/plain; charset=utf-8"),
        bytes: byteArraySchema,
      })
      .strict(),
  })
  .strict();

const intentSchema = z
  .object({
    prompt: z.string().min(1),
  })
  .strict();

export type ScriptedProviderIntent = z.infer<typeof intentSchema>;
export type ScriptedProviderOutput = z.infer<typeof textOutputSchema>;

const operationIdentity = {
  schema: "provider-operation-identity/v1",
  workflowOperationIdentity: "conformance.generate_text@1",
  workflowOperationContractDigest:
    "sha256:20de12d434cd174b2020a47718695b826e8bee4593a8f5f42b1b8f38aa925a36",
  provider: "conformance",
  operation: "generate_text.v1",
  model: "golden-v1",
} as const;

export const SCRIPTED_PROVIDER_CONTRACT: ProviderAdapterContract<
  ScriptedProviderIntent,
  ScriptedProviderOutput
> = Object.freeze({
  schema: "provider-adapter-contract/v1",
  identity: Object.freeze(operationIdentity),
  effectKeySupport: "native",
  observation: "provider_operation_ref",
  inputSchema: intentSchema,
  outputSchema: textOutputSchema,
  usageDimensions: Object.freeze([
    Object.freeze({
      dimension: "provider.tokens.input@1",
      unit: "count" as const,
      applicability: "always" as const,
    }),
    Object.freeze({
      dimension: "provider.tokens.output@1",
      unit: "count" as const,
      applicability: "response_dependent" as const,
    }),
  ]),
});

type ScriptedBody =
  | {
      state: "succeeded";
      providerOperationRef: string;
      text: string;
      usage?: Record<string, string | null>;
    }
  | {
      state: "failed";
      providerOperationRef: string | null;
      failureCode: string;
      retryable: boolean;
      retryAfterMs: number | null;
      effectDisposition: "not_created" | "terminal_failed";
      usage?: Record<string, string | null>;
    }
  | {
      state: "pending";
      providerOperationRef: string;
      pollAfterMs: number | null;
      usage?: Record<string, string | null>;
    };

function safeReference(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const reference = (value as Record<string, unknown>).providerOperationRef;
  return typeof reference === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/.test(reference)
    ? reference
    : null;
}

function usage(body: ScriptedBody): ProviderUsageEvidence[] {
  const dimensions = SCRIPTED_PROVIDER_CONTRACT.usageDimensions;
  const result: ProviderUsageEvidence[] = [];
  for (const dimension of dimensions) {
    const quantity = body.usage?.[dimension.dimension];
    if (typeof quantity === "string") {
      result.push({
        dimension: dimension.dimension,
        unit: dimension.unit,
        source: "reported",
        quantity,
      });
      continue;
    }
    if (
      dimension.applicability === "always" ||
      body.state === "succeeded"
    ) {
      result.push({
        dimension: dimension.dimension,
        unit: dimension.unit,
        source: "unknown",
        quantity: null,
      });
    }
  }
  return result;
}

function evidence(
  requestId: string | null,
  status: number | null,
  effectDisposition:
    | "not_created"
    | "accepted"
    | "terminal_failed"
    | "unknown",
) {
  return {
    providerRequestId: requestId,
    httpStatus: status,
    providerCode: null,
    operatorTraceRef: null,
    effectDisposition,
  } as const;
}

function transportFailure(
  error: unknown,
): ProviderOutcome<ScriptedProviderOutput> {
  if (
    error instanceof ProviderTransportFault &&
    error.effectDisposition === "not_created"
  ) {
    return {
      kind: "failed_known",
      providerOperationRef: error.providerOperationRef,
      failureCode:
        error.kind === "idempotency_conflict"
          ? "PROVIDER_EFFECT_KEY_CONFLICT"
          : "PROVIDER_NOT_CONTACTED",
      retryHint:
        error.kind === "idempotency_conflict"
          ? { retryable: false, retryAfterMs: null }
          : {
              retryable: true,
              retryAfterMs: error.retryAfterMs,
            },
      evidence: evidence(null, null, "not_created"),
      usage: usage({
        state: "failed",
        providerOperationRef: null,
        failureCode: "PROVIDER_NOT_CONTACTED",
        retryable: true,
        retryAfterMs: null,
        effectDisposition: "not_created",
      }),
    };
  }
  return {
    kind: "outcome_unknown",
    providerOperationRef:
      error instanceof ProviderTransportFault
        ? error.providerOperationRef
        : null,
    failureCode: "PROVIDER_TRANSPORT_OUTCOME_UNKNOWN",
    pollAfterMs: null,
    evidence: evidence(
      null,
      null,
      error instanceof ProviderTransportFault
        ? error.effectDisposition === "accepted"
          ? "accepted"
          : "unknown"
        : "unknown",
    ),
    usage: usage({
      state: "pending",
      providerOperationRef: "provider:unknown",
      pollAfterMs: null,
    }),
  };
}

function normalizeResponse(
  response: {
    status: number;
    requestId: string | null;
    body: unknown;
  },
): ProviderOutcome<ScriptedProviderOutput> {
  const body = response.body as Partial<ScriptedBody> | null;
  if (
    body?.state === "succeeded" &&
    typeof body.providerOperationRef === "string" &&
    typeof body.text === "string"
  ) {
    const succeeded = body as Extract<ScriptedBody, { state: "succeeded" }>;
    return {
      kind: "succeeded",
      providerOperationRef: succeeded.providerOperationRef,
      outputs: {
        text: {
          kind: "text",
          mediaType: "text/plain; charset=utf-8",
          bytes: Buffer.from(succeeded.text, "utf8"),
        },
      },
      evidence: evidence(response.requestId, response.status, "accepted"),
      usage: usage(succeeded),
    };
  }
  if (
    body?.state === "failed" &&
    typeof body.failureCode === "string" &&
    typeof body.retryable === "boolean" &&
    (body.effectDisposition === "not_created" ||
      body.effectDisposition === "terminal_failed")
  ) {
    const failed = body as Extract<ScriptedBody, { state: "failed" }>;
    return {
      kind: "failed_known",
      providerOperationRef: failed.providerOperationRef,
      failureCode: failed.failureCode,
      retryHint: failed.retryable
        ? { retryable: true, retryAfterMs: failed.retryAfterMs }
        : { retryable: false, retryAfterMs: null },
      evidence: evidence(
        response.requestId,
        response.status,
        failed.effectDisposition,
      ),
      usage: usage(failed),
    };
  }
  if (
    body?.state === "pending" &&
    typeof body.providerOperationRef === "string"
  ) {
    const pending = body as Extract<ScriptedBody, { state: "pending" }>;
    return {
      kind: "outcome_unknown",
      providerOperationRef: pending.providerOperationRef,
      failureCode: "PROVIDER_EFFECT_PENDING",
      pollAfterMs: pending.pollAfterMs,
      evidence: evidence(response.requestId, response.status, "accepted"),
      usage: usage(pending),
    };
  }
  return {
    kind: "outcome_unknown",
    providerOperationRef: safeReference(response.body),
    failureCode: "PROVIDER_RESPONSE_MALFORMED",
    pollAfterMs: null,
    evidence: evidence(response.requestId, response.status, "accepted"),
    usage: usage({
      state: "pending",
      providerOperationRef: "provider:unknown",
      pollAfterMs: null,
    }),
  };
}

export class ScriptedProviderAdapter
  implements ProviderAdapter<ScriptedProviderIntent, ScriptedProviderOutput>
{
  readonly contract = SCRIPTED_PROVIDER_CONTRACT;

  constructor(private readonly transport: ProviderAdapterTransport) {}

  async execute(
    input: ProviderEffectRequest<ScriptedProviderIntent>,
  ): Promise<ProviderOutcome<ScriptedProviderOutput>> {
    try {
      return normalizeResponse(
        await this.transport.launch({
          operation: this.contract.identity,
          effectKey: input.effectKey,
          intentDigest: input.intentDigest,
          intent: input.intent,
          credentials: input.credentials,
        }),
      );
    } catch (error) {
      return transportFailure(error);
    }
  }

  async observe(
    input: ProviderObservationRequest<ScriptedProviderIntent>,
  ): Promise<ProviderOutcome<ScriptedProviderOutput>> {
    try {
      return normalizeResponse(
        await this.transport.observe({
          operation: this.contract.identity,
          effectKey: input.effectKey,
          intentDigest: input.intentDigest,
          intent: input.intent,
          credentials: input.credentials,
          providerOperationRef: input.providerOperationRef,
        }),
      );
    } catch (error) {
      return transportFailure(error);
    }
  }
}
