import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ProviderTransportFault,
  canonicalProviderSchemaDigest,
  type ProviderAdapter,
  type ProviderAdapterContract,
  type ProviderAdapterTransport,
  type ProviderEffectRequest,
  type ProviderObservationRequest,
  type ProviderOutcome,
  type ProviderTransportEffectRequest,
  type ProviderTransportObservationRequest,
  type ProviderTransportResponse,
} from "@/lib/agent-runtime/runs/provider-adapter";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/;

const byteArraySchema = z.custom<Uint8Array>(
  (value) =>
    ArrayBuffer.isView(value) &&
    (value as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1 &&
    !(value instanceof DataView),
);

export const deterministicLinkedInIntentSchema = z
  .object({
    schema: z.literal("publishing-platform-intent/v1"),
    deliveryId: z.string().regex(SAFE_ID),
    planRevisionId: z.string().regex(SAFE_ID),
    planRevisionDigest: z.string().regex(SHA256),
    targetId: z.string().regex(SAFE_ID),
    channel: z
      .object({
        id: z.string().regex(SAFE_ID),
        platform: z.literal("linkedin"),
        authorKind: z.enum(["person", "organization"]),
        snapshotDigest: z.string().regex(SHA256),
      })
      .strict(),
    content: z
      .object({
        artifactId: z.string().regex(SAFE_ID),
        digest: z.string().regex(SHA256),
        mediaType: z.literal("text/plain; charset=utf-8"),
        text: z.string().min(1).max(3_000),
      })
      .strict(),
    media: z
      .array(
        z
          .object({
            artifactId: z.string().regex(SAFE_ID),
            digest: z.string().regex(SHA256),
            mediaType: z.enum(["image/jpeg", "image/png", "image/gif"]),
            bytes: byteArraySchema,
          })
          .strict(),
      )
      .max(9),
    settings: z
      .object({ type: z.enum(["person", "organization"]) })
      .strict(),
    publishAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.settings.type !== value.channel.authorKind) {
      context.addIssue({
        code: "custom",
        path: ["settings", "type"],
        message: "LinkedIn author settings must match the frozen Channel.",
      });
    }
  });

