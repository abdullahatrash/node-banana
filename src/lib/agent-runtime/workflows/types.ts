import type { AgentResourceConstraints } from "@/types/agentAuthorization";

export const WORKFLOW_CONTENT_KINDS = ["text", "image"] as const;
export type WorkflowContentKind = (typeof WORKFLOW_CONTENT_KINDS)[number];

export type WorkflowOperationLifecycle = "active" | "deprecated" | "retired";

export interface WorkflowOperationPort {
  kind: WorkflowContentKind;
  required: boolean;
}

export interface WorkflowOperationCredentialRequirement {
  provider: string;
  required: boolean;
}

export interface WorkflowRetryBounds {
  maxAttempts: number;
  maxInitialMs: number;
  maxBackoffMs: number;
  maxMultiplier: number;
  maxTotalDelayMs: number;
}

export interface WorkflowOperationDefinition {
  identity: string;
  lifecycle: WorkflowOperationLifecycle;
  contractDigest: string;
  inputs: Record<string, WorkflowOperationPort>;
  outputs: Record<string, WorkflowContentKind>;
  configSchema: Record<string, unknown>;
  credentialRequirements: Record<
    string,
    WorkflowOperationCredentialRequirement
  >;
  retryBounds: WorkflowRetryBounds;
}

export interface WorkflowOperationRegistryReader {
  readonly digest: string;
  get(identity: string): WorkflowOperationDefinition | undefined;
  list(): WorkflowOperationDefinition[];
  validateConfig(
    identity: string,
    value: unknown,
  ):
    | { success: true; data: Record<string, unknown> }
    | {
        success: false;
        issues: Array<{ path: Array<PropertyKey>; message: string }>;
      };
}

export interface WorkflowInputBinding {
  from: "workflow_input";
  input: string;
}

export interface WorkflowStepBinding {
  from: "step_output";
  step: string;
  output: string;
}

export type WorkflowBinding = WorkflowInputBinding | WorkflowStepBinding;

export interface WorkflowRetryPolicy {
  maxAttempts: number;
  backoff: {
    initialMs: number;
    maxMs: number;
    multiplier: number;
  };
}

export interface WorkflowDraft {
  schema: "content-workflow-draft/v1";
  workflowId: string;
  name: string;
  description?: string;
  inputs: Record<
    string,
    {
      kind: WorkflowContentKind;
      required: boolean;
      description?: string;
    }
  >;
  credentialSlots: Record<
    string,
    {
      slotId: string;
      provider: string;
    }
  >;
  steps: Array<{
    id: string;
    operation: string;
    inputs: Record<string, WorkflowBinding>;
    credentials: Record<string, string>;
    config: Record<string, unknown>;
    retry: WorkflowRetryPolicy;
  }>;
  outputs: Record<string, WorkflowStepBinding>;
}

export interface ResolvedWorkflowStep
  extends Omit<WorkflowDraft["steps"][number], "operation"> {
  operation: {
    identity: string;
    contractDigest: string;
  };
}

export interface ResolvedWorkflowDefinition
  extends Omit<WorkflowDraft, "schema" | "steps" | "outputs"> {
  schema: "content-workflow-revision-definition/v1";
  steps: ResolvedWorkflowStep[];
  outputs: Record<
    string,
    {
      kind: WorkflowContentKind;
      binding: WorkflowStepBinding;
    }
  >;
}

export type WorkflowValidationIssueCode =
  | "WORKFLOW_FIELD_INVALID"
  | "WORKFLOW_DUPLICATE_STEP"
  | "WORKFLOW_GRAPH_CYCLE"
  | "WORKFLOW_SOURCE_NOT_FOUND"
  | "WORKFLOW_PORT_NOT_FOUND"
  | "WORKFLOW_HANDLE_TYPE_MISMATCH"
  | "WORKFLOW_REQUIRED_INPUT_MISSING"
  | "WORKFLOW_CAPABILITY_IDENTITY_INVALID"
  | "WORKFLOW_CAPABILITY_NOT_FOUND"
  | "WORKFLOW_CAPABILITY_RETIRED"
  | "WORKFLOW_CREDENTIAL_SLOT_MISSING"
  | "WORKFLOW_CREDENTIAL_SLOT_UNAVAILABLE"
  | "WORKFLOW_CREDENTIAL_PROVIDER_MISMATCH"
  | "WORKFLOW_RETRY_POLICY_INVALID"
  | "WORKFLOW_SECRET_FIELD_FORBIDDEN";

