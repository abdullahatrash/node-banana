import { z } from "zod";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import {
  COMMON_DISCOVERY_ERRORS,
  QUERY_EFFECT,
  defineCapability,
} from "@/lib/agent-tools/registry";
import type {
  CapabilityRegistration,
  JsonSchema,
  ResolvedSecurityContext,
} from "@/types/capabilities";
import {
  WORKFLOW_RUN_ERROR_CATALOG,
  WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS,
  WorkflowRunError,
} from "./errors";
import { WorkflowRunService } from "./service";
import type { RunAdmissionPreview } from "../budgets/types";

export const WORKFLOW_RUN_CAPABILITY_IDENTITIES = {
  preview: { name: "workflow_runs.preview", version: 1 },
  start: { name: "workflow_runs.start", version: 1 },
  startV2: { name: "workflow_runs.start", version: 2 },
  retry: { name: "workflow_runs.retry", version: 1 },
  reconcile: { name: "workflow_runs.reconcile", version: 1 },
  resume: { name: "workflow_runs.resume", version: 1 },
  get: { name: "workflow_runs.get", version: 1 },
  events: { name: "workflow_run_events.list", version: 1 },
  stepAttempts: { name: "workflow_step_attempts.list", version: 1 },
  runArtifact: { name: "workflow_run_artifacts.get", version: 1 },
} as const;

const lifecycle = {
  status: "active",
  introducedAt: "2026-07-25T00:00:00.000Z",
  recommended: true,
} as const;
const legacyLifecycle = {
  ...lifecycle,
  recommended: false,
} as const;

const object = {
  type: "object",
  additionalProperties: false,
} as const;
const id = z.string().trim().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const cursor = z.string().min(1).max(2_048);
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);
const resourceInput = z.object({ workflowId: id, runId: id }).strict();
const inputArtifactIds = z
  .array(id)
  .min(1)
  .max(100)
  .refine(
    (values) => new Set(values).size === values.length,
    "Input Artifact IDs must be unique.",
  );
const previewInputArtifactIds = z
  .array(id)
  .max(100)
  .refine(
    (values) => new Set(values).size === values.length,
    "Input Artifact IDs must be unique.",
  )
  .default([]);

const safeRunRefSchema: JsonSchema = {
  ...object,
  required: [
    "id",
    "workflowId",
    "workflowRevisionId",
    "state",
    "startSnapshotDigest",
    "acceptedAt",
  ],
  properties: {
    id: { type: "string" },
    workflowId: { type: "string" },
    workflowRevisionId: { type: "string" },
    state: {
      type: "string",
      enum: [
        "accepted",
        "running",
        "waiting",
        "outcome_unknown",
        "completed",
        "failed",
      ],
    },
    startSnapshotDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    acceptedAt: { type: "string", format: "date-time" },
  },
};

function continuationSchema(
  capability: string,
  required: string[],
): JsonSchema {
  return {
    ...object,
    required: ["capability", "input"],
    properties: {
      capability: { const: capability },
      input: {
        ...object,
        required,
        properties: Object.fromEntries(
          required.map((field) => [field, { type: "string" }]),
        ),
      },
    },
  };
}

const acceptedSchema: JsonSchema = {
  ...object,
  required: ["run", "inspect", "events"],
  properties: {
    run: {
      ...safeRunRefSchema,
      properties: {
        ...(safeRunRefSchema.properties ?? {}),
        state: { const: "accepted" },
      },
    },
    inspect: continuationSchema(
      "workflow_runs.get@1",
      ["workflowId", "runId"],
    ),
    events: continuationSchema(
      "workflow_run_events.list@1",
      ["workflowId", "runId", "cursor"],
    ),
  },
};

