import type { z } from "zod";
import type { AgentSecurityContext } from "./agentAuth";
import type {
  CapabilityAuthorizationAdmission,
  AgentResourceRef,
  CapabilityAuthorizer,
} from "./agentAuthorization";

export type JsonSchema = Record<string, unknown>;

export interface CapabilityIdentity {
  name: string;
  version: number;
}

export type CapabilityLifecycleStatus =
  | "experimental"
  | "active"
  | "deprecated"
  | "retired";

export interface CapabilityLifecycle {
  status: CapabilityLifecycleStatus;
  introducedAt: string;
  recommended: boolean;
  deprecatedAt?: string;
  retiredAt?: string;
  sunsetAt?: string;
  replacement?: CapabilityIdentity;
}

export interface CapabilityEffect {
  mutation: "none" | "runtime-state" | "external-system";
  visibility: "private" | "publicly-visible";
  timing: "immediate" | "durable-async" | "future-trigger";
  reversibility: "reversible" | "conditional" | "irreversible";
  maySpendProviderBudget: boolean;
}

export interface CapabilityApprovalContract {
  mode: "none" | "manages-approval" | "required-before-effect";
}

export interface CapabilityIdempotencyPolicy {
  mode: "retry-safe" | "intrinsic" | "key-required";
}

export type CapabilityErrorCategory =
  | "validation"
  | "not_found"
  | "lifecycle"
  | "authorization"
  | "approval"
  | "conflict"
  | "internal";

export interface CapabilityErrorContract {
  code: string;
  category: CapabilityErrorCategory;
  retryable: boolean;
  description: string;
}

export interface CapabilityDefinition {
  identity: CapabilityIdentity;
  audience: "agent" | "human";
  summary: string;
  contractDigest: string;
  lifecycle: CapabilityLifecycle;
  schemas: {
    input: JsonSchema;
    output: JsonSchema;
  };
  effect: CapabilityEffect;
  approval: CapabilityApprovalContract;
  idempotency: CapabilityIdempotencyPolicy;
  errors: CapabilityErrorContract[];
}

export interface CapabilityWarning {
  code: "CAPABILITY_VERSION_DEPRECATED";
  message: string;
  replacement?: CapabilityIdentity;
  sunsetAt?: string;
}

export interface CapabilityInvocation {
  capability: CapabilityIdentity | string;
  input?: unknown;
}

export interface CapabilityResult<Output = unknown> {
  type: "capability_result";
  capability: CapabilityIdentity;
  requestDigest: string;
  status: "completed" | "accepted";
  output: Output;
  warnings: CapabilityWarning[];
}

export interface CapabilityError {
  type: "capability_error";
  capability: CapabilityIdentity | null;
  requestDigest: string;
  code: string;
  category: CapabilityErrorCategory;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
  remediation?: {
    capability: CapabilityIdentity;
    input?: Record<string, unknown>;
  };
  operatorTraceRef: string;
}

export type CapabilityResponse<Output = unknown> =
  | CapabilityResult<Output>
  | CapabilityError;

export interface CapabilityDispatcherPort {
  dispatch(invocation: CapabilityInvocation): Promise<CapabilityResponse>;
}

export type ResolvedSecurityContext =
  | ({ kind: "agent" } & AgentSecurityContext)
  | {
      kind: "human";
      workspaceId: string;
      userId: string;
      role: "owner" | "admin" | "member";
      /**
       * Server-validated transport key for durable human mutations.
       */
      idempotencyKey?: string;
    };

export interface CapabilityDispatchContext {
  /**
   * Authentication adapters may attach a resolved, server-owned security
   * context here. Invocation input never carries Principal or Workspace
   * identity.
   */
  securityContext?: ResolvedSecurityContext;
}

export interface CapabilityRegistryReader {
  readonly digest: string;
  listDefinitions(
    statuses?: CapabilityLifecycleStatus[],
  ): CapabilityDefinition[];
  getDefinition(identity: CapabilityIdentity): CapabilityDefinition | undefined;
}

export interface CapabilityHandlerContext extends CapabilityDispatchContext {
  registry: CapabilityRegistryReader;
  authorizationAdmission?: CapabilityAuthorizationAdmission;
}

export interface CapabilityRegistration<Input = unknown, Output = unknown> {
  identity: CapabilityIdentity;
  audience?: "agent" | "human";
  summary: string;
  lifecycle: CapabilityLifecycle;
  input: z.ZodType<Input>;
  outputSchema: JsonSchema;
  effect: CapabilityEffect;
  approval: CapabilityApprovalContract;
  idempotency: CapabilityIdempotencyPolicy;
  errors: CapabilityErrorContract[];
  authorization: {
    /**
     * Serializable selectors allow the dispatcher to extract only validated,
     * server-declared resource IDs from capability input.
     */
    resources: Array<{
      kind: AgentResourceRef["kind"];
      inputPath: string;
    }>;
  };
  handler(
    input: Input,
    context: CapabilityHandlerContext,
  ): Promise<Output> | Output;
}

export type { CapabilityAuthorizer };

export interface CapabilityCliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CapabilityCliOptions {
  dispatcher?: CapabilityDispatcherPort;
  io?: CapabilityCliIo;
}

export interface McpCapabilityTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}