export interface WorkflowValidationIssue {
  code: WorkflowValidationIssueCode;
  path: string;
  message: string;
}

export interface WorkflowValidationWarning {
  code: "WORKFLOW_CAPABILITY_DEPRECATED";
  path: string;
  message: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: WorkflowValidationIssue[];
  warnings: WorkflowValidationWarning[];
  digest: string | null;
  operationRegistryDigest: string;
  resolvedCapabilities: Array<{
    stepId: string;
    identity: string;
    contractDigest: string;
  }>;
  normalizedDefinition: ResolvedWorkflowDefinition | null;
}

export interface WorkflowCredentialSlotAdmissionPort {
  isAccessible(input: {
    workspaceId: string;
    principalId: string;
    slotId: string;
    provider: string;
    effectiveResources: AgentResourceConstraints;
  }): Promise<boolean>;
}

export interface ContentWorkflowRecord {
  id: string;
  workspaceId: string;
  currentRevision: number;
  createdByPrincipalId: string;
  createdByKeyId: string;
  authorizationEvidenceRef: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentWorkflowDto {
  id: string;
  workspaceId: string;
  currentRevision: number;
  createdByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentWorkflowRevisionRecord {
  id: string;
  workspaceId: string;
  workflowId: string;
  revision: number;
  definitionDigest: string;
  definition: ResolvedWorkflowDefinition;
  operationRegistryDigest: string;
  authorPrincipalId: string;
  authorKeyId: string;
  authorizationEvidenceRef: string;
  createdAt: Date;
}

export interface WorkflowRevisionDto {
  id: string;
  workspaceId: string;
  workflowId: string;
  revision: number;
  definitionDigest: string;
  definition: ResolvedWorkflowDefinition;
  operationRegistryDigest: string;
  author: {
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
  };
  createdAt: string;
}

export interface WorkflowRevisionMutationReceiptRecord {
  workspaceId: string;
  principalId: string;
  capability: WorkflowMutationCapability;
  idempotencyKey: string;
  requestFingerprint: string;
  resourceId: string;
  createdAt: Date;
}

export type WorkflowMutationCapability =
  | "workflows.create@1"
  | "workflow_versions.create@1";

export type WorkflowRevisionReceiptResult =
  | { kind: "absent" }
  | { kind: "conflict" }
  | { kind: "replayed"; resourceId: string };

export type WorkflowRevisionPublishResult =
  | { kind: "created"; revision: ContentWorkflowRevisionRecord }
  | { kind: "replayed"; revision: ContentWorkflowRevisionRecord }
  | { kind: "conflict" }
  | { kind: "unavailable" }
  | { kind: "persistence_unavailable" };

export interface WorkflowRevisionRepository {
  readReceipt(input: {
    workspaceId: string;
    principalId: string;
    capability: WorkflowMutationCapability;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<WorkflowRevisionReceiptResult>;
  createWorkflow(input: {
    workflow: ContentWorkflowRecord;
    receipt: WorkflowRevisionMutationReceiptRecord;
  }): Promise<
    | { kind: "created"; workflow: ContentWorkflowRecord }
    | { kind: "replayed"; workflow: ContentWorkflowRecord }
    | { kind: "conflict" }
    | { kind: "unavailable" }
  >;
  publish(input: {
    revision: Omit<ContentWorkflowRevisionRecord, "revision">;
    receipt: Omit<WorkflowRevisionMutationReceiptRecord, "resourceId">;
  }): Promise<WorkflowRevisionPublishResult>;
  getRevision(input: {
    workspaceId: string;
    workflowId: string;
    revisionId: string;
  }): Promise<ContentWorkflowRevisionRecord | null>;
}

export interface WorkflowClock {
  now(): Date;
}