const decimalSchema: JsonSchema = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
};
const nullableDecimalSchema: JsonSchema = {
  oneOf: [decimalSchema, { type: "null" }],
};
const nullableStringSchema: JsonSchema = { type: ["string", "null"] };
const budgetPeriodSchema: JsonSchema = {
  ...object,
  required: ["kind", "timezone", "startsAt", "endsAt"],
  properties: {
    kind: {
      type: "string",
      enum: ["calendar_day", "calendar_week", "calendar_month", "lifetime"],
    },
    timezone: { type: "string" },
    startsAt: { type: "string", format: "date-time" },
    endsAt: {
      oneOf: [
        { type: "string", format: "date-time" },
        { type: "null" },
      ],
    },
  },
};
const previewPolicySchema: JsonSchema = {
  ...object,
  required: [
    "schema", "id", "workspaceId", "principalId", "scope", "currency",
    "period", "timezone", "status", "currentRevisionId", "createdAt", "updatedAt",
  ],
  properties: {
    schema: { const: "budget-policy/v1" },
    id: { type: "string" },
    workspaceId: { type: "string" },
    principalId: nullableStringSchema,
    scope: { type: "string", enum: ["workspace", "principal"] },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    period: {
      type: "string",
      enum: ["calendar_day", "calendar_week", "calendar_month", "lifetime"],
    },
    timezone: { type: "string" },
    status: { type: "string", enum: ["active", "revoked"] },
    currentRevisionId: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};
const previewPolicyRevisionSchema: JsonSchema = {
  ...object,
  required: [
    "schema", "id", "policyId", "workspaceId", "principalId", "revision",
    "warningThreshold", "hardLimit", "unknownPriceTreatment",
    "unknownPriceAllowance", "createdAt",
  ],
  properties: {
    schema: { const: "budget-policy-revision/v1" },
    id: { type: "string" },
    policyId: { type: "string" },
    workspaceId: { type: "string" },
    principalId: nullableStringSchema,
    revision: { type: "integer", minimum: 1 },
    warningThreshold: decimalSchema,
    hardLimit: decimalSchema,
    unknownPriceTreatment: {
      type: "string",
      enum: ["deny", "fixed_allowance"],
    },
    unknownPriceAllowance: nullableDecimalSchema,
    createdAt: { type: "string", format: "date-time" },
  },
};
const stepExposureSchema: JsonSchema = {
  ...object,
  required: [
    "stepId", "provider", "providerOperation", "model", "serviceTier",
    "automaticAttempts", "credentialSlotId", "credentialProfileId",
    "amountPerAttempt", "currency", "pricingSnapshotIds", "pricingSource",
  ],
  properties: {
    stepId: { type: "string" },
    provider: { type: "string" },
    providerOperation: { type: "string" },
    model: { type: "string" },
    serviceTier: { type: "string" },
    automaticAttempts: { type: "integer", minimum: 1, maximum: 100 },
    credentialSlotId: nullableStringSchema,
    credentialProfileId: nullableStringSchema,
    amountPerAttempt: nullableDecimalSchema,
    currency: {
      oneOf: [
        { type: "string", pattern: "^[A-Z]{3}$" },
        { type: "null" },
      ],
    },
    pricingSnapshotIds: {
      type: "array",
      items: { type: "string" },
      uniqueItems: true,
    },
    pricingSource: {
      type: "string",
      enum: ["workspace_override", "builtin_catalog", "unknown"],
    },
  },
};
const admissionPreviewSchema: JsonSchema = {
  ...object,
  required: [
    "schema", "workspaceId", "principalId", "workflowId",
    "workflowRevisionId", "evaluatedAt", "ceiling",
    "applicableCredentialSpendGrants", "applicablePolicies",
    "requiredReservations", "stepExposures", "warnings", "admissible",
    "denialReasons",
  ],
  properties: {
    schema: { const: "run-admission-preview/v1" },
    workspaceId: { type: "string" },
    principalId: { type: "string" },
    workflowId: { type: "string" },
    workflowRevisionId: { type: "string" },
    evaluatedAt: { type: "string", format: "date-time" },
    ceiling: {
      ...object,
      required: ["amount", "currency", "certainty", "fxSnapshotIds"],
      properties: {
        amount: nullableDecimalSchema,
        currency: {
          oneOf: [
            { type: "string", pattern: "^[A-Z]{3}$" },
            { type: "null" },
          ],
        },
        certainty: { type: "string", enum: ["conservative", "unknown"] },
        fxSnapshotIds: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
        },
      },
    },
    applicableCredentialSpendGrants: {
      type: "array",
      items: {
        ...object,
        required: [
          "grantId", "credentialSlotId", "credentialProfileId", "mode",
          "limit", "committed", "available",
        ],
        properties: {
          grantId: { type: "string" },
          credentialSlotId: { type: "string" },
          credentialProfileId: { type: "string" },
          mode: { type: "string", enum: ["bounded", "audited_unbounded"] },
          limit: nullableDecimalSchema,
          committed: decimalSchema,
          available: nullableDecimalSchema,
        },
      },
    },
    applicablePolicies: {
      type: "array",
      maxItems: 2,
      items: {
        ...object,
        required: ["policy", "revision", "period"],
        properties: {
          policy: previewPolicySchema,
          revision: previewPolicyRevisionSchema,
          period: budgetPeriodSchema,
        },
      },
    },
    requiredReservations: {
      type: "array",
      items: {
        ...object,
        required: [
          "scope", "policyId", "policyRevisionId", "principalId", "period",
          "amount", "currency", "committedBefore", "availableBefore",
          "stepAllocations",
        ],
        properties: {
          scope: { type: "string", enum: ["workspace", "principal"] },
          policyId: { type: "string" },
          policyRevisionId: { type: "string" },
          principalId: nullableStringSchema,
          period: budgetPeriodSchema,
          amount: decimalSchema,
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
          committedBefore: decimalSchema,
          availableBefore: decimalSchema,
          stepAllocations: {
            type: "array",
            items: {
              ...object,
              required: ["stepId", "amountPerAttempt", "automaticAttempts"],
              properties: {
                stepId: { type: "string" },
                amountPerAttempt: decimalSchema,
                automaticAttempts: { type: "integer", minimum: 1, maximum: 100 },
              },
            },
          },
        },
      },
    },
    stepExposures: { type: "array", items: stepExposureSchema },
    warnings: { type: "array", items: { type: "string" } },
    admissible: { type: "boolean" },
    denialReasons: { type: "array", items: { type: "string" } },
  },
};

