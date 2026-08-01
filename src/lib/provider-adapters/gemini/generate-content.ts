import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  canonicalProviderSchemaDigest,
  ProviderTransportFault,
  type ProviderAdapter,
  type ProviderAdapterContract,
  type ProviderAdapterTransport,
  type ProviderEffectRequest,
  type ProviderOutcome,
  type ProviderTransportResponse,
  type ProviderUsageEvidence,
  type WorkflowProviderOutputs,
} from "@/lib/agent-runtime/runs/provider-adapter";

const TEXT_CONTRACT_DIGEST =
  "sha256:fb494fb8de2cf72b3d8b97b8cc7bd9fb3e87f7c8dfee72e1861c262339a41dc7";
const IMAGE_CONTRACT_DIGEST =
  "sha256:2e4b7d03dc18b5b94138a634997cc03ab317ec2ff0a2013088bdf0f13843eaa0";
const API_OPERATION = "generativelanguage.v1beta.models.generateContent";
const PROMPT_MAX_LENGTH = 100_000;
const INSTRUCTION_MAX_LENGTH = 4_000;
const INPUT_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
const OUTPUT_IMAGE_MEDIA_TYPES = ["image/png"] as const;
const IMAGE_ASPECT_RATIOS = ["1:1", "4:5", "16:9"] as const;
const SAFE_PROVIDER_ERROR_CODES = new Set([
  "API_KEY_INVALID",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "RESOURCE_EXHAUSTED",
  "INVALID_ARGUMENT",
  "MISSING_KEY",
]);
const SAFE_FINISH_REASONS = new Set([
  "FINISH_REASON_UNSPECIFIED",
  "STOP",
  "MAX_TOKENS",
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "OTHER",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "MALFORMED_FUNCTION_CALL",
  "IMAGE_SAFETY",
  "UNEXPECTED_TOOL_CALL",
  "IMAGE_PROHIBITED_CONTENT",
  "NO_IMAGE",
]);

function safeProviderErrorCode(value: string | undefined): string | null {
  if (!value) return null;
  if (SAFE_PROVIDER_ERROR_CODES.has(value) || /^HTTP_[1-5][0-9]{2}$/.test(value)) {
    return value;
  }
  return "PROVIDER_ERROR";
}

function safeFinishReasonCode(value: string | undefined): string | null {
  return value && SAFE_FINISH_REASONS.has(value)
    ? `FINISH_REASON_${value}`
    : value
      ? "FINISH_REASON_UNKNOWN"
      : null;
}

const byteArray = z.custom<Uint8Array>(
  (value) =>
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]",
).meta({ runtimeType: "Uint8Array" });

const textIntentSchema = z
  .object({
    prompt: z.string().min(1).max(PROMPT_MAX_LENGTH),
    instruction: z.string().min(1).max(INSTRUCTION_MAX_LENGTH),
  })
  .strict();
const imageIntentSchema = z
  .object({
    prompt: z.string().min(1).max(PROMPT_MAX_LENGTH),
    aspectRatio: z.enum(IMAGE_ASPECT_RATIOS),
    referenceImage: z
      .object({
        bytes: byteArray,
        mediaType: z.enum(INPUT_IMAGE_MEDIA_TYPES),
      })
      .strict(),
  })
  .strict();

export type GeminiTextIntent = z.infer<typeof textIntentSchema>;
export type GeminiImageIntent = z.infer<typeof imageIntentSchema>;

const textOutputs = z
  .object({
    text: z
      .object({
        kind: z.literal("text"),
        mediaType: z.literal("text/plain; charset=utf-8"),
        bytes: byteArray,
      })
      .strict(),
  })
  .strict();
