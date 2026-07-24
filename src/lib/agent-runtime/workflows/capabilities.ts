import { z } from "zod";
import {
  COMMON_DISCOVERY_ERRORS,
  QUERY_EFFECT,
  defineCapability,
} from "@/lib/agent-tools/registry";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import { emptyResourceConstraints } from "@/lib/agent-authorization/resource-constraints";
import type {
  CapabilityRegistration,
  JsonSchema,
  ResolvedSecurityContext,
} from "@/types/capabilities";
import {
  WORKFLOW_ERROR_CATALOG,
  WORKFLOW_ERROR_CONTRACTS,
  WorkflowServiceError,
} from "./errors";
import type {
  WorkflowOperationDefinition,
  WorkflowOperationRegistryReader,
} from "./types";
import { WorkflowRevisionService } from "./service";
import { workflowDraftSchema } from "./validation";

export const WORKFLOW_CAPABILITY_IDENTITIES = {
  workflowCreate: { name: "workflows.create", version: 1 },
  operationList: { name: "workflow_operations.list", version: 1 },
  operationGet: { name: "workflow_operations.get", version: 1 },
  validate: { name: "workflow_versions.validate", version: 1 },
  create: { name: "workflow_versions.create", version: 1 },
  get: { name: "workflow_versions.get", version: 1 },
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

const id = z.string().trim().min(1).max(200);
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);

const validateRuntimeInput = z.object({ draft: z.unknown() }).strict();
const createRuntimeInput = z
  .object({ idempotencyKey, draft: z.unknown() })
  .strict();
const validateDiscoveryInputSchema = z.toJSONSchema(
  z.object({ draft: workflowDraftSchema }).strict(),
  { target: "draft-7" },
);
const createDiscoveryInputSchema = z.toJSONSchema(
  z.object({ idempotencyKey, draft: workflowDraftSchema }).strict(),
  { target: "draft-7" },
);

const objectSchema = {
  type: "object",
  additionalProperties: false,
} as const;

const operationMetadataSchema: JsonSchema = {
  ...objectSchema,
  required: [
    "identity",
    "lifecycle",
    "contractDigest",
    "inputs",
    "outputs",
    "configSchema",
    "credentialRequirements",
    "retryBounds",
  ],
  properties: {
    identity: { type: "string" },
    lifecycle: {
      type: "string",
      enum: ["active", "deprecated", "retired"],
    },
    contractDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    inputs: { type: "object" },
    outputs: { type: "object" },
    configSchema: { type: "object" },
    credentialRequirements: { type: "object" },
    retryBounds: { type: "object" },
  },
};

