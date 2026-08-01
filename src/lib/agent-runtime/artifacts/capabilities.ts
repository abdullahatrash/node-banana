import { z } from "zod";
import {
  COMMON_DISCOVERY_ERRORS,
  QUERY_EFFECT,
  defineCapability,
} from "@/lib/agent-tools/registry";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import type {
  CapabilityRegistration,
  JsonSchema,
  ResolvedSecurityContext,
} from "@/types/capabilities";
import {
  ARTIFACT_ERROR_CATALOG,
  ARTIFACT_ERROR_CONTRACTS,
} from "./errors";
import {
  ArtifactService,
  ArtifactServiceError,
} from "./service";
import {
  ARTIFACT_DIGEST_PATTERN,
  ARTIFACT_ID_MAX_LENGTH,
  ARTIFACT_ID_MIN_LENGTH,
  ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH,
  ARTIFACT_IDEMPOTENCY_KEY_MIN_LENGTH,
  ARTIFACT_MAX_IMAGE_BYTES,
  ARTIFACT_MAX_TEXT_BYTES,
  ARTIFACT_MEDIA_TYPE_MAX_LENGTH,
  ARTIFACT_MEDIA_TYPE_MIN_LENGTH,
  isValidArtifactDigest,
  isValidArtifactId,
  isValidArtifactIdempotencyKey,
  isValidArtifactMediaType,
} from "./validation";

export const ARTIFACT_CAPABILITY_IDENTITIES = {
  import: { name: "artifacts.import", version: 1 },
  uploadBegin: { name: "artifact_uploads.begin", version: 1 },
  uploadComplete: { name: "artifact_uploads.complete", version: 1 },
  get: { name: "artifacts.get", version: 1 },
  list: { name: "artifacts.list", version: 1 },
  downloadCreate: { name: "artifact_downloads.create", version: 1 },
} as const;

const lifecycle = {
  status: "active",
  introducedAt: "2026-07-25T00:00:00.000Z",
  recommended: true,
} as const;

const mutationEffect = {
  mutation: "runtime-state",
  visibility: "private",
  timing: "immediate",
  reversibility: "conditional",
  maySpendProviderBudget: false,
} as const;

const id = z
  .string()
  .trim()
  .min(ARTIFACT_ID_MIN_LENGTH)
  .max(ARTIFACT_ID_MAX_LENGTH)
  .refine(isValidArtifactId, "Artifact identifiers use an invalid format.");
const idempotencyKey = z
  .string()
  .trim()
  .min(ARTIFACT_IDEMPOTENCY_KEY_MIN_LENGTH)
  .max(ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH)
  .refine(
    isValidArtifactIdempotencyKey,
    "Idempotency keys cannot contain control characters.",
  );
const digest = z
  .string()
  .refine(isValidArtifactDigest, "Expected digest must be lowercase SHA-256.");
const mediaType = z
  .string()
  .trim()
  .min(ARTIFACT_MEDIA_TYPE_MIN_LENGTH)
  .max(ARTIFACT_MEDIA_TYPE_MAX_LENGTH)
  .refine(isValidArtifactMediaType, "Artifact media type is invalid.");

const strictObject = (
  required: string[],
  properties: Record<string, JsonSchema>,
): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