const imageOutputs = z
  .object({
    image: z
      .object({
        kind: z.literal("image"),
        mediaType: z.enum(OUTPUT_IMAGE_MEDIA_TYPES),
        bytes: byteArray,
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const usageDimensions = Object.freeze([
  Object.freeze({
    dimension: "gemini.tokens.input@1",
    unit: "count" as const,
    applicability: "always" as const,
    maximumQuantity: null,
  }),
  Object.freeze({
    dimension: "gemini.tokens.output@1",
    unit: "count" as const,
    applicability: "response_dependent" as const,
    maximumQuantity: null,
  }),
]);

// The immutable fingerprints are derived from the actual runtime validators.
// Zod metadata supplies the one non-JSON runtime primitive in the contract.
const schemaDescriptors = Object.freeze({
  textIntent: z.toJSONSchema(textIntentSchema, { unrepresentable: "any" }),
  imageIntent: z.toJSONSchema(imageIntentSchema, { unrepresentable: "any" }),
  textOutputs: z.toJSONSchema(textOutputs, { unrepresentable: "any" }),
  imageOutputs: z.toJSONSchema(imageOutputs, { unrepresentable: "any" }),
});

const launchSafety = Object.freeze({
  mode: "durable_at_most_once" as const,
  guard: "workflow-step-attempt/v1" as const,
  replay: "never_launch" as const,
});

export const GEMINI_TEXT_CONTRACT: ProviderAdapterContract<
  GeminiTextIntent,
  WorkflowProviderOutputs
> = Object.freeze({
  schema: "provider-adapter-contract/v1",
  adapterRevision: "gemini-generate-content-v1",
  inputSchemaDigest: canonicalProviderSchemaDigest(schemaDescriptors.textIntent),
  outputSchemaDigest: canonicalProviderSchemaDigest(schemaDescriptors.textOutputs),
  identity: Object.freeze({
    schema: "provider-operation-identity/v1",
    workflowOperationIdentity: "gemini.generate_text@1",
    workflowOperationContractDigest: TEXT_CONTRACT_DIGEST,
    provider: "gemini",
    operation: API_OPERATION,
    model: "gemini-2.5-flash",
  }),
  effectKeySupport: "unsupported",
  launchSafety,
  observation: "none",
  inputSchema: textIntentSchema,
  outputSchema: textOutputs,
  usageDimensions,
});

export const GEMINI_IMAGE_CONTRACT: ProviderAdapterContract<
  GeminiImageIntent,
  WorkflowProviderOutputs
> = Object.freeze({
  schema: "provider-adapter-contract/v1",
  adapterRevision: "gemini-generate-content-v1",
  inputSchemaDigest: canonicalProviderSchemaDigest(schemaDescriptors.imageIntent),
  outputSchemaDigest: canonicalProviderSchemaDigest(schemaDescriptors.imageOutputs),
  identity: Object.freeze({
    schema: "provider-operation-identity/v1",
    workflowOperationIdentity: "gemini.generate_image@1",
    workflowOperationContractDigest: IMAGE_CONTRACT_DIGEST,
    provider: "gemini",
    operation: API_OPERATION,
    model: "gemini-2.5-flash-image",
  }),
  effectKeySupport: "unsupported",
  launchSafety,
  observation: "none",
  inputSchema: imageIntentSchema,
  outputSchema: imageOutputs,
  usageDimensions,
});

interface GeminiTransportBody {
  responseId?: string;
  modelVersion?: string;
  text?: string;
  image?: { data: string; mediaType: string };
  usage?: { input?: number; output?: number };
  blocked?: boolean;
  finishReason?: string;
  errorCode?: string;
}

export class GeminiGenerateContentTransport
  implements ProviderAdapterTransport
{
  constructor(private readonly timeoutMs = 120_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
      throw new TypeError("Gemini transport timeout is invalid.");
    }
  }

  async launch(
    request: Parameters<ProviderAdapterTransport["launch"]>[0],
  ): Promise<ProviderTransportResponse> {
    const secret = request.credentials.primary?.secret;
    if (!secret) {
      return { status: 401, requestId: null, body: { errorCode: "MISSING_KEY" } };
    }
    try {
      const client = new GoogleGenAI({
        apiKey: secret,
        apiVersion: "v1beta",
        httpOptions: { timeout: this.timeoutMs },
      });
      const isImage = request.operation.workflowOperationIdentity ===
        "gemini.generate_image@1";
      const intent = request.intent as GeminiTextIntent | GeminiImageIntent;
      const parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [{ text: intent.prompt }];
      if (isImage) {
        const imageIntent = intent as GeminiImageIntent;
        parts.push({
          inlineData: {
            mimeType: imageIntent.referenceImage.mediaType,
            data: Buffer.from(imageIntent.referenceImage.bytes).toString("base64"),
          },
        });
      }
      const response = await client.models.generateContent({
        model: request.operation.model,
        contents: [{ role: "user", parts }],
        config: isImage
          ? {
              responseModalities: ["IMAGE", "TEXT"],
              imageConfig: {
                aspectRatio: (intent as GeminiImageIntent).aspectRatio,
              },
            }
          : { systemInstruction: (intent as GeminiTextIntent).instruction },
      });
      const body: GeminiTransportBody = {
        responseId: response.responseId,
        modelVersion: response.modelVersion,
        usage: {
          input: response.usageMetadata?.promptTokenCount,
          output: response.usageMetadata?.candidatesTokenCount,
        },
        blocked:
          Boolean(response.promptFeedback?.blockReason) ||
          [
            "SAFETY",
            "BLOCKLIST",
            "PROHIBITED_CONTENT",
            "RECITATION",
            "IMAGE_SAFETY",
            "SPII",
            "IMAGE_PROHIBITED_CONTENT",
            "NO_IMAGE",
          ].includes(String(response.candidates?.[0]?.finishReason ?? "")),
        finishReason: String(
          response.candidates?.[0]?.finishReason ??
            response.promptFeedback?.blockReason ??
            "",
        ) || undefined,
      };
      const responseParts = response.candidates?.[0]?.content?.parts ?? [];
      const inline = responseParts.find((part) => part.inlineData?.data)?.inlineData;
      const text = responseParts
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (inline?.data) {
        body.image = {
          data: inline.data,
          mediaType: inline.mimeType ?? "image/png",
        };
      }
      if (text) body.text = text;
      return { status: 200, requestId: response.responseId ?? null, body };
    } catch (error) {
      if (error instanceof ApiError) {
        const machineCode = [
          "API_KEY_INVALID",
          "PERMISSION_DENIED",
          "UNAUTHENTICATED",
          "RESOURCE_EXHAUSTED",
          "INVALID_ARGUMENT",
        ].find((code) => error.message.includes(code));
        return {
          status: error.status,
          requestId: null,
          body: { errorCode: machineCode ?? `HTTP_${error.status}` },
        };
      }
      if (
        error instanceof Error &&
        ["AbortError", "TimeoutError"].includes(error.name)
      ) {
        throw new ProviderTransportFault("timeout", "unknown", null);
      }
      throw new ProviderTransportFault("disconnect", "unknown", null);
    }
  }

  async observe(): Promise<ProviderTransportResponse> {
    throw new ProviderTransportFault("disconnect", "unknown", null);
  }
}

function usage(body: GeminiTransportBody): ProviderUsageEvidence[] {
  return usageDimensions.map((dimension) => {
    const quantity =
      dimension.dimension === "gemini.tokens.input@1"
        ? body.usage?.input
        : body.usage?.output;
    return typeof quantity === "number" && Number.isInteger(quantity) && quantity >= 0
      ? {
          dimension: dimension.dimension,
          unit: dimension.unit,
          source: "reported" as const,
          quantity: String(quantity),
        }
      : {
          dimension: dimension.dimension,
          unit: dimension.unit,
          source: "unknown" as const,
          quantity: null,
        };
  });
}

function dimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

function normalize<I>(
  contract: ProviderAdapterContract<I, WorkflowProviderOutputs>,
  response: ProviderTransportResponse,
): ProviderOutcome<WorkflowProviderOutputs> {
  const body =
    response.body && typeof response.body === "object"
      ? (response.body as GeminiTransportBody)
      : {};
  const evidence = {
    providerRequestId: response.requestId,
    httpStatus: response.status,
    providerCode:
      typeof body.errorCode === "string"
        ? safeProviderErrorCode(body.errorCode)
        : safeFinishReasonCode(body.finishReason),
    operatorTraceRef: null,
  };
  if (response.status >= 400 && response.status < 500) {
    return {
      kind: "failed_known",
      providerOperationRef: null,
      failureCode:
        response.status === 429
          ? "PROVIDER_RATE_LIMITED"
          : response.status === 401 ||
              response.status === 403 ||
              ["API_KEY_INVALID", "PERMISSION_DENIED", "UNAUTHENTICATED"].includes(
                body.errorCode ?? "",
              )
            ? "PROVIDER_CREDENTIAL_REJECTED"
            : "PROVIDER_REJECTED_REQUEST",
      retryHint:
        response.status === 429
          ? { retryable: true, retryAfterMs: null }
          : { retryable: false, retryAfterMs: null },
      evidence: { ...evidence, effectDisposition: "not_created" },
      usage: usage(body),
    };
  }
  const operationRef = body.responseId ?? response.requestId;
  const exactModel = body.modelVersion?.replace(/^models\//, "");
  if (body.blocked && exactModel === contract.identity.model) {
    return {
      kind: "failed_known",
      providerOperationRef: operationRef ?? null,
      failureCode: "PROVIDER_SAFETY_REJECTION",
      retryHint: { retryable: false, retryAfterMs: null },
      evidence: { ...evidence, effectDisposition: "terminal_failed" },
      usage: usage(body),
    };
  }
  let outputs: WorkflowProviderOutputs | null = null;
  if (contract.identity.workflowOperationIdentity === "gemini.generate_text@1") {
    if (typeof body.text === "string" && body.text.trim()) {
      outputs = {
        text: {
          kind: "text",
          mediaType: "text/plain; charset=utf-8",
          bytes: Buffer.from(body.text, "utf8"),
        },
      };
    }
  } else if (body.image?.data) {
    const bytes = Buffer.from(body.image.data, "base64");
    const size = dimensions(bytes);
    if (size && body.image.mediaType === "image/png") {
      outputs = {
        image: {
          kind: "image",
          mediaType: body.image.mediaType,
          bytes,
          ...size,
        },
      };
    }
  }
  if (
    response.status === 200 &&
    operationRef &&
    outputs &&
    exactModel === contract.identity.model
  ) {
    return {
      kind: "succeeded",
      providerOperationRef: operationRef,
      outputs,
      evidence: { ...evidence, effectDisposition: "accepted" },
      usage: usage(body),
    };
  }
  if (
    response.status === 200 &&
    operationRef &&
    exactModel === contract.identity.model &&
    !outputs &&
    body.finishReason &&
    body.finishReason !== "FINISH_REASON_UNSPECIFIED"
  ) {
    return {
      kind: "failed_known",
      providerOperationRef: operationRef,
      failureCode: "PROVIDER_GENERATION_TERMINATED",
      retryHint: { retryable: false, retryAfterMs: null },
      evidence: { ...evidence, effectDisposition: "terminal_failed" },
      usage: usage(body),
    };
  }
  return {
    kind: "outcome_unknown",
    providerOperationRef: operationRef ?? null,
    failureCode: "PROVIDER_RESPONSE_AMBIGUOUS",
    pollAfterMs: null,
    evidence: { ...evidence, effectDisposition: operationRef ? "accepted" : "unknown" },
    usage: usage(body),
  };
}

abstract class GeminiAdapter<I>
  implements ProviderAdapter<I, WorkflowProviderOutputs>
{
  constructor(
    readonly contract: ProviderAdapterContract<I, WorkflowProviderOutputs>,
    private readonly transport: ProviderAdapterTransport,
  ) {}

  async execute(
    input: ProviderEffectRequest<I>,
  ): Promise<ProviderOutcome<WorkflowProviderOutputs>> {
    try {
      return normalize(
        this.contract,
        await this.transport.launch({
          operation: this.contract.identity,
          effectKey: input.effectKey,
          intentDigest: input.intentDigest,
          intent: input.intent,
          credentials: input.credentials,
        }),
      );
    } catch (error) {
      if (
        error instanceof ProviderTransportFault &&
        error.effectDisposition === "not_created"
      ) {
        return {
          kind: "failed_known",
          providerOperationRef: error.providerOperationRef,
          failureCode: "PROVIDER_NOT_CONTACTED",
          retryHint: { retryable: true, retryAfterMs: error.retryAfterMs },
          evidence: {
            providerRequestId: null,
            httpStatus: null,
            providerCode: null,
            operatorTraceRef: null,
            effectDisposition: "not_created",
          },
          usage: usage({}),
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
        evidence: {
          providerRequestId: null,
          httpStatus: null,
          providerCode: null,
          operatorTraceRef: null,
          effectDisposition:
            error instanceof ProviderTransportFault &&
            error.effectDisposition === "accepted"
              ? "accepted"
              : "unknown",
        },
        usage: usage({}),
      };
    }
  }
}

export class GeminiTextAdapter extends GeminiAdapter<GeminiTextIntent> {
  constructor(transport: ProviderAdapterTransport = new GeminiGenerateContentTransport()) {
    super(GEMINI_TEXT_CONTRACT, transport);
  }
}

export class GeminiImageAdapter extends GeminiAdapter<GeminiImageIntent> {
  constructor(transport: ProviderAdapterTransport = new GeminiGenerateContentTransport()) {
    super(GEMINI_IMAGE_CONTRACT, transport);
  }
}
