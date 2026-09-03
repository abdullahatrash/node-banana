import { getDb } from "@/lib/db";
import { CapabilityDispatcher } from "@/lib/agent-tools/dispatcher";
import {
  createAgentIdentityRegistrations,
  createCapabilityRegistry,
  createCredentialProfileRegistrations,
  createDiscoveryRegistrations,
} from "@/lib/agent-tools/registry";
import {
  CREDENTIAL_VAULT_SERVICE,
  CredentialVaultError,
  createCredentialHumanRegistrations,
} from "@/lib/credential-vault";
import type {
  CapabilityDispatchContext,
  CapabilityInvocation,
  CapabilityResponse,
} from "@/types/capabilities";
import {
  CompositeCapabilityAuthorizer,
  HumanCapabilityAuthorizer,
  WorkspaceClosureAwareAuthorizer,
} from "./composite-authorizer";
import {
  PRODUCTION_ARTIFACT_SERVICE,
  createArtifactRegistrations,
} from "./artifacts";
import {
  GOLDEN_WORKFLOW_OPERATION_REGISTRY,
  PRODUCTION_WORKFLOW_REVISION_SERVICE,
  createWorkflowRegistrations,
} from "./workflows";
import {
  createWorkflowRunRegistrations,
} from "./runs/capabilities";
import {
  PRODUCTION_WORKFLOW_RUN_SERVICE,
} from "./runs/production";
import {
  CREDENTIAL_EFFECT_EXECUTOR,
  PRODUCTION_AGENT_AUTHORIZER,
} from "./provider-effects";
import {
  PRODUCTION_USAGE_SERVICE,
  PRODUCTION_USAGE_CURSOR,
  createUsageRegistrations,
} from "./usage";
import {
  PRODUCTION_BUDGET_SERVICE,
  createBudgetRegistrations,
} from "./budgets";
import {
  createQuotaRegistrations,
  getQuotaService,
} from "./quotas";
import { recordOperationalTrace } from "./observability/production";
import { createObservabilityRegistrations } from "./observability/capabilities";
import { getObservabilityService } from "./observability/production";
import { getSupportBundleApplication } from "./observability/support-bundles-production";
import { createPublishingPlanRegistrations } from "./publishing-plans/capabilities";
import {
  PRODUCTION_PUBLISHING_PLAN_CURSOR,
  PRODUCTION_PUBLISHING_PLAN_SERVICE,
} from "./publishing-plans/production";
import { createPublishingApprovalRegistrations } from "./publishing-approvals/capabilities";
import {
  PRODUCTION_PUBLISHING_APPROVAL_CURSOR,
  PRODUCTION_PUBLISHING_APPROVAL_SERVICE,
} from "./publishing-approvals/production";
import { createPublishingDeliveryRegistrations } from
  "./publishing-deliveries/capabilities";
import {
  PRODUCTION_PUBLISHING_DELIVERY_CURSOR,
  PRODUCTION_PUBLISHING_DELIVERY_SERVICE,
} from "./publishing-deliveries/production";
import { createGovernanceRegistrations } from "@/lib/governance/capabilities";
import { PRODUCTION_GOVERNANCE_SERVICE } from "@/lib/governance/production";

export const PRODUCTION_CAPABILITY_AUTHORIZER =
  new WorkspaceClosureAwareAuthorizer(
    new CompositeCapabilityAuthorizer(
      PRODUCTION_AGENT_AUTHORIZER,
      new HumanCapabilityAuthorizer(getDb),
    ),
    getDb,
  );

/** Shared server-only credential-effect composition; never exported through
 * the capability registry or any public DTO. */
export { CREDENTIAL_EFFECT_EXECUTOR, PRODUCTION_AGENT_AUTHORIZER };

