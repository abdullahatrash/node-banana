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
  get: { name: "workflow_runs.get", version: 1 },
  events: { name: "workflow_run_events.list", version: 1 },
} as const;

const lifecycle = {
  status: "active",
  introducedAt: "2026-07-25T00:00:00.000Z",
  recommended: true,
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
        "step.completed",
        "run.completed",
        "run.failed",
      ],
    },
    data: { type: "object" },
    occurredAt: { type: "string", format: "date-time" },
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
      lifecycle,
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
  ];
}