const providerEvidenceSchema = strictObject(
  [
    "providerRequestId",
    "httpStatus",
    "providerCode",
    "operatorTraceRef",
    "effectDisposition",
  ],
  {
    providerRequestId: { type: ["string", "null"] },
    httpStatus: { type: ["integer", "null"], minimum: 100, maximum: 599 },
    providerCode: { type: ["string", "null"] },
    operatorTraceRef: { type: ["string", "null"] },
    effectDisposition: {
      type: "string",
      enum: ["not_created", "accepted", "terminal_failed", "unknown"],
    },
  },
);
const usageCommon = {
  dimension: {
    type: "string",
    pattern: "^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$",
  },
  unit: {
    type: "string",
    enum: ["count", "byte", "millisecond", "megapixel"],
  },
} satisfies Record<string, JsonSchema>;
const providerMetadataSchema = strictObject(
  ["evidence", "usage", "retryAfterMs", "pollAfterMs"],
  {
    evidence: providerEvidenceSchema,
    usage: {
      type: "array",
      items: {
        oneOf: [
          strictObject(["dimension", "unit", "source", "quantity"], {
            ...usageCommon,
            source: {
              type: "string",
              enum: ["reported", "measured", "estimated"],
            },
            quantity: {
              type: "string",
              pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            },
          }),
          strictObject(["dimension", "unit", "source", "quantity"], {
            ...usageCommon,
            source: { const: "unknown" },
            quantity: { type: "null" },
          }),
        ],
      },
    },
    reportedCost: {
      oneOf: [
        { type: "null" },
        strictObject(["amount", "currency", "evidenceRef"], {
          amount: { type: "string", pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$" },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
          evidenceRef: { type: "string", pattern: "^evidence:sha256:[a-f0-9]{64}$" },
        }),
      ],
    },
    retryAfterMs: { type: ["integer", "null"], minimum: 0 },
    pollAfterMs: { type: ["integer", "null"], minimum: 0 },
  },
);

const importedOriginSchema = strictObject(["kind", "importedAt"], {
  kind: { const: "imported" },
  importedAt: { type: "string", format: "date-time" },
});
const generatedOriginSchema = strictObject(
  [
    "kind",
    "generatedAt",
    "workflowRevision",
    "run",
    "stepAttempt",
    "providerOperation",
    "effectKey",
    "outputName",
  ],
  {
    kind: { const: "generated" },
    generatedAt: { type: "string", format: "date-time" },
    workflowRevision: strictObject(
      ["workflowId", "revisionId", "revision", "definitionDigest"],
      {
        workflowId: { type: "string" },
        revisionId: { type: "string" },
        revision: { type: "integer", minimum: 1 },
        definitionDigest: {
          type: "string",
          pattern: ARTIFACT_DIGEST_PATTERN.source,
        },
      },
    ),
    run: strictObject(["runId", "startSnapshotDigest"], {
      runId: { type: "string" },
      startSnapshotDigest: {
        type: "string",
        pattern: ARTIFACT_DIGEST_PATTERN.source,
      },
    }),
    stepAttempt: strictObject(
      ["stepAttemptId", "stepId", "attempt"],
      {
        stepAttemptId: { type: "string" },
        stepId: { type: "string" },
        attempt: { type: "integer", minimum: 1 },
      },
    ),
    providerOperation: strictObject(
      [
        "provider",
        "operationIdentity",
        "operation",
        "ref",
        "model",
        "intentDigest",
        "metadata",
      ],
      {
        provider: { type: "string" },
        operationIdentity: { type: "string" },
        operation: { type: "string" },
        ref: { type: "string" },
        model: { type: "string" },
        intentDigest: {
          type: "string",
          pattern: ARTIFACT_DIGEST_PATTERN.source,
        },
        metadata: { oneOf: [{ type: "null" }, providerMetadataSchema] },
      },
    ),
    effectKey: { type: "string" },
    outputName: { type: "string" },
  },
);

const lineageSourceSchema: JsonSchema = {
  oneOf: [
    strictObject(["kind", "inputName"], {
      kind: { const: "workflow_input" },
      inputName: { type: "string" },
    }),
    strictObject(["kind", "stepAttemptId", "outputName"], {
      kind: { const: "step_output" },
      stepAttemptId: { type: "string" },
      outputName: { type: "string" },
    }),
  ],
};

const metadataSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "workspaceId",
    "kind",
    "digest",
    "sizeBytes",
    "mediaType",
    "width",
    "height",
    "creatorPrincipalId",
    "origin",
    "retention",
    "lineage",
    "createdAt",
  ],
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    kind: { type: "string", enum: ["text", "image"] },
    digest: { type: "string", pattern: ARTIFACT_DIGEST_PATTERN.source },
    sizeBytes: { type: "integer", minimum: 0 },
    mediaType: { type: "string" },
    width: { type: ["integer", "null"] },
    height: { type: ["integer", "null"] },
    creatorPrincipalId: { type: "string" },
    origin: { oneOf: [importedOriginSchema, generatedOriginSchema] },
    retention: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "snapshotAt"],
      properties: {
        mode: { type: "string", const: "workspace_default" },
        snapshotAt: { type: "string", format: "date-time" },
      },
    },
    lineage: {
      type: "object",
      additionalProperties: false,
      required: ["inputs", "sourceArtifactIds"],
      properties: {
        inputs: {
          type: "array",
          items: strictObject(
            ["port", "kind", "source", "contentDigest", "artifactId"],
            {
              port: { type: "string" },
              kind: { type: "string", enum: ["text", "image"] },
              source: lineageSourceSchema,
              contentDigest: {
                type: "string",
                pattern: ARTIFACT_DIGEST_PATTERN.source,
              },
              artifactId: { type: ["string", "null"] },
            },
          ),
        },
        sourceArtifactIds: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    createdAt: { type: "string", format: "date-time" },
  },
};

function agent(
  context: ResolvedSecurityContext | undefined,
): Extract<ResolvedSecurityContext, { kind: "agent" }> {
  if (!context || context.kind !== "agent") {
    throw new CapabilityFailure({
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Artifact capability is not authorized.",
    });
  }
  return context;
}

async function domain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ArtifactServiceError)) throw error;
    throw new CapabilityFailure({
      code: error.code,
      category: ARTIFACT_ERROR_CATALOG[error.code].category,
      message: error.message,
      retryable: error.retryable,
    });
  }
}

