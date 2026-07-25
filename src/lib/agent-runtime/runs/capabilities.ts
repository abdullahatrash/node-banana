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

export const WORKFLOW_RUN_CAPABILITY_IDENTITIES = {
  start: { name: "workflow_runs.start", version: 1 },
  startV2: { name: "workflow_runs.start", version: 2 },
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
      enum: ["accepted", "running", "completed", "failed"],
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
    "failureCode",
    "acceptedAt",
    "startedAt",
    "completedAt",
    "updatedAt",
  ],
  properties: {
    ...(safeRunRefSchema.properties ?? {}),
    workspaceId: { type: "string" },
    startSnapshot: {
      ...object,
      required: [
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
      ],
      properties: {
        schema: { const: "workflow-run-start-snapshot/v1" },
        workflowId: { type: "string" },
        workflowRevisionId: { type: "string" },
        workflowRevision: { type: "integer", minimum: 1 },
        definitionDigest: { type: "string" },
        operationRegistryDigest: { type: "string" },
        definition: { type: "object" },
        inputs: { type: "array", items: { type: "object" } },
        operationContracts: { type: "array", items: { type: "object" } },
        artifactReferences: { type: "array", items: { type: "object" } },
        credentialReferences: { type: "array", items: { type: "object" } },
        authorization: { type: "object" },
      },
    },
    output: { type: ["object", "null"] },
    finalSnapshot: { type: ["object", "null"] },
    finalSnapshotDigest: {
      type: ["string", "null"],
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    failureCode: { type: ["string", "null"] },
    startedAt: { type: ["string", "null"], format: "date-time" },
    completedAt: { type: ["string", "null"], format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
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
        "step.attempt.started",
        "artifact.generated",
        "step.attempt.completed",
        "step.attempt.failed",
        "step.completed",
        "run.completed",
        "run.failed",
      ],
    },
    data: { type: "object" },
    occurredAt: { type: "string", format: "date-time" },
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
      required: ["kind", "stepAttemptId", "outputName"],
      properties: {
        kind: { const: "step_output" },
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
      enum: ["running", "completed", "failed"],
    },
    operationIdentity: { type: "string" },
    operationContractDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    provider: { type: "string" },
    providerOperation: { type: "string" },
    model: { type: "string" },
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
    });
  }
}

export function createWorkflowRunRegistrations(
  service: WorkflowRunService,
): CapabilityRegistration[] {
  return [
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
        maySpendProviderBudget: false,
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