const artifactReferenceSchema: JsonSchema = {
  ...object,
  required: [
    "artifactId",
    "digest",
    "kind",
    "mediaType",
    "sizeBytes",
  ],
  properties: {
    artifactId: { type: "string" },
    digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    kind: { type: "string", enum: ["text", "image"] },
    mediaType: { type: "string" },
    sizeBytes: { type: "integer", minimum: 0 },
  },
};

const launchSafetySchema: JsonSchema = {
  oneOf: [
    {
      ...object,
      required: ["mode", "guard", "replay"],
      properties: {
        mode: { const: "native_effect_key" },
        guard: { const: "workflow-step-attempt/v1" },
        replay: { const: "provider_deduplicated" },
      },
    },
    {
      ...object,
      required: ["mode", "guard", "replay"],
      properties: {
        mode: { const: "durable_at_most_once" },
        guard: { const: "workflow-step-attempt/v1" },
        replay: { const: "never_launch" },
      },
    },
  ],
};

const providerResolutionSchema: JsonSchema = {
  ...object,
  required: [
    "stepId",
    "adapterModule",
    "adapterContractDigest",
    "provider",
    "providerOperation",
    "model",
    "effectKeySupport",
    "observation",
    "launchSafety",
    "usageCeilings",
  ],
  properties: {
    stepId: { type: "string" },
    adapterModule: { type: "string" },
    adapterContractDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    provider: { type: "string" },
    providerOperation: { type: "string" },
    model: { type: "string" },
    effectKeySupport: { type: "string", enum: ["native", "unsupported"] },
    observation: {
      type: "string",
      enum: ["none", "provider_operation_ref"],
    },
    launchSafety: launchSafetySchema,
    usageCeilings: {
      type: "array",
      items: {
        ...object,
        required: ["dimension", "unit", "maximumQuantity"],
        properties: {
          dimension: { type: "string", pattern: "^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$" },
          unit: { type: "string", enum: ["count", "byte", "millisecond", "megapixel"] },
          maximumQuantity: {
            oneOf: [
              { type: "string", pattern: "^(?:0\\.[0-9]*[1-9]|[1-9][0-9]*(?:\\.[0-9]*[1-9])?)$" },
              { type: "null" },
            ],
          },
        },
      },
    },
  },
};

const startSnapshotRequired = [
  "schema",
  "workflowId",
  "workflowRevisionId",
  "workflowRevision",
  "definitionDigest",
  "operationRegistryDigest",
  "definition",
  "inputs",
  "operationContracts",
  "artifactReferences",
  "credentialReferences",
  "authorization",
];