export const deterministicLinkedInOutputSchema = z
  .object({
    publication: z
      .object({
        providerPostRef: z.string().regex(SAFE_ID),
        publishedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();

export type DeterministicLinkedInIntent = z.infer<
  typeof deterministicLinkedInIntentSchema
>;
export type DeterministicLinkedInOutput = z.infer<
  typeof deterministicLinkedInOutputSchema
>;

const INPUT_DESCRIPTOR = Object.freeze({
  schema: "publishing-platform-intent/v1",
  platform: "linkedin",
  content: "retained-text-artifact/v1",
  media: "retained-image-artifacts/v1",
  settings: "linkedin-publishing-settings@1",
  timing: "exact-rfc3339-instant/v1",
});
const OUTPUT_DESCRIPTOR = Object.freeze({
  schema: "publishing-platform-output/v1",
  platform: "linkedin",
  publication: ["providerPostRef", "publishedAt"],
});

export const DETERMINISTIC_LINKEDIN_PLATFORM_CONTRACT: ProviderAdapterContract<
  DeterministicLinkedInIntent,
  DeterministicLinkedInOutput
> = Object.freeze({
  schema: "provider-adapter-contract/v1",
  adapterRevision: "deterministic-linkedin-platform-adapter-v1",
  inputSchemaDigest: canonicalProviderSchemaDigest(INPUT_DESCRIPTOR),
  outputSchemaDigest: canonicalProviderSchemaDigest(OUTPUT_DESCRIPTOR),
  identity: Object.freeze({
    schema: "provider-operation-identity/v1",
    workflowOperationIdentity: "publishing.publish_linkedin@1",
    workflowOperationContractDigest: canonicalProviderSchemaDigest({
      input: INPUT_DESCRIPTOR,
      output: OUTPUT_DESCRIPTOR,
    }),
    provider: "fake_linkedin",
    operation: "posts.create.v1",
    model: "deterministic-v1",
  }),
  effectKeySupport: "native",
  launchSafety: Object.freeze({
    mode: "native_effect_key",
    guard: "publishing-delivery/v1",
    replay: "provider_deduplicated",
  }),
  observation: "provider_operation_ref",
  inputSchema: deterministicLinkedInIntentSchema,
  outputSchema: deterministicLinkedInOutputSchema,
  usageDimensions: Object.freeze([]),
});

type PlatformBody =
  | {
      state: "pending";
      providerOperationRef: string;
      pollAfterMs: number;
    }
  | {
      state: "published";
      providerOperationRef: string;
      providerPostRef: string;
      publishedAt: string;
    }
  | {
      state: "failed";
      providerOperationRef: string | null;
      failureCode: string;
      retryable: boolean;
      retryAfterMs: number | null;
      effectDisposition: "not_created" | "terminal_failed";
    };

function evidence(
  requestId: string | null,
  status: number | null,
  effectDisposition: "accepted" | "unknown",
) {
  return {
    providerRequestId: requestId,
    httpStatus: status,
    providerCode: null,
    operatorTraceRef: null,
    effectDisposition,
  } as const;
}

function safeReference(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const reference = (value as Record<string, unknown>).providerOperationRef;
  return typeof reference === "string" && SAFE_ID.test(reference)
    ? reference
    : null;
}

function normalizeResponse(
  response: ProviderTransportResponse,
): ProviderOutcome<DeterministicLinkedInOutput> {
  const body = response.body as Partial<PlatformBody> | null;
  if (
    body?.state === "published" &&
    typeof body.providerOperationRef === "string" &&
    typeof body.providerPostRef === "string" &&
    typeof body.publishedAt === "string"
  ) {
    return {
      kind: "succeeded",
      providerOperationRef: body.providerOperationRef,
      outputs: {
        publication: {
          providerPostRef: body.providerPostRef,
          publishedAt: body.publishedAt,
        },
      },
      evidence: evidence(response.requestId, response.status, "accepted"),
      usage: [],
    };
  }
  if (
    body?.state === "failed" &&
    (typeof body.providerOperationRef === "string" ||
      body.providerOperationRef === null) &&
    typeof body.failureCode === "string" &&
    typeof body.retryable === "boolean" &&
    (body.effectDisposition === "not_created" ||
      body.effectDisposition === "terminal_failed")
  ) {
    return {
      kind: "failed_known",
      providerOperationRef: body.providerOperationRef,
      failureCode: body.failureCode,
      retryHint: body.retryable
        ? { retryable: true, retryAfterMs: body.retryAfterMs ?? null }
        : { retryable: false, retryAfterMs: null },
      evidence: {
        ...evidence(response.requestId, response.status, "unknown"),
        effectDisposition: body.effectDisposition,
      },
      usage: [],
    };
  }
  if (
    body?.state === "pending" &&
    typeof body.providerOperationRef === "string" &&
    typeof body.pollAfterMs === "number"
  ) {
    return {
      kind: "outcome_unknown",
      providerOperationRef: body.providerOperationRef,
      failureCode: "PLATFORM_EFFECT_PENDING",
      pollAfterMs: body.pollAfterMs,
      evidence: evidence(response.requestId, response.status, "accepted"),
      usage: [],
    };
  }
  return {
    kind: "outcome_unknown",
    providerOperationRef: safeReference(response.body),
    failureCode: "PLATFORM_RESPONSE_MALFORMED",
    pollAfterMs: null,
    evidence: evidence(response.requestId, response.status, "accepted"),
    usage: [],
  };
}

function transportFailure(
  error: unknown,
): ProviderOutcome<DeterministicLinkedInOutput> {
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
          : "PLATFORM_NOT_CONTACTED",
      retryHint:
        error.kind === "idempotency_conflict"
          ? { retryable: false, retryAfterMs: null }
          : { retryable: true, retryAfterMs: error.retryAfterMs },
      evidence: {
        ...evidence(null, null, "unknown"),
        effectDisposition: "not_created",
      },
      usage: [],
    };
  }
  return {
    kind: "outcome_unknown",
    providerOperationRef:
      error instanceof ProviderTransportFault
        ? error.providerOperationRef
        : null,
    failureCode: "PLATFORM_TRANSPORT_OUTCOME_UNKNOWN",
    pollAfterMs: null,
    evidence: evidence(
      null,
      null,
      error instanceof ProviderTransportFault &&
          error.effectDisposition === "accepted"
        ? "accepted"
        : "unknown",
    ),
    usage: [],
  };
}

/** Stateless normalization boundary; the transport represents the Platform. */
export class DeterministicLinkedInPlatformAdapter
  implements ProviderAdapter<DeterministicLinkedInIntent, DeterministicLinkedInOutput>
{
  readonly contract = DETERMINISTIC_LINKEDIN_PLATFORM_CONTRACT;

  constructor(private readonly transport: ProviderAdapterTransport) {}

  async execute(
    input: ProviderEffectRequest<DeterministicLinkedInIntent>,
  ): Promise<ProviderOutcome<DeterministicLinkedInOutput>> {
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
    input: ProviderObservationRequest<DeterministicLinkedInIntent>,
  ): Promise<ProviderOutcome<DeterministicLinkedInOutput>> {
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

interface FakeEffect {
  intentDigest: string;
  providerOperationRef: string;
  providerPostRef: string;
  completeAt: Date;
}

/** Deterministic external-platform simulator; it owns only external effect state. */
export class DeterministicLinkedInPlatformTransport
  implements ProviderAdapterTransport
{
  readonly effects = new Map<string, FakeEffect>();
  readonly launchCalls: ProviderTransportEffectRequest[] = [];
  readonly observationCalls: ProviderTransportObservationRequest[] = [];

  constructor(
    private readonly now: () => Date,
    private readonly completionLatencyMs = 1_000,
  ) {}

  async launch(
    request: ProviderTransportEffectRequest,
  ): Promise<ProviderTransportResponse> {
    this.launchCalls.push(structuredClone(request));
    const intent = deterministicLinkedInIntentSchema.parse(request.intent);
    const existing = this.effects.get(request.effectKey);
    if (existing && existing.intentDigest !== request.intentDigest) {
      throw new ProviderTransportFault(
        "idempotency_conflict",
        "not_created",
        null,
      );
    }
    const suffix = createHash("sha256")
      .update(request.effectKey)
      .digest("hex")
      .slice(0, 24);
    const acceptedAt = this.now();
    const publishAt = new Date(intent.publishAt);
    const effect = existing ?? {
      intentDigest: request.intentDigest,
      providerOperationRef: `linkedin:effect:${suffix}`,
      providerPostRef: `urn:li:share:${suffix}`,
      completeAt: new Date(
        Math.max(acceptedAt.getTime(), publishAt.getTime()) +
          this.completionLatencyMs,
      ),
    };
    this.effects.set(request.effectKey, effect);
    return this.responseFor(effect);
  }

  async observe(
    request: ProviderTransportObservationRequest,
  ): Promise<ProviderTransportResponse> {
    this.observationCalls.push(structuredClone(request));
    const effect = this.effects.get(request.effectKey);
    if (
      !effect ||
      effect.intentDigest !== request.intentDigest ||
      effect.providerOperationRef !== request.providerOperationRef
    ) {
      throw new ProviderTransportFault(
        "idempotency_conflict",
        "not_created",
        null,
      );
    }
    return this.responseFor(effect);
  }

  private responseFor(effect: FakeEffect): ProviderTransportResponse {
    if (this.now().getTime() < effect.completeAt.getTime()) {
      return {
        status: 202,
        requestId: `request:${effect.providerOperationRef.split(":").at(-1)}`,
        body: {
          state: "pending",
          providerOperationRef: effect.providerOperationRef,
          pollAfterMs: Math.max(
            1,
            effect.completeAt.getTime() - this.now().getTime(),
          ),
        } satisfies PlatformBody,
      };
    }
    return {
      status: 200,
      requestId: `request:${effect.providerOperationRef.split(":").at(-1)}`,
      body: {
        state: "published",
        providerOperationRef: effect.providerOperationRef,
        providerPostRef: effect.providerPostRef,
        publishedAt: effect.completeAt.toISOString(),
      } satisfies PlatformBody,
    };
  }
}