export const PRODUCTION_CAPABILITY_REGISTRY = createCapabilityRegistry([
  ...createDiscoveryRegistrations(),
  ...createAgentIdentityRegistrations(),
  ...createCredentialProfileRegistrations(CREDENTIAL_VAULT_SERVICE),
  ...createCredentialHumanRegistrations(CREDENTIAL_VAULT_SERVICE),
  ...createArtifactRegistrations(PRODUCTION_ARTIFACT_SERVICE),
  ...createWorkflowRegistrations(
    PRODUCTION_WORKFLOW_REVISION_SERVICE,
    GOLDEN_WORKFLOW_OPERATION_REGISTRY,
  ),
  ...createWorkflowRunRegistrations(PRODUCTION_WORKFLOW_RUN_SERVICE),
  ...createUsageRegistrations(PRODUCTION_USAGE_SERVICE, PRODUCTION_USAGE_CURSOR),
  ...createBudgetRegistrations(PRODUCTION_BUDGET_SERVICE),
  ...createQuotaRegistrations(getQuotaService(), {
    waitResumeCoordinator: PRODUCTION_WORKFLOW_RUN_SERVICE,
  }),
  ...createObservabilityRegistrations(
    getObservabilityService(),
    getSupportBundleApplication(),
  ),
  ...createPublishingPlanRegistrations(
    PRODUCTION_PUBLISHING_PLAN_SERVICE,
    PRODUCTION_PUBLISHING_PLAN_CURSOR,
  ),
  ...createPublishingApprovalRegistrations(
    PRODUCTION_PUBLISHING_APPROVAL_SERVICE,
    PRODUCTION_PUBLISHING_APPROVAL_CURSOR,
  ),
  ...createPublishingDeliveryRegistrations(
    PRODUCTION_PUBLISHING_DELIVERY_SERVICE,
    PRODUCTION_PUBLISHING_DELIVERY_CURSOR,
  ),
  ...createGovernanceRegistrations(PRODUCTION_GOVERNANCE_SERVICE),
]);

export const CAPABILITY_DISPATCHER = new CapabilityDispatcher(
  PRODUCTION_CAPABILITY_REGISTRY,
  PRODUCTION_CAPABILITY_AUTHORIZER,
  recordOperationalTrace,
);

export function dispatchCapability(
  invocation: CapabilityInvocation,
  context?: CapabilityDispatchContext,
): Promise<CapabilityResponse> {
  return CAPABILITY_DISPATCHER.dispatch(invocation, context);
}

export async function invokeHumanCapability(
  capability: string,
  input: unknown,
  humanContext: Extract<
    NonNullable<CapabilityDispatchContext["securityContext"]>,
    { kind: "human" }
  >,
): Promise<unknown> {
  const response = await dispatchCapability(
    { capability, input },
    { securityContext: humanContext },
  );
  if (response.type === "capability_error") {
    if (
      [
        "FORBIDDEN",
        "CONFLICT",
        "CREDENTIAL_UNAVAILABLE",
        "SPEND_NOT_AUTHORIZED",
        "INVALID_INPUT",
      ].includes(response.code)
    ) {
      throw new CredentialVaultError(
        response.code as
          | "FORBIDDEN"
          | "CONFLICT"
          | "CREDENTIAL_UNAVAILABLE"
          | "SPEND_NOT_AUTHORIZED"
          | "INVALID_INPUT",
        response.message,
      );
    }
    if (
      response.code === "CAPABILITY_NOT_AUTHORIZED" ||
      response.code === "HUMAN_CAPABILITY_NOT_AUTHORIZED"
    ) {
      throw new CredentialVaultError("FORBIDDEN", response.message);
    }
    if (
      response.code === "IDEMPOTENCY_KEY_REQUIRED" ||
      response.code === "VALIDATION_FAILED"
    ) {
      throw new CredentialVaultError("INVALID_INPUT", response.message);
    }
    const error = new Error(response.message);
    error.name = response.code;
    throw error;
  }
  return response.output;
}

/** Thin REST façade over the one canonical registry/dispatcher. */
export const CREDENTIAL_HUMAN_CAPABILITIES = {
  invoke: invokeHumanCapability,
} as const;