const workflowSchema: JsonSchema = {
  ...objectSchema,
  required: [
    "id",
    "workspaceId",
    "currentRevision",
    "createdByPrincipalId",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    currentRevision: { type: "integer", minimum: 0 },
    createdByPrincipalId: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const issueSchema: JsonSchema = {
  ...objectSchema,
  required: ["code", "path", "message"],
  properties: {
    code: { type: "string" },
    path: { type: "string" },
    message: { type: "string" },
  },
};

const validationSchema: JsonSchema = {
  ...objectSchema,
  required: [
    "valid",
    "errors",
    "warnings",
    "digest",
    "operationRegistryDigest",
    "resolvedCapabilities",
    "normalizedDefinition",
  ],
  properties: {
    valid: { type: "boolean" },
    errors: { type: "array", items: issueSchema },
    warnings: { type: "array", items: issueSchema },
    digest: {
      type: ["string", "null"],
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    operationRegistryDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    resolvedCapabilities: { type: "array", items: { type: "object" } },
    normalizedDefinition: { type: ["object", "null"] },
  },
};

const revisionSchema: JsonSchema = {
  ...objectSchema,
  required: [
    "id",
    "workspaceId",
    "workflowId",
    "revision",
    "definitionDigest",
    "definition",
    "operationRegistryDigest",
    "author",
    "createdAt",
  ],
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    workflowId: { type: "string" },
    revision: { type: "integer", minimum: 1 },
    definitionDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    definition: { type: "object" },
    operationRegistryDigest: {
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    },
    author: {
      ...objectSchema,
      required: ["principalId", "keyId", "authorizationEvidenceRef"],
      properties: {
        principalId: { type: "string" },
        keyId: { type: "string" },
        authorizationEvidenceRef: { type: "string" },
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
      message: "Workflow capability is not authorized.",
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
    if (!(error instanceof WorkflowServiceError)) throw error;
    throw new CapabilityFailure({
      code: error.code,
      category: WORKFLOW_ERROR_CATALOG[error.code].category,
      message: error.message,
      retryable: error.retryable,
      details: error.issues ? { issues: error.issues } : undefined,
    });
  }
}

function operationMetadata(definition: WorkflowOperationDefinition) {
  return {
    identity: definition.identity,
    lifecycle: definition.lifecycle,
    contractDigest: definition.contractDigest,
    inputs: definition.inputs,
    outputs: definition.outputs,
    configSchema: definition.configSchema,
    credentialRequirements: definition.credentialRequirements,
    retryBounds: definition.retryBounds,
  };
}

export function createWorkflowRegistrations(
  service: WorkflowRevisionService,
  operations: WorkflowOperationRegistryReader,
): CapabilityRegistration[] {
  return [
    defineCapability({
      identity: WORKFLOW_CAPABILITY_IDENTITIES.workflowCreate,
      summary:
        "Create a stable Workspace-scoped Content Workflow identity.",
      lifecycle,
      input: z.object({ idempotencyKey }).strict(),
      outputSchema: workflowSchema,
      effect: mutationEffect,
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      // Identity creation is an explicit collection-level capability. The
      // server generates the ID, so no nonexistent resource is authorized.
      authorization: { resources: [] },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_ERROR_CONTRACTS],
      handler: ({ idempotencyKey: key }, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.createWorkflow({
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            keyId: principal.keyId,
            authorizationEvidenceRef: authorizationEvidence(context),
            idempotencyKey: key,
          }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_CAPABILITY_IDENTITIES.operationList,
      summary:
        "Discover immutable internal Workflow Operation contracts without executing them.",
      lifecycle,
      input: z.object({}).strict(),
      outputSchema: {
        ...objectSchema,
        required: ["items", "registryDigest"],
        properties: {
          items: { type: "array", items: operationMetadataSchema },
          registryDigest: {
            type: "string",
            pattern: "^sha256:[a-f0-9]{64}$",
          },
        },
      },
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: COMMON_DISCOVERY_ERRORS,
      handler: (_input, context) => {
        agent(context.securityContext);
        return {
          items: operations.list().map(operationMetadata),
          registryDigest: operations.digest,
        };
      },
    }),
    defineCapability({
      identity: WORKFLOW_CAPABILITY_IDENTITIES.operationGet,
      summary: "Inspect one exact internal Workflow Operation contract.",
      lifecycle,
      input: z.object({ identity: z.string().min(1).max(200) }).strict(),
      outputSchema: operationMetadataSchema,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: [
        ...COMMON_DISCOVERY_ERRORS,
        {
          code: "WORKFLOW_CAPABILITY_NOT_FOUND",
          category: "not_found",
          retryable: false,
          description: "The exact Workflow Operation is not published.",
        },
      ],
      handler: ({ identity }, context) => {
        agent(context.securityContext);
        const found = operations.get(identity);
        if (!found) {
          throw new CapabilityFailure({
            code: "WORKFLOW_CAPABILITY_NOT_FOUND",
            category: "not_found",
            message: `Workflow Operation ${identity} is not published.`,
          });
        }
        return operationMetadata(found);
      },
    }),
    defineCapability({
      identity: WORKFLOW_CAPABILITY_IDENTITIES.validate,
      summary:
        "Validate and normalize a browser-independent Content Workflow draft.",
      lifecycle,
      input: validateRuntimeInput,
      inputSchema: validateDiscoveryInputSchema,
      outputSchema: validationSchema,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_ERROR_CONTRACTS],
      handler: ({ draft }, context) => {
        const principal = agent(context.securityContext);
        return service.validate({
          candidate: draft,
          workspaceId: principal.workspaceId,
          principalId: principal.principalId,
          effectiveResources:
            context.authorizationAdmission?.effectiveResources ??
            emptyResourceConstraints(),
        });
      },
    }),
    defineCapability({
      identity: WORKFLOW_CAPABILITY_IDENTITIES.create,
      summary:
        "Publish a validated immutable Content Workflow Revision under an existing Workflow.",
      lifecycle,
      input: createRuntimeInput,
      inputSchema: createDiscoveryInputSchema,
      outputSchema: revisionSchema,
      effect: mutationEffect,
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: {
        resources: [{ kind: "workflow", inputPath: "draft.workflowId" }],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_ERROR_CONTRACTS],
      handler: ({ idempotencyKey: key, draft }, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.publish({
            candidate: draft,
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            keyId: principal.keyId,
            authorizationEvidenceRef: authorizationEvidence(context),
            effectiveResources:
              context.authorizationAdmission?.effectiveResources ??
              emptyResourceConstraints(),
            idempotencyKey: key,
          }),
        );
      },
    }),
    defineCapability({
      identity: WORKFLOW_CAPABILITY_IDENTITIES.get,
      summary: "Inspect one immutable Content Workflow Revision.",
      lifecycle,
      input: z.object({ workflowId: id, revisionId: id }).strict(),
      outputSchema: revisionSchema,
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: {
        resources: [{ kind: "workflow", inputPath: "workflowId" }],
      },
      errors: [...COMMON_DISCOVERY_ERRORS, ...WORKFLOW_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.getRevision({
            workspaceId: principal.workspaceId,
            ...input,
          }),
        );
      },
    }),
  ];
}