const startSnapshotProperties: Record<string, JsonSchema> = {
  workflowId: { type: "string" },
  workflowRevisionId: { type: "string" },
  workflowRevision: { type: "integer", minimum: 1 },
  definitionDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
  operationRegistryDigest: {
    type: "string",
    pattern: "^sha256:[a-f0-9]{64}$",
  },
  definition: { type: "object" },
  inputs: { type: "array", items: { type: "object" } },
  operationContracts: { type: "array", items: { type: "object" } },
  artifactReferences: { type: "array", items: { type: "object" } },
  credentialReferences: { type: "array", items: { type: "object" } },
  authorization: { type: "object" },
};

const startSnapshotSchema: JsonSchema = {
  oneOf: [
    {
      ...object,
      required: startSnapshotRequired,
      properties: {
        schema: { const: "workflow-run-start-snapshot/v1" },
        ...startSnapshotProperties,
      },
    },
    {
      ...object,
      required: [...startSnapshotRequired, "providerResolutions"],
      properties: {
        schema: { const: "workflow-run-start-snapshot/v2" },
        ...startSnapshotProperties,
        providerResolutions: {
          type: "array",
          minItems: 1,
          items: providerResolutionSchema,
        },
      },
    },
  ],
};

const runSchema: JsonSchema = {
  ...object,
  required: [
    "id",
    "workspaceId",
    "workflowId",
    "workflowRevisionId",
    "state",
    "startSnapshotDigest",
    "startSnapshot",
    "output",
    "finalSnapshot",
    "finalSnapshotDigest",
    "derivation",
    "resumeAt",
    "failureCode",
    "acceptedAt",
    "startedAt",
    "completedAt",
    "updatedAt",
  ],
  properties: {
    ...(safeRunRefSchema.properties ?? {}),
    workspaceId: { type: "string" },
    startSnapshot: startSnapshotSchema,
    output: { type: ["object", "null"] },
    finalSnapshot: { type: ["object", "null"] },
    finalSnapshotDigest: {
      type: ["string", "null"],
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    derivation: {
      oneOf: [
        { type: "null" },
        {
          ...object,
          required: [
            "kind",
            "sourceRunId",
            "rootRunId",
            "sourceStartSnapshotDigest",
            "retryFromStepId",
            "reusedOutputs",
          ],
          properties: {
            kind: { const: "manual_retry" },
            sourceRunId: { type: "string" },
            rootRunId: { type: "string" },
            sourceStartSnapshotDigest: {
              type: "string",
              pattern: "^sha256:[a-f0-9]{64}$",
            },
            retryFromStepId: { type: "string" },
            reusedOutputs: {
              type: "array",
              items: {
                ...object,
                required: [
                  "stepId",
                  "sourceRunId",
                  "sourceStepAttemptId",
                  "sourceAttempt",
                  "sourceEffectKey",
                  "sourceProviderOperationRef",
                  "outputs",
                ],
                properties: {
                  stepId: { type: "string" },
                  sourceRunId: { type: "string" },
                  sourceStepAttemptId: { type: "string" },
                  sourceAttempt: { type: "integer", minimum: 1 },
                  sourceEffectKey: { type: "string" },
                  sourceProviderOperationRef: { type: "string" },
                  outputs: {
                    type: "object",
                    additionalProperties: artifactReferenceSchema,
                  },
                },
              },
            },
          },
        },
      ],
    },
    resumeAt: { type: ["string", "null"], format: "date-time" },
    failureCode: { type: ["string", "null"] },
    startedAt: { type: ["string", "null"], format: "date-time" },
    completedAt: { type: ["string", "null"], format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const recoverySchema: JsonSchema = {
  ...object,
  required: ["run", "inspect", "events"],
  properties: {
    run: runSchema,
    inspect: continuationSchema(
      "workflow_runs.get@1",
      ["workflowId", "runId"],
    ),
    events: continuationSchema(
      "workflow_run_events.list@1",
      ["workflowId", "runId", "cursor"],
    ),
  },
};

const eventSchema: JsonSchema = {
  ...object,
  required: ["id", "runId", "sequence", "type", "data", "occurredAt"],
  properties: {
    id: { type: "string" },
    runId: { type: "string" },
    sequence: { type: "integer", minimum: 1 },
    type: {
      type: "string",
      enum: [
        "run.accepted",
        "run.derived",
        "step.attempt.started",
        "artifact.generated",
        "step.attempt.completed",
        "step.attempt.failed",
        "step.retry.scheduled",
        "step.attempt.outcome_unknown",
        "step.attempt.reconciled",
        "run.waiting",
        "run.resumed",
        "run.outcome_unknown",
        "step.completed",
        "run.completed",
        "run.failed",
      ],
    },
    data: { type: "object" },
    occurredAt: { type: "string", format: "date-time" },
  },
};

const lineageSourceSchema: JsonSchema = {
  oneOf: [
    {
      ...object,
      required: ["kind", "inputName"],
      properties: {
        kind: { const: "workflow_input" },
        inputName: { type: "string" },
      },
    },
    {
      ...object,
      required: ["kind", "runId", "stepAttemptId", "outputName"],
      properties: {
        kind: { const: "step_output" },
        runId: { type: "string" },
        stepAttemptId: { type: "string" },
        outputName: { type: "string" },
      },
    },
  ],
};

const lineageInputSchema: JsonSchema = {
  ...object,
  required: [
    "port",
    "kind",
    "source",
    "contentDigest",
    "artifactId",
  ],
  properties: {
    port: { type: "string" },
    kind: { type: "string", enum: ["text", "image"] },
    source: lineageSourceSchema,
    contentDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    artifactId: { type: ["string", "null"] },
  },
};

const providerEvidenceSchema: JsonSchema = {
  ...object,
  required: [
    "providerRequestId",
    "httpStatus",
    "providerCode",
    "operatorTraceRef",
    "effectDisposition",
  ],
  properties: {
    providerRequestId: { type: ["string", "null"] },
    httpStatus: { type: ["integer", "null"], minimum: 100, maximum: 599 },
    providerCode: { type: ["string", "null"] },
    operatorTraceRef: { type: ["string", "null"] },
    effectDisposition: {
      type: "string",
      enum: ["not_created", "accepted", "terminal_failed", "unknown"],
    },
  },
};

const providerUsageCommon = {
  dimension: {
    type: "string",
    pattern: "^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$",
  },
  unit: {
    type: "string",
    enum: ["count", "byte", "millisecond", "megapixel"],
  },
} satisfies Record<string, JsonSchema>;

const providerMetadataSchema: JsonSchema = {
  ...object,
  required: ["evidence", "usage", "retryAfterMs", "pollAfterMs"],
  properties: {
    evidence: providerEvidenceSchema,
    usage: {
      type: "array",
      items: {
        oneOf: [
          {
            ...object,
            required: ["dimension", "unit", "source", "quantity"],
            properties: {
              ...providerUsageCommon,
              source: {
                type: "string",
                enum: ["reported", "measured", "estimated"],
              },
              quantity: {
                type: "string",
                pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
              },
            },
          },
          {
            ...object,
            required: ["dimension", "unit", "source", "quantity"],
            properties: {
              ...providerUsageCommon,
              source: { const: "unknown" },
              quantity: { type: "null" },
            },
          },
        ],
      },
    },
    reportedCost: {
      oneOf: [
        { type: "null" },
        {
          ...object,
          required: ["amount", "currency", "evidenceRef"],
          properties: {
            amount: { type: "string", pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$" },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            evidenceRef: { type: "string", pattern: "^evidence:sha256:[a-f0-9]{64}$" },
          },
        },
      ],
    },
    retryAfterMs: { type: ["integer", "null"], minimum: 0 },
    pollAfterMs: { type: ["integer", "null"], minimum: 0 },
  },
};

const stepAttemptSchema: JsonSchema = {
  ...object,
  required: [
    "id",
    "workspaceId",
    "runId",
    "stepId",
    "attempt",
    "state",
    "operationIdentity",
    "operationContractDigest",
    "provider",
    "providerOperation",
    "model",
    "intentDigest",
    "effectKey",
    "inputs",
    "outputs",
    "providerOperationRef",
    "outcome",
    "reconciliation",
    "failureCode",
    "startedAt",
    "completedAt",
  ],
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    runId: { type: "string" },
    stepId: { type: "string" },
    attempt: { type: "integer", minimum: 1 },
    state: {
      type: "string",
      enum: ["running", "outcome_unknown", "completed", "failed"],
    },
    operationIdentity: { type: "string" },
    operationContractDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    provider: { type: "string" },
    providerOperation: { type: "string" },
    model: { type: "string" },
    providerAdapterModule: { type: "string" },
    providerAdapterContractDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    launchSafety: launchSafetySchema,
    intentDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    effectKey: { type: "string" },
    inputs: {
      type: "array",
      items: lineageInputSchema,
    },
    outputs: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: artifactReferenceSchema,
        },
      ],
    },
    providerOperationRef: { type: ["string", "null"] },
    providerMetadata: {
      oneOf: [{ type: "null" }, providerMetadataSchema],
    },
    outcome: {
      oneOf: [
        { type: "null" },
        {
          ...object,
          required: ["kind", "providerOperationRef"],
          properties: {
            kind: { const: "succeeded" },
            providerOperationRef: { type: "string" },
          },
        },
        {
          ...object,
          required: ["kind", "failureCode", "retryable"],
          properties: {
            kind: { const: "failed_known" },
            failureCode: { type: "string" },
            retryable: { type: "boolean" },
          },
        },
        {
          ...object,
          required: [
            "kind",
            "failureCode",
            "priorSucceededProviderOperationRef",
          ],
          properties: {
            kind: { const: "outcome_unknown" },
            failureCode: { type: "string" },
            priorSucceededProviderOperationRef: {
              type: ["string", "null"],
            },
          },
        },
      ],
    },
    reconciliation: {
      oneOf: [
        { type: "null" },
        {
          ...object,
          required: ["reference", "resolution", "reconciledAt"],
          properties: {
            reference: { type: "string" },
            resolution: {
              type: "string",
              enum: ["succeeded", "failed_known"],
            },
            reconciledAt: { type: "string", format: "date-time" },
          },
        },
      ],
    },
    failureCode: { type: ["string", "null"] },
    startedAt: { type: "string", format: "date-time" },
    completedAt: { type: ["string", "null"], format: "date-time" },
  },
};

const generatedArtifactSchema: JsonSchema = {
  ...object,
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
    digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    sizeBytes: { type: "integer", minimum: 0 },
    mediaType: { type: "string" },
    width: { type: ["integer", "null"] },
    height: { type: ["integer", "null"] },
    creatorPrincipalId: { type: "string" },
    origin: {
      ...object,
      required: [
        "kind",
        "generatedAt",
        "workflowRevision",
        "run",
        "stepAttempt",
        "providerOperation",
        "effectKey",
        "outputName",
      ],
      properties: {
        kind: { const: "generated" },
        generatedAt: { type: "string", format: "date-time" },
        workflowRevision: {
          ...object,
          required: [
            "workflowId",
            "revisionId",
            "revision",
            "definitionDigest",
          ],
          properties: {
            workflowId: { type: "string" },
            revisionId: { type: "string" },
            revision: { type: "integer", minimum: 1 },
            definitionDigest: {
              type: "string",
              pattern: "^sha256:[a-f0-9]{64}$",
            },
          },
        },
        run: {
          ...object,
          required: ["runId", "startSnapshotDigest"],
          properties: {
            runId: { type: "string" },
            startSnapshotDigest: {
              type: "string",
              pattern: "^sha256:[a-f0-9]{64}$",
            },
          },
        },
        stepAttempt: {
          ...object,
          required: ["stepAttemptId", "stepId", "attempt"],
          properties: {
            stepAttemptId: { type: "string" },
            stepId: { type: "string" },
            attempt: { type: "integer", minimum: 1 },
          },
        },
        providerOperation: {
          ...object,
          required: [
            "provider",
            "operationIdentity",
            "operation",
            "ref",
            "model",
            "intentDigest",
            "metadata",
          ],
          properties: {
            provider: { type: "string" },
            operationIdentity: { type: "string" },
            operation: { type: "string" },
            ref: { type: "string" },
            model: { type: "string" },
            intentDigest: {
              type: "string",
              pattern: "^sha256:[a-f0-9]{64}$",
            },
            metadata: {
              oneOf: [{ type: "null" }, providerMetadataSchema],
            },
          },
        },
        effectKey: { type: "string" },
        outputName: { type: "string" },
      },
    },
    retention: {
      ...object,
      required: ["mode", "snapshotAt"],
      properties: {
        mode: { const: "workspace_default" },
        snapshotAt: { type: "string", format: "date-time" },
      },
    },
    lineage: {
      ...object,
      required: ["inputs", "sourceArtifactIds"],
      properties: {
        inputs: {
          type: "array",
          items: lineageInputSchema,
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
      message: "Workflow Run capability is not authorized.",
    });
  }
  return context;
}

function authorizationEvidence(context: {
  authorizationAdmission?: { operatorTraceRef?: string };
}): string {
  const value = context.authorizationAdmission?.operatorTraceRef?.trim();
  if (!value) {
    throw new CapabilityFailure({
      code: "AUTHORIZATION_ADMISSION_UNAVAILABLE",
      category: "internal",
      message: "Authorization evidence is unavailable.",
      retryable: true,
    });
  }
  return value;
}

async function domain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof WorkflowRunError)) throw error;
    throw new CapabilityFailure({
      code: error.code,
      category: WORKFLOW_RUN_ERROR_CATALOG[error.code].category,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
    });
  }
}