export function createArtifactRegistrations(
  service: ArtifactService,
): CapabilityRegistration[] {
  return [
    defineCapability({
      identity: ARTIFACT_CAPABILITY_IDENTITIES.import,
      summary:
        "Import exact UTF-8 text as an immutable, content-addressed Artifact.",
      lifecycle,
      input: z
        .object({
          idempotencyKey,
          text: z.string().max(ARTIFACT_MAX_TEXT_BYTES),
          mediaType: mediaType.optional(),
          expectedDigest: digest.optional(),
          expectedSizeBytes: z
            .number()
            .int()
            .min(0)
            .max(ARTIFACT_MAX_TEXT_BYTES)
            .optional(),
        })
        .strict(),
      outputSchema: metadataSchema,
      effect: mutationEffect,
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: { resources: [] },
      errors: [...COMMON_DISCOVERY_ERRORS, ...ARTIFACT_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.importText({
            ...input,
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
          }),
        );
      },
    }),
    defineCapability({
      identity: ARTIFACT_CAPABILITY_IDENTITIES.uploadBegin,
      summary:
        "Create a Principal-bound, short-lived upload handoff for an image Artifact.",
      lifecycle,
      input: z
        .object({
          idempotencyKey,
          mediaType,
          expectedDigest: digest.optional(),
          expectedSizeBytes: z
            .number()
            .int()
            .min(1)
            .max(ARTIFACT_MAX_IMAGE_BYTES),
        })
        .strict(),
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["uploadId", "uploadUrl", "expiresAt", "requiredHeaders"],
        properties: {
          uploadId: { type: "string" },
          uploadUrl: { type: "string", format: "uri" },
          expiresAt: { type: "string", format: "date-time" },
          requiredHeaders: {
            type: "object",
            additionalProperties: false,
            required: ["contentType", "contentLength"],
            properties: {
              contentType: { type: "string" },
              contentLength: {
                type: "integer",
                minimum: 1,
                maximum: ARTIFACT_MAX_IMAGE_BYTES,
              },
            },
          },
        },
      },
      effect: mutationEffect,
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: { resources: [] },
      errors: [...COMMON_DISCOVERY_ERRORS, ...ARTIFACT_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.beginImageUpload({
            ...input,
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
          }),
        );
      },
    }),
    defineCapability({
      identity: ARTIFACT_CAPABILITY_IDENTITIES.uploadComplete,
      summary:
        "Verify and atomically commit a Principal-bound image upload as an Artifact.",
      lifecycle,
      input: z.object({ idempotencyKey, uploadId: id }).strict(),
      outputSchema: metadataSchema,
      effect: mutationEffect,
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: { resources: [] },
      errors: [...COMMON_DISCOVERY_ERRORS, ...ARTIFACT_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.completeImageUpload({
            ...input,
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
          }),
        );
      },
    }),
    defineCapability({
      identity: ARTIFACT_CAPABILITY_IDENTITIES.get,
      summary:
        "Retrieve one authorized Artifact and inline text content without storage references.",
      lifecycle,
      input: z.object({ artifactId: id }).strict(),
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["artifact", "textContent"],
        properties: {
          artifact: metadataSchema,
          textContent: { type: ["string", "null"] },
        },
      },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: {
        resources: [{ kind: "artifact", inputPath: "artifactId" }],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...ARTIFACT_ERROR_CONTRACTS],
      handler: ({ artifactId }, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.getArtifact({
            workspaceId: principal.workspaceId,
            artifactId,
          }),
        );
      },
    }),
    defineCapability({
      identity: ARTIFACT_CAPABILITY_IDENTITIES.list,
      summary:
        "List the explicitly granted Workspace-wide Artifact collection with an opaque Principal-bound cursor.",
      lifecycle,
      input: z
        .object({
          kind: z.enum(["text", "image"]).optional(),
          mediaType: mediaType.optional(),
          creatorPrincipalId: id.optional(),
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.string().min(1).max(2_048).optional(),
        })
        .strict(),
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["artifacts", "nextCursor"],
        properties: {
          artifacts: { type: "array", items: metadataSchema },
          nextCursor: { type: ["string", "null"] },
        },
      },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      // The exact list capability grant is the explicit Workspace-wide
      // collection grant. It is intentionally not inferred from artifactIds.
      authorization: { resources: [] },
      errors: [...COMMON_DISCOVERY_ERRORS, ...ARTIFACT_ERROR_CONTRACTS],
      handler: ({ limit, cursor, ...filters }, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.listArtifacts({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            filters,
            limit,
            cursor,
          }),
        );
      },
    }),
    defineCapability({
      identity: ARTIFACT_CAPABILITY_IDENTITIES.downloadCreate,
      summary:
        "Create a short-lived download handoff for one exact authorized image Artifact.",
      lifecycle,
      input: z.object({ artifactId: id }).strict(),
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["artifactId", "downloadUrl", "expiresAt"],
        properties: {
          artifactId: { type: "string" },
          downloadUrl: { type: "string", format: "uri" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      effect: mutationEffect,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: {
        resources: [{ kind: "artifact", inputPath: "artifactId" }],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...ARTIFACT_ERROR_CONTRACTS],
      handler: ({ artifactId }, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.createDownload({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            artifactId,
          }),
        );
      },
    }),
  ];
}