function admissionPreviewDto(preview: RunAdmissionPreview) {
  return {
    ...preview,
    evaluatedAt: preview.evaluatedAt.toISOString(),
    applicablePolicies: preview.applicablePolicies.map(
      ({ policy, revision, period }) => {
        const { createdByUserId: _createdByUserId, ...safeRevision } = revision;
        return {
          policy: {
            ...policy,
            createdAt: policy.createdAt.toISOString(),
            updatedAt: policy.updatedAt.toISOString(),
          },
          revision: {
            ...safeRevision,
            createdAt: revision.createdAt.toISOString(),
          },
          period: {
            ...period,
            startsAt: period.startsAt.toISOString(),
            endsAt: period.endsAt?.toISOString() ?? null,
          },
        };
      },
    ),
    requiredReservations: preview.requiredReservations.map((reservation) => ({
      ...reservation,
      period: {
        ...reservation.period,
        startsAt: reservation.period.startsAt.toISOString(),
        endsAt: reservation.period.endsAt?.toISOString() ?? null,
      },
    })),
  };
}

export function createWorkflowRunRegistrations(
  service: WorkflowRunService,
): CapabilityRegistration[] {
  return [
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.preview,
      summary:
        "Validate a proposed Workflow Run and report current Budget admission without creating a Run or reservation.",
      lifecycle,
      input: z
        .object({
          workflowId: id,
          revisionId: id,
          inputs: z.record(z.string(), z.unknown()),
          inputArtifactIds: previewInputArtifactIds,
        })
        .strict(),
      outputSchema: admissionPreviewSchema,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: {
        resources: [
          { kind: "workflow", inputPath: "workflowId" },
          { kind: "artifact", inputPath: "inputArtifactIds" },
        ],
      },
      errors: [
        ...COMMON_DISCOVERY_ERRORS,
        ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS,
      ],
      handler: async (input, context) => {
        const principal = agent(context.securityContext);
        const preview = await domain(() =>
          service.preview({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            ...input,
          }),
        );
        return admissionPreviewDto(preview);
      },
    }),
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.start,
      summary:
        "Durably accept one deterministic Workflow Run and return immutable continuation references.",
      lifecycle: legacyLifecycle,
      input: z
        .object({
          workflowId: id,
          revisionId: id,
          idempotencyKey,
          inputs: z.record(z.string(), z.unknown()),
        })
        .strict(),
      outputSchema: acceptedSchema,
      effect: {
        mutation: "runtime-state",
        visibility: "private",
        timing: "durable-async",
        reversibility: "conditional",
        maySpendProviderBudget: true,
      },
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: {
        resources: [{ kind: "workflow", inputPath: "workflowId" }],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.start({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            keyId: principal.keyId,
            authorizationEvidenceRef: authorizationEvidence(context),
            ...input,
          }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.startV2,
      summary:
        "Durably accept one Artifact-bound Workflow Run after exact Workflow and input Artifact authorization.",
      lifecycle,
      input: z
        .object({
          workflowId: id,
          revisionId: id,
          idempotencyKey,
          inputs: z.record(z.string(), z.unknown()),
          inputArtifactIds,
        })
        .strict(),
      outputSchema: acceptedSchema,
      effect: {
        mutation: "runtime-state",
        visibility: "private",
        timing: "durable-async",
        reversibility: "conditional",
        maySpendProviderBudget: true,
      },
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: {
        resources: [
          { kind: "workflow", inputPath: "workflowId" },
          { kind: "artifact", inputPath: "inputArtifactIds" },
        ],
      },
      errors: [
        ...COMMON_DISCOVERY_ERRORS,
        ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS,
      ],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.start({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            keyId: principal.keyId,
            authorizationEvidenceRef: authorizationEvidence(context),
            capability: "workflow_runs.start@2",
            ...input,
          }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.get,
      summary: "Inspect the canonical current state of one Workflow Run.",
      lifecycle,
      input: resourceInput,
      outputSchema: runSchema,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: {
        resources: [{ kind: "workflow", inputPath: "workflowId" }],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.get({ workspaceId: principal.workspaceId, ...input }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.retry,
      summary:
        "Create a derived Workflow Run retry while preserving the failed source Run.",
      lifecycle,
      input: z
        .object({
          workflowId: id,
          runId: id,
          idempotencyKey,
          inputArtifactIds: z.array(id).max(100),
        })
        .strict(),
      outputSchema: recoverySchema,
      effect: {
        mutation: "runtime-state",
        visibility: "private",
        timing: "durable-async",
        reversibility: "conditional",
        maySpendProviderBudget: true,
      },
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: {
        resources: [
          { kind: "workflow", inputPath: "workflowId" },
          { kind: "artifact", inputPath: "inputArtifactIds" },
        ],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.retry({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            keyId: principal.keyId,
            authorizationEvidenceRef: authorizationEvidence(context),
            ...input,
          }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.resume,
      summary:
        "Resume a known-safe waiting Workflow Run after its retry backoff.",
      lifecycle,
      input: resourceInput
        .extend({
          idempotencyKey,
          waitEventSequence: z.number().int().positive(),
        })
        .strict(),
      outputSchema: recoverySchema,
      effect: {
        mutation: "runtime-state",
        visibility: "private",
        timing: "durable-async",
        reversibility: "conditional",
        maySpendProviderBudget: false,
      },
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: {
        resources: [{ kind: "workflow", inputPath: "workflowId" }],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.resume({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            keyId: principal.keyId,
            authorizationEvidenceRef: authorizationEvidence(context),
            ...input,
          }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.reconcile,
      summary:
        "Resolve one unknown provider outcome through the snapshotted provider adapter.",
      lifecycle,
      input: resourceInput
        .extend({ idempotencyKey, stepAttemptId: id })
        .strict(),
      outputSchema: recoverySchema,
      effect: {
        mutation: "runtime-state",
        visibility: "private",
        timing: "durable-async",
        reversibility: "conditional",
        maySpendProviderBudget: false,
      },
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: {
        resources: [{ kind: "workflow", inputPath: "workflowId" }],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.reconcile({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            keyId: principal.keyId,
            authorizationEvidenceRef: authorizationEvidence(context),
            ...input,
          }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.events,
      summary:
        "Read retained gap-free Workflow Run events from an authenticated cursor.",
      lifecycle,
      input: resourceInput.extend({ cursor }).strict(),
      outputSchema: {
        ...object,
        required: ["items", "nextCursor"],
        properties: {
          items: { type: "array", items: eventSchema },
          nextCursor: { type: "string" },
        },
      },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: {
        resources: [{ kind: "workflow", inputPath: "workflowId" }],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.listEvents({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            ...input,
          }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.stepAttempts,
      summary:
        "List inspectable Step Attempts for one authorized Workflow Run.",
      lifecycle,
      input: resourceInput,
      outputSchema: {
        ...object,
        required: ["items"],
        properties: {
          items: { type: "array", items: stepAttemptSchema },
        },
      },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: {
        resources: [{ kind: "workflow", inputPath: "workflowId" }],
      },
      errors: [
        ...COMMON_DISCOVERY_ERRORS,
        ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS,
      ],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.listStepAttempts({
            workspaceId: principal.workspaceId,
            ...input,
          }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_RUN_CAPABILITY_IDENTITIES.runArtifact,
      summary:
        "Inspect one generated Artifact proven to belong to an authorized Workflow Run.",
      lifecycle,
      input: resourceInput.extend({ artifactId: id }).strict(),
      outputSchema: {
        ...object,
        required: ["artifact", "textContent"],
        properties: {
          artifact: generatedArtifactSchema,
          textContent: { type: ["string", "null"] },
        },
      },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: {
        // Generated output identities do not exist when the Run grant is
        // issued. The handler proves exact Run membership before returning
        // the Artifact, so Workflow authority is the public selector here.
        resources: [{ kind: "workflow", inputPath: "workflowId" }],
      },
      errors: [
        ...COMMON_DISCOVERY_ERRORS,
        ...WORKFLOW_RUN_PUBLIC_ERROR_CONTRACTS,
      ],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.getRunArtifact({
            workspaceId: principal.workspaceId,
            ...input,
          }),
        );
      },
    }),
  ];
}
