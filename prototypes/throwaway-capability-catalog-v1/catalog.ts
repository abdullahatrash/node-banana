/**
 * THROWAWAY PROTOTYPE.
 *
 * Pure candidate model for a transport-neutral Application Capability
 * catalog. This is intentionally not imported by production code.
 */

import { createHash } from "node:crypto";

export const TRANSPORTS = ["cli", "mcp", "rest", "cockpit"] as const;
export const MINIMUM_V1_CAPABILITY_COUNT = 93;

export type Transport = (typeof TRANSPORTS)[number];
export type PrincipalKind = "human" | "agent";
export interface Effect {
  mutation: "none" | "runtime-state" | "external-system";
  visibility: "private" | "publicly-visible";
  timing: "immediate" | "durable-async" | "future-trigger";
  reversibility: "reversible" | "conditional" | "irreversible";
  maySpendProviderBudget: boolean;
}
export type Idempotency =
  | "retry-safe"
  | "intrinsic"
  | "key-required";
export type Execution = "immediate" | "durable-async";
export type Observation =
  | "not-applicable"
  | "single"
  | "cursor-page"
  | "event-page";
export type Approval =
  | "none"
  | "manages-approval"
  | "required-before-effect";

export interface CapabilityRef {
  id: string;
  version: number;
}

export interface CapabilityLifecycle {
  status: "experimental" | "active" | "deprecated" | "retired";
  introducedAt: string;
  recommended: boolean;
  deprecatedAt?: string;
  sunsetAt?: string;
  replacement?: CapabilityRef;
}

export interface CapabilityDefinition {
  id: string;
  version: number;
  summary: string;
  domain: string;
  inputSchema: string;
  outputSchema: string;
  errorSet: string;
  effect: Effect;
  idempotency: Idempotency;
  execution: Execution;
  observation: Observation;
  approval: Approval;
  principalKinds: PrincipalKind[];
  requiredScopes: string[];
  auditEvent: string;
  contractDigest: string;
  lifecycle: CapabilityLifecycle;
  returnsResource?: string;
  inspectCapability?: CapabilityRef;
  eventCapability?: CapabilityRef;
}

export interface AgentRecipe {
  id: string;
  version: number;
  goal: string;
  ownsDurableState: false;
  steps: Array<{
    id: string;
    capability: CapabilityRef;
    when?: string;
    pause?: "approval" | "external-input";
    recovery?: CapabilityRef[];
  }>;
}

interface CandidateDefaults {
  version?: number;
  errorSet?: string;
  effect?: Effect;
  idempotency?: Idempotency;
  execution?: Execution;
  observation?: Observation;
  approval?: Approval;
  principalKinds?: PrincipalKind[];
  requiredScopes?: string[];
  auditEvent?: string;
  lifecycle?: CapabilityLifecycle;
  returnsResource?: string;
  inspectCapability?: CapabilityRef;
  eventCapability?: CapabilityRef;
}

type DigestibleDefinition = Omit<
  CapabilityDefinition,
  "contractDigest" | "lifecycle"
>;

function contractDigest(
  definition: DigestibleDefinition | CapabilityDefinition,
): string {
  const {
    contractDigest: _storedDigest,
    lifecycle: _lifecycle,
    ...contract
  } = definition as CapabilityDefinition;
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(contract))
    .digest("hex")}`;
}

const QUERY_EFFECT: Effect = {
  mutation: "none",
  visibility: "private",
  timing: "immediate",
  reversibility: "reversible",
  maySpendProviderBudget: false,
};

const STATE_EFFECT: Effect = {
  mutation: "runtime-state",
  visibility: "private",
  timing: "immediate",
  reversibility: "conditional",
  maySpendProviderBudget: false,
};

const PRIVATE_EXECUTION_EFFECT: Effect = {
  mutation: "external-system",
  visibility: "private",
  timing: "durable-async",
  reversibility: "conditional",
  maySpendProviderBudget: true,
};

const PUBLIC_EXECUTION_EFFECT: Effect = {
  mutation: "external-system",
  visibility: "publicly-visible",
  timing: "durable-async",
  reversibility: "conditional",
  maySpendProviderBudget: false,
};

function capability(
  id: string,
  summary: string,
  inputSchema: string,
  outputSchema: string,
  options: CandidateDefaults = {},
): CapabilityDefinition {
  const definition: DigestibleDefinition = {
    id,
    version: options.version ?? 1,
    summary,
    domain: id.split(".")[0],
    inputSchema,
    outputSchema,
    errorSet: options.errorSet ?? "common/v1",
    effect: options.effect ?? QUERY_EFFECT,
    idempotency: options.idempotency ?? "retry-safe",
    execution: options.execution ?? "immediate",
    observation: options.observation ?? "not-applicable",
    approval: options.approval ?? "none",
    principalKinds: options.principalKinds ?? ["human", "agent"],
    requiredScopes: options.requiredScopes ?? [`${id}:invoke`],
    auditEvent:
      options.auditEvent ??
      (options.effect && options.effect.mutation !== "none"
        ? `${id}.accepted`
        : `${id}.observed`),
    returnsResource: options.returnsResource,
    inspectCapability: options.inspectCapability,
    eventCapability: options.eventCapability,
  };
  return {
    ...definition,
    contractDigest: contractDigest(definition),
    lifecycle: options.lifecycle ?? {
      status: "active",
      introducedAt: "2026-07-24T00:00:00.000Z",
      recommended: true,
    },
  };
}

const query = (
  id: string,
  summary: string,
  input: string,
  output: string,
  options: CandidateDefaults = {},
) =>
  capability(id, summary, input, output, {
    observation:
      options.observation ??
      (id.endsWith("_events.list")
        ? "event-page"
        : id.endsWith(".list")
          ? "cursor-page"
          : "single"),
    ...options,
  });

const command = (
  id: string,
  summary: string,
  input: string,
  output: string,
  options: CandidateDefaults = {},
) =>
  capability(id, summary, input, output, {
    effect: STATE_EFFECT,
    idempotency: "key-required",
    ...options,
  });

const v1 = (id: string): CapabilityRef => ({ id, version: 1 });

export const CANDIDATE_CAPABILITIES: CapabilityDefinition[] = [
  query(
    "capabilities.list",
    "Discover the authorized capability subset and contract versions.",
    "capability-list-input/v1",
    "capability-page/v1",
    { requiredScopes: [] },
  ),
  query(
    "capabilities.get",
    "Inspect one authorized capability contract.",
    "capability-ref/v1",
    "capability-definition/v1",
    { requiredScopes: [] },
  ),
  query(
    "identity.get_current",
    "Inspect the effective Principal, Workspace, scopes, and policy context.",
    "empty/v1",
    "effective-identity/v1",
    { requiredScopes: [] },
  ),

  query(
    "channels.list",
    "List connected Channels visible to the Principal.",
    "channel-list-input/v1",
    "channel-page/v1",
  ),
  query(
    "channels.get",
    "Inspect one Channel and its connection state.",
    "channel-ref/v1",
    "channel/v1",
  ),
  query(
    "channels.get_capabilities",
    "Inspect current publishing constraints for one Channel.",
    "channel-ref/v1",
    "channel-capabilities/v1",
  ),
  command(
    "channel_connections.begin",
    "Begin a human-adjacent Channel authorization handoff.",
    "channel-connection-begin-input/v1",
    "channel-connection-handoff/v1",
    {
      idempotency: "intrinsic",
      returnsResource: "Channel Connection Handoff",
    },
  ),
  query(
    "channel_connections.get",
    "Inspect a Channel authorization handoff.",
    "channel-connection-handoff-ref/v1",
    "channel-connection-handoff/v1",
  ),
  command(
    "channels.disconnect",
    "Disconnect a Channel and revoke its active provider connection.",
    "channel-command-input/v1",
    "channel/v1",
    {
      idempotency: "intrinsic",
      returnsResource: "Channel",
    },
  ),

  query(
    "workflows.get",
    "Inspect a logical Content Workflow and its current version pointers.",
    "workflow-ref/v1",
    "workflow/v1",
  ),
  query(
    "workflows.list",
    "List logical Content Workflows.",
    "workflow-list-input/v1",
    "workflow-page/v1",
  ),
  query(
    "workflow_versions.validate",
    "Validate a Content Workflow candidate without persisting it.",
    "content-workflow/v1",
    "workflow-validation-result/v1",
  ),
  command(
    "workflow_versions.create",
    "Validate and persist an immutable Content Workflow version.",
    "content-workflow/v1",
    "content-workflow-version/v1",
    { returnsResource: "Content Workflow Version" },
  ),
  query(
    "workflow_versions.get",
    "Inspect an immutable Content Workflow version.",
    "content-workflow-version-ref/v1",
    "content-workflow-version/v1",
  ),
  query(
    "workflow_versions.list",
    "List Content Workflow versions.",
    "workflow-version-list-input/v1",
    "workflow-version-page/v1",
  ),
  command(
    "workflow_runs.start",
    "Start a durable Run from an immutable Workflow version.",
    "workflow-run-start-input/v1",
    "workflow-run/v1",
    {
      effect: PRIVATE_EXECUTION_EFFECT,
      execution: "durable-async",
      returnsResource: "Workflow Run",
      inspectCapability: v1("workflow_runs.get"),
      eventCapability: v1("workflow_run_events.list"),
    },
  ),
  query(
    "workflow_runs.get",
    "Inspect the canonical snapshot of a Workflow Run.",
    "workflow-run-ref/v1",
    "workflow-run/v1",
  ),
  query(
    "workflow_runs.list",
    "List Workflow Runs.",
    "workflow-run-list-input/v1",
    "workflow-run-page/v1",
  ),
  query(
    "workflow_run_events.list",
    "Page retained events for one Workflow Run.",
    "workflow-run-event-list-input/v1",
    "workflow-run-event-page/v1",
  ),
  command(
    "workflow_runs.cancel",
    "Request cancellation of a non-terminal Workflow Run.",
    "workflow-run-command-input/v1",
    "workflow-run/v1",
    { idempotency: "intrinsic", returnsResource: "Workflow Run" },
  ),
  command(
    "workflow_runs.retry",
    "Create a derived manual-retry Workflow Run.",
    "workflow-run-retry-input/v1",
    "workflow-run/v1",
    {
      effect: PRIVATE_EXECUTION_EFFECT,
      execution: "durable-async",
      returnsResource: "Workflow Run",
      inspectCapability: v1("workflow_runs.get"),
      eventCapability: v1("workflow_run_events.list"),
    },
  ),
  command(
    "workflow_runs.submit_input",
    "Submit exact external input to a waiting Workflow Run and resume it.",
    "workflow-run-input-submission/v1",
    "workflow-run/v1",
    {
      effect: PRIVATE_EXECUTION_EFFECT,
      execution: "durable-async",
      returnsResource: "Workflow Run",
      inspectCapability: v1("workflow_runs.get"),
      eventCapability: v1("workflow_run_events.list"),
    },
  ),

  command(
    "artifacts.import",
    "Import immutable content into the Workspace Artifact store.",
    "artifact-import-input/v1",
    "artifact/v1",
    { returnsResource: "Artifact" },
  ),
  query(
    "artifacts.get",
    "Inspect Artifact metadata and provenance.",
    "artifact-ref/v1",
    "artifact/v1",
  ),
  query(
    "artifacts.list",
    "List Artifacts by kind, provenance, or creation time.",
    "artifact-list-input/v1",
    "artifact-page/v1",
  ),
  command(
    "artifact_uploads.begin",
    "Begin a bounded binary upload handoff for a future Artifact.",
    "artifact-upload-begin-input/v1",
    "artifact-upload-handoff/v1",
    {
      returnsResource: "Artifact Upload Handoff",
    },
  ),
  command(
    "artifact_uploads.complete",
    "Verify a completed upload and persist its immutable Artifact.",
    "artifact-upload-complete-input/v1",
    "artifact/v1",
    {
      idempotency: "intrinsic",
      returnsResource: "Artifact",
    },
  ),
  command(
    "artifact_downloads.create",
    "Create a short-lived authorized download handoff for an Artifact.",
    "artifact-download-input/v1",
    "artifact-download-handoff/v1",
    {
      returnsResource: "Artifact Download Handoff",
    },
  ),

  query(
    "publishing_plans.get",
    "Inspect a logical Publishing Plan and its current revision pointer.",
    "publishing-plan-ref/v1",
    "publishing-plan-resource/v1",
  ),
  query(
    "publishing_plans.list",
    "List logical Publishing Plans.",
    "publishing-plan-list-input/v1",
    "publishing-plan-page/v1",
  ),
  query(
    "publishing_plan_revisions.validate",
    "Validate a Publishing Plan candidate without persisting it.",
    "publishing-plan/v1",
    "publishing-plan-contract-validation/v1",
  ),
  command(
    "publishing_plan_revisions.create",
    "Validate and persist an immutable Publishing Plan revision.",
    "publishing-plan/v1",
    "publishing-plan-revision/v1",
    { returnsResource: "Publishing Plan Revision" },
  ),
  query(
    "publishing_plan_revisions.get",
    "Inspect an immutable Publishing Plan revision.",
    "publishing-plan-revision-ref/v1",
    "publishing-plan-revision/v1",
  ),
  query(
    "publishing_plan_revisions.list",
    "List Publishing Plan revisions.",
    "publishing-plan-revision-list-input/v1",
    "publishing-plan-revision-page/v1",
  ),
  command(
    "publishing_validations.create",
    "Record target-by-target readiness for an exact Plan revision.",
    "publishing-validation-input/v1",
    "publishing-validation/v1",
    { idempotency: "intrinsic", returnsResource: "Publishing Validation" },
  ),
  query(
    "publishing_validations.get",
    "Inspect one durable Publishing Validation.",
    "publishing-validation-ref/v1",
    "publishing-validation/v1",
  ),
  query(
    "publishing_validations.list",
    "List durable Publishing Validations for a Plan revision.",
    "publishing-validation-list-input/v1",
    "publishing-validation-page/v1",
  ),
  command(
    "publishing_approvals.request",
    "Request a revision-, action-, and target-bound Approval.",
    "publishing-approval-request-input/v1",
    "publishing-approval/v1",
    { approval: "manages-approval", returnsResource: "Publishing Approval" },
  ),
  query(
    "publishing_approvals.get",
    "Inspect one durable Publishing Approval.",
    "publishing-approval-ref/v1",
    "publishing-approval/v1",
    { approval: "manages-approval" },
  ),
  query(
    "publishing_approvals.list",
    "List Publishing Approvals visible to the Principal.",
    "publishing-approval-list-input/v1",
    "publishing-approval-page/v1",
    { approval: "manages-approval" },
  ),
  command(
    "publishing_approvals.decide",
    "Approve or reject a pending Approval as a Human Principal.",
    "publishing-approval-decision-input/v1",
    "publishing-approval/v1",
    {
      approval: "manages-approval",
      principalKinds: ["human"],
      requiredScopes: ["publishing_approvals:decide"],
      returnsResource: "Publishing Approval",
    },
  ),
  command(
    "publishing_approvals.revoke",
    "Revoke an eligible unconsumed Approval.",
    "publishing-approval-revoke-input/v1",
    "publishing-approval/v1",
    {
      approval: "manages-approval",
      idempotency: "intrinsic",
      returnsResource: "Publishing Approval",
    },
  ),
  command(
    "publishing.release",
    "Consume an exact Approval and create one Delivery per approved target.",
    "publishing-release-input/v1",
    "publishing-release-result/v1",
    {
      effect: PUBLIC_EXECUTION_EFFECT,
      approval: "required-before-effect",
      execution: "durable-async",
      returnsResource: "Publishing Delivery",
      inspectCapability: v1("publishing_deliveries.list"),
      eventCapability: v1("publishing_delivery_events.list"),
    },
  ),
  query(
    "publishing_deliveries.get",
    "Inspect one Publishing Delivery and its attempts.",
    "publishing-delivery-ref/v1",
    "publishing-delivery/v1",
  ),
  query(
    "publishing_deliveries.list",
    "List Publishing Deliveries.",
    "publishing-delivery-list-input/v1",
    "publishing-delivery-page/v1",
  ),
  query(
    "publishing_delivery_events.list",
    "Page retained events for one Publishing Delivery.",
    "publishing-delivery-event-list-input/v1",
    "publishing-delivery-event-page/v1",
  ),
  command(
    "publishing_deliveries.cancel",
    "Cancel an eligible Delivery before provider publishing begins.",
    "publishing-delivery-command-input/v1",
    "publishing-delivery/v1",
    { idempotency: "intrinsic", returnsResource: "Publishing Delivery" },
  ),
  command(
    "publishing_deliveries.retry",
    "Create a new Delivery from a failed one under fresh Approval.",
    "publishing-delivery-retry-input/v1",
    "publishing-delivery/v1",
    {
      effect: PUBLIC_EXECUTION_EFFECT,
      approval: "required-before-effect",
      execution: "durable-async",
      returnsResource: "Publishing Delivery",
      inspectCapability: v1("publishing_deliveries.get"),
      eventCapability: v1("publishing_delivery_events.list"),
    },
  ),
  command(
    "publishing_deliveries.reconcile",
    "Resolve a Delivery whose provider outcome is unknown.",
    "publishing-delivery-reconcile-input/v1",
    "publishing-delivery/v1",
    {
      effect: {
        ...STATE_EFFECT,
        timing: "durable-async",
      },
      execution: "durable-async",
      returnsResource: "Publishing Delivery",
      inspectCapability: v1("publishing_deliveries.get"),
      eventCapability: v1("publishing_delivery_events.list"),
    },
  ),
  command(
    "publishing_deliveries.resume",
    "Resume a blocked Delivery after exact external readiness is restored.",
    "publishing-delivery-resume-input/v1",
    "publishing-delivery/v1",
    {
      effect: PUBLIC_EXECUTION_EFFECT,
      execution: "durable-async",
      returnsResource: "Publishing Delivery",
      inspectCapability: v1("publishing_deliveries.get"),
      eventCapability: v1("publishing_delivery_events.list"),
    },
  ),

  query(
    "automations.get",
    "Inspect a logical Automation, active revision, and control state.",
    "automation-ref/v1",
    "automation/v1",
  ),
  query(
    "automations.list",
    "List logical Automations.",
    "automation-list-input/v1",
    "automation-page/v1",
  ),
  query(
    "automation_revisions.validate",
    "Validate an Automation candidate without persisting it.",
    "automation/v1",
    "automation-validation-result/v1",
  ),
  command(
    "automation_revisions.create",
    "Validate and persist an immutable Automation revision.",
    "automation/v1",
    "automation-revision/v1",
    { returnsResource: "Automation Revision" },
  ),
  query(
    "automation_revisions.get",
    "Inspect an immutable Automation revision.",
    "automation-revision-ref/v1",
    "automation-revision/v1",
  ),
  query(
    "automation_revisions.list",
    "List Automation revisions.",
    "automation-revision-list-input/v1",
    "automation-revision-page/v1",
  ),
  command(
    "automations.activate",
    "Atomically make one Automation revision active.",
    "automation-activate-input/v1",
    "automation/v1",
    {
      effect: {
        mutation: "external-system",
        visibility: "publicly-visible",
        timing: "future-trigger",
        reversibility: "conditional",
        maySpendProviderBudget: true,
      },
      returnsResource: "Automation",
    },
  ),
  command(
    "automations.pause",
    "Pause future Automation occurrences.",
    "automation-command-input/v1",
    "automation/v1",
    { idempotency: "intrinsic", returnsResource: "Automation" },
  ),
  command(
    "automations.resume",
    "Resume future Automation occurrences.",
    "automation-command-input/v1",
    "automation/v1",
    { idempotency: "intrinsic", returnsResource: "Automation" },
  ),
  command(
    "automations.invoke",
    "Materialize a manual occurrence through the same durable path.",
    "automation-invoke-input/v1",
    "automation-occurrence/v1",
    {
      effect: {
        ...PUBLIC_EXECUTION_EFFECT,
        maySpendProviderBudget: true,
      },
      execution: "durable-async",
      returnsResource: "Automation Occurrence",
      inspectCapability: v1("automation_occurrences.get"),
      eventCapability: v1("automation_events.list"),
    },
  ),
  query(
    "automation_occurrences.get",
    "Inspect one durable Automation occurrence.",
    "automation-occurrence-ref/v1",
    "automation-occurrence/v1",
  ),
  query(
    "automation_occurrences.list",
    "List Automation occurrences.",
    "automation-occurrence-list-input/v1",
    "automation-occurrence-page/v1",
  ),
  query(
    "automation_events.list",
    "Page retained events for one Automation.",
    "automation-event-list-input/v1",
    "automation-event-page/v1",
  ),
  command(
    "automation_occurrences.cancel",
    "Cancel an eligible Automation occurrence.",
    "automation-occurrence-command-input/v1",
    "automation-occurrence/v1",
    { idempotency: "intrinsic", returnsResource: "Automation Occurrence" },
  ),
  command(
    "automation_occurrences.retry",
    "Create a new derived occurrence for a retryable failure.",
    "automation-occurrence-retry-input/v1",
    "automation-occurrence/v1",
    {
      execution: "durable-async",
      returnsResource: "Automation Occurrence",
      inspectCapability: v1("automation_occurrences.get"),
      eventCapability: v1("automation_events.list"),
    },
  ),
  command(
    "automations.retire",
    "Terminally retire an Automation and prevent future occurrences.",
    "automation-command-input/v1",
    "automation/v1",
    {
      idempotency: "intrinsic",
      returnsResource: "Automation",
    },
  ),
  query(
    "automation_trigger_receipts.list",
    "List deduplication receipts retained for one Automation trigger.",
    "automation-trigger-receipt-list-input/v1",
    "automation-trigger-receipt-page/v1",
  ),
  command(
    "automation_trigger_receipts.replay",
    "Privileged replay of an accepted trigger receipt through occurrence creation.",
    "automation-trigger-replay-input/v1",
    "automation-occurrence/v1",
    {
      effect: {
        ...PUBLIC_EXECUTION_EFFECT,
        maySpendProviderBudget: true,
      },
      execution: "durable-async",
      principalKinds: ["human"],
      requiredScopes: ["automations:replay"],
      returnsResource: "Automation Occurrence",
      inspectCapability: v1("automation_occurrences.get"),
      eventCapability: v1("automation_events.list"),
    },
  ),
  command(
    "automation_cursors.reset",
    "Privileged reset of a trigger cursor to an explicit safe position.",
    "automation-cursor-reset-input/v1",
    "automation/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["automations:cursors:admin"],
      returnsResource: "Automation",
    },
  ),

  query(
    "agent_principals.get",
    "Inspect one Agent Principal and safe grant metadata.",
    "agent-principal-ref/v1",
    "agent-principal/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.agent_principals:admin"],
    },
  ),
  query(
    "agent_principals.list",
    "List Agent Principals in the Workspace.",
    "agent-principal-list-input/v1",
    "agent-principal-page/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.agent_principals:admin"],
    },
  ),
  command(
    "agent_principals.create",
    "Create a deny-by-default Workspace-bound Agent Principal.",
    "agent-principal-create-input/v1",
    "agent-principal/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.agent_principals:admin"],
      returnsResource: "Agent Principal",
    },
  ),
  command(
    "agent_principals.suspend",
    "Reversibly suspend an Agent Principal.",
    "agent-principal-command-input/v1",
    "agent-principal/v1",
    {
      idempotency: "intrinsic",
      principalKinds: ["human"],
      requiredScopes: ["security.agent_principals:admin"],
      returnsResource: "Agent Principal",
    },
  ),
  command(
    "agent_principals.resume",
    "Resume a suspended Agent Principal after accountability review.",
    "agent-principal-command-input/v1",
    "agent-principal/v1",
    {
      idempotency: "intrinsic",
      principalKinds: ["human"],
      requiredScopes: ["security.agent_principals:admin"],
      returnsResource: "Agent Principal",
    },
  ),
  command(
    "agent_principals.revoke",
    "Terminally revoke an Agent Principal and its active keys.",
    "agent-principal-revoke-input/v1",
    "agent-principal/v1",
    {
      idempotency: "intrinsic",
      principalKinds: ["human"],
      requiredScopes: ["security.agent_principals:admin"],
      returnsResource: "Agent Principal",
    },
  ),
  query(
    "agent_keys.list",
    "List safe Agent Key metadata for an Agent Principal.",
    "agent-key-list-input/v1",
    "agent-key-page/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.agent_keys:admin"],
    },
  ),
  command(
    "agent_keys.create",
    "Create an additional Agent Key and return plaintext once.",
    "agent-key-create-input/v1",
    "agent-key-secret-once/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.agent_keys:admin"],
      returnsResource: "Agent Key",
    },
  ),
  command(
    "agent_keys.rotate",
    "Rotate an Agent Key without changing Principal identity.",
    "agent-key-rotate-input/v1",
    "agent-key-secret-once/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.agent_keys:admin"],
    },
  ),
  command(
    "agent_keys.revoke",
    "Revoke one Agent Key without deleting its Principal or audit history.",
    "agent-key-revoke-input/v1",
    "agent-key/v1",
    {
      idempotency: "intrinsic",
      principalKinds: ["human"],
      requiredScopes: ["security.agent_keys:admin"],
      returnsResource: "Agent Key",
    },
  ),
  query(
    "principal_grant_revisions.get",
    "Inspect one immutable Principal Grant Set revision.",
    "principal-grant-revision-ref/v1",
    "principal-grant-revision/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.principal_grants:admin"],
    },
  ),
  query(
    "principal_grant_revisions.list",
    "List Principal Grant Set revisions.",
    "principal-grant-revision-list-input/v1",
    "principal-grant-revision-page/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.principal_grants:admin"],
    },
  ),
  command(
    "principal_grant_revisions.create_and_activate",
    "Create and activate an immutable deny-by-default Grant Set revision.",
    "principal-grant-revision-input/v1",
    "principal-grant-revision/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.principal_grants:admin"],
      returnsResource: "Principal Grant Set Revision",
    },
  ),
  query(
    "auto_publish_grants.get",
    "Inspect one Auto-publish Grant.",
    "auto-publish-grant-ref/v1",
    "auto-publish-grant/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.auto_publish_grants:admin"],
    },
  ),
  query(
    "auto_publish_grants.list",
    "List Auto-publish Grants.",
    "auto-publish-grant-list-input/v1",
    "auto-publish-grant-page/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.auto_publish_grants:admin"],
    },
  ),
  command(
    "auto_publish_grants.create",
    "Grant narrowly scoped policy approval authority to an Agent Principal.",
    "auto-publish-grant-input/v1",
    "auto-publish-grant/v1",
    {
      principalKinds: ["human"],
      requiredScopes: ["security.auto_publish_grants:admin"],
      returnsResource: "Auto-publish Grant",
    },
  ),
  command(
    "auto_publish_grants.revoke",
    "Revoke an Auto-publish Grant.",
    "auto-publish-grant-ref/v1",
    "auto-publish-grant/v1",
    {
      idempotency: "intrinsic",
      principalKinds: ["human"],
      requiredScopes: ["security.auto_publish_grants:admin"],
      returnsResource: "Auto-publish Grant",
    },
  ),
  query(
    "credential_profiles.get",
    "Inspect non-secret metadata for one Credential Profile.",
    "credential-profile-ref/v1",
    "credential-profile/v1",
    { requiredScopes: ["credentials.profiles:read"] },
  ),
  query(
    "credential_profiles.list",
    "List non-secret Credential Profile metadata visible to the Principal.",
    "credential-profile-list-input/v1",
    "credential-profile-page/v1",
    { requiredScopes: ["credentials.profiles:read"] },
  ),
  command(
    "credential_handoffs.begin",
    "Begin a human-adjacent credential provisioning handoff.",
    "credential-handoff-begin-input/v1",
    "credential-handoff/v1",
    {
      idempotency: "intrinsic",
      requiredScopes: ["credentials.handoffs:create"],
      returnsResource: "Credential Handoff",
    },
  ),
  query(
    "credential_handoffs.get",
    "Inspect a credential provisioning handoff without exposing secrets.",
    "credential-handoff-ref/v1",
    "credential-handoff/v1",
    { requiredScopes: ["credentials.handoffs:read"] },
  ),
  command(
    "credential_handoffs.complete",
    "Complete a write-only secret handoff and create a Credential version.",
    "credential-handoff-secret-input/v1",
    "credential-profile/v1",
    {
      idempotency: "intrinsic",
      principalKinds: ["human"],
      requiredScopes: ["credentials.handoffs:complete"],
      returnsResource: "Credential Profile",
    },
  ),
  command(
    "credential_profiles.disable",
    "Disable a Credential Profile without deleting audit history.",
    "credential-profile-command-input/v1",
    "credential-profile/v1",
    {
      idempotency: "intrinsic",
      principalKinds: ["human"],
      requiredScopes: ["credentials.profiles:admin"],
      returnsResource: "Credential Profile",
    },
  ),
  query(
    "security_events.list",
    "List safe Security Events allowed by the Principal's audit scope.",
    "security-event-list-input/v1",
    "security-event-page/v1",
    {
      observation: "cursor-page",
      requiredScopes: ["security.events:read"],
    },
  ),
];

export const CANDIDATE_RECIPES: AgentRecipe[] = [
  {
    id: "campaign.create_and_schedule",
    version: 1,
    goal: "Generate campaign content, obtain approval, and schedule it.",
    ownsDurableState: false,
    steps: [
      {
        id: "start-generation",
        capability: v1("workflow_runs.start"),
        recovery: [
          v1("workflow_runs.get"),
          v1("workflow_run_events.list"),
        ],
      },
      {
        id: "inspect-generation",
        capability: v1("workflow_runs.get"),
        when: "the Workflow Run is non-terminal or needs recovery",
        recovery: [v1("workflow_runs.retry")],
      },
      {
        id: "persist-plan",
        capability: v1("publishing_plan_revisions.create"),
        when: "the Workflow Run produced the required Artifacts",
      },
      {
        id: "validate-plan",
        capability: v1("publishing_validations.create"),
        recovery: [v1("channels.get_capabilities")],
      },
      {
        id: "request-approval",
        capability: v1("publishing_approvals.request"),
        pause: "approval",
        recovery: [v1("publishing_approvals.get")],
      },
      {
        id: "release",
        capability: v1("publishing.release"),
        when: "the exact Approval is approved and still valid",
        recovery: [v1("publishing_deliveries.list")],
      },
    ],
  },
  {
    id: "delivery.recover_failed",
    version: 1,
    goal: "Safely recover a failed or outcome-unknown Publishing Delivery.",
    ownsDurableState: false,
    steps: [
      {
        id: "inspect",
        capability: v1("publishing_deliveries.get"),
      },
      {
        id: "reconcile-unknown",
        capability: v1("publishing_deliveries.reconcile"),
        when: "the latest Attempt outcome is unknown",
        recovery: [v1("publishing_deliveries.get")],
      },
      {
        id: "request-fresh-approval",
        capability: v1("publishing_approvals.request"),
        when: "the Delivery is terminally failed and retry is eligible",
        pause: "approval",
      },
      {
        id: "retry",
        capability: v1("publishing_deliveries.retry"),
        when: "fresh exact Approval is approved",
        recovery: [v1("publishing_deliveries.get")],
      },
    ],
  },
  {
    id: "channel.connect",
    version: 1,
    goal: "Start a human-adjacent Channel connection and observe completion.",
    ownsDurableState: false,
    steps: [
      {
        id: "begin",
        capability: v1("channel_connections.begin"),
        pause: "external-input",
        recovery: [v1("channel_connections.get")],
      },
      {
        id: "inspect",
        capability: v1("channel_connections.get"),
      },
    ],
  },
];

export interface CanonicalInvocation {
  capability: { id: string; version: number };
  requestId: string;
  idempotencyKey?: string;
  input: Record<string, unknown>;
}

export interface SecurityContext {
  workspaceId: string;
  principalRef: string;
  principalKind: PrincipalKind;
}

export interface DispatchInvocation {
  invocation: CanonicalInvocation;
  securityContext: SecurityContext;
}

export interface CapabilityResult {
  capability: { id: string; version: number };
  requestId: string;
  status: "completed" | "accepted";
  result: Record<string, unknown>;
  continuation?: {
    resourceRefs: string[];
    inspect: {
      capability: { id: string; version: number };
      input: Record<string, unknown>;
    };
    events?: {
      capability: { id: string; version: number };
      afterSequence: number;
    };
  };
}

export type ErrorCategory =
  | "invalid-request"
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "precondition-failed"
  | "rate-limited"
  | "unavailable"
  | "internal";

export interface CapabilityError {
  capability: { id: string; version: number };
  requestId: string;
  error: {
    code: string;
    category: ErrorCategory;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
    remediation?: {
      capability: { id: string; version: number };
      prefill?: Record<string, unknown>;
    };
    traceRef: string;
  };
}

export const IDEMPOTENCY_CONTRACT = {
  keyScope: [
    "workspaceId",
    "principalRef",
    "capability.id",
    "capability.version",
    "idempotencyKey",
  ],
  fingerprint: "canonical semantic input",
  exactReplay: "return-original-receipt",
  changedInput: "IDEMPOTENCY_CONFLICT",
  acceptance: "atomic-with-state-change-or-enqueue",
  preAcceptanceFailure: "does-not-consume-key",
  providerEffects:
    "use-separate-runtime-owned-effect-key-across-attempts-and-reconciliation",
} as const;

export const OBSERVATION_CONTRACT = {
  collection: {
    shape: ["items", "nextCursor"],
    cursor: "opaque",
    boundTo: [
      "workspaceId",
      "principalRef",
      "capability.id",
      "capability.version",
      "normalizedFilters",
      "stableSort",
    ],
    total: "optional",
  },
  events: {
    input: ["resourceRef", "afterSequence"],
    output: ["events", "nextSequence", "latestSequence"],
    ordering: "monotonic-per-resource-sequence",
    snapshot: "authoritative",
  },
  everyRead: "recheck-current-authorization",
  transportProjection: ["cli-wait", "mcp-poll", "rest-stream", "cockpit-live"],
} as const;

export const APPROVAL_CONTRACT = {
  modes: ["none", "manages-approval", "required-before-effect"],
  enforcement: "inside-application-capability",
  authorizationRelationship: "separate-mandatory-check",
  acceptedEvidence: "exact-durable-approval-reference",
  humanAndPolicyDecision: "same-approval-resource",
  transportConfirmation: "guidance-only",
  beforeGate: "no-partial-work-or-provider-effect",
  errors: {
    missing: "APPROVAL_REQUIRED",
    invalid: "APPROVAL_INVALID",
  },
} as const;

export const TRANSPORT_PARITY_CONTRACT = {
  sourceOfTruth: "capability-registry",
  dispatcherInput: ["canonical-invocation", "resolved-security-context"],
  callerMaySupplyIdentity: false,
  generatedArtifacts: [
    "json-schema",
    "cli-help",
    "mcp-tools",
    "rest-openapi",
    "cockpit-sdk",
    "effect-warnings",
  ],
  adapterResponsibilities: [
    "authentication-acquisition",
    "framing",
    "streaming",
    "presentation",
  ],
  parityAssertions: [
    "authorization",
    "approval",
    "idempotency",
    "effect",
    "result",
    "error",
  ],
} as const;

export interface IdempotencyReceipt {
  scope: {
    workspaceId: string;
    principalRef: string;
    capability: { id: string; version: number };
    key: string;
  };
  inputFingerprint: string;
  resultRef: string;
}

export interface IdempotencyProbe {
  outcome: "accepted" | "replayed" | "conflict" | "not-keyed";
  receipt?: IdempotencyReceipt;
  error?: "IDEMPOTENCY_CONFLICT";
}

export interface TransportMapping {
  transport: Transport;
  canonicalCapability: { id: string; version: number };
  adapter: Record<string, unknown>;
}

const ERROR_TRANSPORT_MAP: Record<
  ErrorCategory,
  { httpStatus: number; cliExitCode: number; mcpError: boolean }
> = {
  "invalid-request": { httpStatus: 400, cliExitCode: 2, mcpError: true },
  unauthenticated: { httpStatus: 401, cliExitCode: 4, mcpError: true },
  forbidden: { httpStatus: 403, cliExitCode: 4, mcpError: true },
  "not-found": { httpStatus: 404, cliExitCode: 3, mcpError: true },
  conflict: { httpStatus: 409, cliExitCode: 3, mcpError: true },
  "precondition-failed": {
    httpStatus: 412,
    cliExitCode: 3,
    mcpError: true,
  },
  "rate-limited": { httpStatus: 429, cliExitCode: 5, mcpError: true },
  unavailable: { httpStatus: 503, cliExitCode: 5, mcpError: true },
  internal: { httpStatus: 500, cliExitCode: 1, mcpError: true },
};

function definitionByRef(ref: CapabilityRef): CapabilityDefinition {
  const definition = CANDIDATE_CAPABILITIES.find(
    (candidate) =>
      candidate.id === ref.id && candidate.version === ref.version,
  );
  if (!definition) {
    throw new Error(`Unknown prototype capability: ${ref.id}@${ref.version}`);
  }
  return definition;
}

function canonicalFingerprint(input: Record<string, unknown>): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, sort(child)]),
      );
    }
    return value;
  };
  return JSON.stringify(sort(input));
}

function receiptKey(
  invocation: CanonicalInvocation,
  securityContext: SecurityContext,
): string {
  return [
    securityContext.workspaceId,
    securityContext.principalRef,
    `${invocation.capability.id}@${invocation.capability.version}`,
    invocation.idempotencyKey,
  ].join("|");
}

export function acceptIdempotentInvocation(
  definition: CapabilityDefinition,
  invocation: CanonicalInvocation,
  securityContext: SecurityContext,
  receipts: Map<string, IdempotencyReceipt>,
): IdempotencyProbe {
  if (definition.idempotency !== "key-required") {
    return { outcome: "not-keyed" };
  }
  if (!invocation.idempotencyKey) {
    throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  }

  const key = receiptKey(invocation, securityContext);
  const fingerprint = canonicalFingerprint(invocation.input);
  const existing = receipts.get(key);
  if (existing) {
    return existing.inputFingerprint === fingerprint
      ? { outcome: "replayed", receipt: existing }
      : { outcome: "conflict", error: "IDEMPOTENCY_CONFLICT" };
  }

  const receipt: IdempotencyReceipt = {
    scope: {
      workspaceId: securityContext.workspaceId,
      principalRef: securityContext.principalRef,
      capability: invocation.capability,
      key: invocation.idempotencyKey,
    },
    inputFingerprint: fingerprint,
    resultRef: `${definition.returnsResource ?? "result"}:prototype-01`,
  };
  receipts.set(key, receipt);
  return { outcome: "accepted", receipt };
}

export function idempotencyWalkthrough(
  definition: CapabilityDefinition,
): Record<string, unknown> {
  if (definition.idempotency !== "key-required") {
    return {
      policy: definition.idempotency,
      behavior:
        definition.idempotency === "retry-safe"
          ? "repeat the query; no key accepted"
          : "repeat the desired-state command; target and outcome deduplicate",
    };
  }

  const receipts = new Map<string, IdempotencyReceipt>();
  const first = sampleInvocation(definition);
  const exactReplay = structuredClone(first);
  const conflictingReplay = structuredClone(first);
  conflictingReplay.input.example = "different semantic input";
  const securityContext = sampleSecurityContext();
  const anotherPrincipal: SecurityContext = {
    ...securityContext,
    principalRef: "agent-principal:other-operator",
  };

  return {
    policy: definition.idempotency,
    contract: IDEMPOTENCY_CONTRACT,
    first: acceptIdempotentInvocation(
      definition,
      first,
      securityContext,
      receipts,
    ),
    exactReplay: acceptIdempotentInvocation(
      definition,
      exactReplay,
      securityContext,
      receipts,
    ),
    conflictingReplay: acceptIdempotentInvocation(
      definition,
      conflictingReplay,
      securityContext,
      receipts,
    ),
    sameKeyDifferentPrincipal: acceptIdempotentInvocation(
      definition,
      first,
      anotherPrincipal,
      receipts,
    ),
    receiptCount: receipts.size,
  };
}

export function approvalWalkthrough(
  definition: CapabilityDefinition,
): Record<string, unknown> {
  if (definition.approval === "none") {
    return {
      mode: "none",
      authorizationStillRequired: true,
    };
  }
  if (definition.approval === "manages-approval") {
    return {
      mode: "manages-approval",
      resource: "Publishing Approval",
      actions: ["request", "observe", "decide", "revoke"],
      decisionKinds: ["human", "eligible-policy"],
      sameDurableResource: true,
    };
  }
  return {
    mode: "required-before-effect",
    requiredInput: {
      approvalRef: "publishing-approval:approval_prototype_01",
    },
    missing: {
      code: APPROVAL_CONTRACT.errors.missing,
      message: "An exact durable Approval is required before this effect.",
      next: {
        capability: {
          id: "publishing_approvals.request",
          version: 1,
        },
        prefill: {
          subjectRef: "publishing-plan-revision:prototype-01",
          action: "publish-now",
          targetRefs: ["target:prototype-01"],
        },
      },
    },
    invalid: {
      code: APPROVAL_CONTRACT.errors.invalid,
      reasonExamples: [
        "wrong-revision-or-digest",
        "wrong-action-or-target-set",
        "expired-revoked-superseded-or-consumed",
        "authorization-no-longer-valid",
      ],
    },
    authorizationStillRequired: true,
    providerEffectBeforeGate: false,
  };
}

export function sampleInvocation(
  definition: CapabilityDefinition,
): CanonicalInvocation {
  return {
    capability: { id: definition.id, version: definition.version },
    requestId: "req_prototype_01",
    ...(definition.idempotency === "key-required"
      ? { idempotencyKey: `idem_${definition.id.replaceAll(".", "_")}_01` }
      : {}),
    input: {
      $schema: definition.inputSchema,
      example: "schema-owned input fields appear here",
    },
  };
}

export function sampleSecurityContext(): SecurityContext {
  return {
    workspaceId: "workspace_demo",
    principalRef: "agent-principal:content-operator",
    principalKind: "agent",
  };
}

export function sampleDispatch(
  definition: CapabilityDefinition,
): DispatchInvocation {
  return {
    invocation: sampleInvocation(definition),
    securityContext: sampleSecurityContext(),
  };
}

export function sampleResult(
  definition: CapabilityDefinition,
): CapabilityResult {
  const capability = { id: definition.id, version: definition.version };
  if (definition.execution === "immediate") {
    const result =
      definition.observation === "cursor-page"
        ? {
            $schema: definition.outputSchema,
            items: [{ ref: `${definition.domain}:prototype-01` }],
            nextCursor: "cursor:opaque-prototype-next",
          }
        : definition.observation === "event-page"
          ? {
              $schema: definition.outputSchema,
              events: [
                {
                  resourceRef: `${definition.domain}:prototype-01`,
                  sequence: 7,
                  type: "prototype.state_changed",
                },
              ],
              nextSequence: 7,
              latestSequence: 9,
            }
          : {
              $schema: definition.outputSchema,
              example: "schema-owned result fields appear here",
            };
    return {
      capability,
      requestId: "req_prototype_01",
      status: "completed",
      result,
    };
  }

  const inspectDefinition = definitionByRef(definition.inspectCapability!);
  const eventDefinition = definition.eventCapability
    ? definitionByRef(definition.eventCapability)
    : undefined;
  return {
    capability,
    requestId: "req_prototype_01",
    status: "accepted",
    result: {
      $schema: definition.outputSchema,
      state: "queued",
      resourceRefs: [`${definition.returnsResource}:prototype-01`],
    },
    continuation: {
      resourceRefs: [`${definition.returnsResource}:prototype-01`],
      inspect: {
        capability: {
          id: inspectDefinition.id,
          version: inspectDefinition.version,
        },
        input: { resourceRef: `${definition.returnsResource}:prototype-01` },
      },
      ...(eventDefinition
        ? {
            events: {
              capability: {
                id: eventDefinition.id,
                version: eventDefinition.version,
              },
              afterSequence: 0,
            },
          }
        : {}),
    },
  };
}

export function sampleError(
  definition: CapabilityDefinition,
): CapabilityError {
  const capability = { id: definition.id, version: definition.version };
  if (definition.approval === "required-before-effect") {
    return {
      capability,
      requestId: "req_prototype_01",
      error: {
        code: "APPROVAL_REQUIRED",
        category: "precondition-failed",
        message: "A valid durable Approval is required for this action.",
        retryable: false,
        details: {
          subjectRef: "publishing-plan-revision:prototype-01",
          action: "publish-now",
          targetRefs: ["target:prototype-01"],
        },
        remediation: {
          capability: { id: "publishing_approvals.request", version: 1 },
          prefill: {
            subjectRef: "publishing-plan-revision:prototype-01",
            action: "publish-now",
            targetRefs: ["target:prototype-01"],
          },
        },
        traceRef: "trace:prototype-01",
      },
    };
  }
  if (definition.idempotency === "key-required") {
    return {
      capability,
      requestId: "req_prototype_01",
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        category: "conflict",
        message: "The idempotency key was already used with different input.",
        retryable: false,
        details: {
          conflictingFields: ["input"],
        },
        traceRef: "trace:prototype-01",
      },
    };
  }
  return {
    capability,
    requestId: "req_prototype_01",
    error: {
      code: "VALIDATION_FAILED",
      category: "invalid-request",
      message: "The input does not satisfy the capability contract.",
      retryable: false,
      details: {
        fieldViolations: [
          {
            path: "/example",
            code: "INVALID_VALUE",
            message: "Use a value allowed by the referenced input schema.",
          },
        ],
      },
      traceRef: "trace:prototype-01",
    },
  };
}

export function mapInvocation(
  definition: CapabilityDefinition,
  transport: Transport,
): TransportMapping {
  const invocation = sampleInvocation(definition);
  const canonicalCapability = invocation.capability;
  const canonicalResult = sampleResult(definition);
  const canonicalError = sampleError(definition);
  const errorMapping = ERROR_TRANSPORT_MAP[canonicalError.error.category];

  switch (transport) {
    case "cli":
      return {
        transport,
        canonicalCapability,
        adapter: {
          argv: [
            "node-banana",
            "call",
            `${definition.id}@${definition.version}`,
            "--input",
            "<json>",
          ],
          authentication: "local profile Agent Key resolves Security Context",
          input: invocation.input,
          normalizedDispatch: sampleDispatch(definition),
          stdout: canonicalResult,
          failure: {
            exitCode: errorMapping.cliExitCode,
            stderr: canonicalError,
          },
        },
      };
    case "mcp":
      return {
        transport,
        canonicalCapability,
        adapter: {
          toolName: `nb__${definition.id.replaceAll(".", "__")}__v${definition.version}`,
          authentication:
            "stdio server session resolves one Agent Security Context",
          arguments: {
            meta: {
              requestId: invocation.requestId,
              idempotencyKey: invocation.idempotencyKey,
            },
            input: invocation.input,
          },
          normalizedDispatch: sampleDispatch(definition),
          result: {
            structuredContent: canonicalResult,
          },
          failure: {
            isError: errorMapping.mcpError,
            structuredContent: canonicalError,
          },
        },
      };
    case "rest":
      return {
        transport,
        canonicalCapability,
        adapter: {
          method: "POST",
          path: `/api/capabilities/${definition.id}/versions/${definition.version}/invoke`,
          authentication:
            "Authorization header resolves Agent or Human Security Context",
          headers: {
            "X-Request-Id": invocation.requestId,
            "Idempotency-Key":
              definition.idempotency === "key-required"
                ? invocation.idempotencyKey
                : "(omitted)",
          },
          body: invocation.input,
          normalizedDispatch: sampleDispatch(definition),
          response: canonicalResult,
          failure: {
            status: errorMapping.httpStatus,
            body: canonicalError,
          },
        },
      };
    case "cockpit":
      return {
        transport,
        canonicalCapability,
        adapter: {
          sdkMethod: "capabilities.invoke",
          authentication:
            "signed-in human session resolves Human Security Context",
          arguments: invocation,
          normalizedDispatch: sampleDispatch(definition),
          viewModel: canonicalResult,
          failureViewModel: canonicalError,
        },
      };
  }
}

export function validateCatalog(
  definitions: CapabilityDefinition[] = CANDIDATE_CAPABILITIES,
): string[] {
  const errors: string[] = [];
  const identities = new Set<string>();

  if (definitions.length !== MINIMUM_V1_CAPABILITY_COUNT) {
    errors.push(
      `minimum v1 count drifted: expected ` +
        `${MINIMUM_V1_CAPABILITY_COUNT}, received ${definitions.length}`,
    );
  }

  for (const definition of definitions) {
    const identity = `${definition.id}@${definition.version}`;
    if (identities.has(identity)) errors.push(`duplicate identity: ${identity}`);
    identities.add(identity);

    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(definition.id)) {
      errors.push(`${identity}: ID is not a dotted lower-snake-case name`);
    }
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      errors.push(`${identity}: version must be a positive integer`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(definition.contractDigest)) {
      errors.push(`${identity}: malformed contract digest`);
    }
    const recomputedDigest = contractDigest(definition);
    if (recomputedDigest !== definition.contractDigest) {
      errors.push(`${identity}: immutable contract digest drifted`);
    }
    if (
      definition.lifecycle.status === "retired" &&
      definition.lifecycle.recommended
    ) {
      errors.push(`${identity}: retired version cannot be recommended`);
    }
    if (definition.effect.mutation === "none") {
      if (definition.idempotency !== "retry-safe") {
        errors.push(`${identity}: query must be retry-safe`);
      }
      if (definition.execution !== "immediate") {
        errors.push(`${identity}: query cannot own asynchronous execution`);
      }
      if (definition.approval === "required-before-effect") {
        errors.push(`${identity}: query cannot require approval`);
      }
      if (
        definition.effect.visibility !== "private" ||
        definition.effect.timing !== "immediate" ||
        definition.effect.maySpendProviderBudget
      ) {
        errors.push(`${identity}: query has contradictory effect dimensions`);
      }
      if (definition.observation === "not-applicable") {
        errors.push(`${identity}: query must declare an observation contract`);
      }
    } else if (definition.idempotency === "retry-safe") {
      errors.push(`${identity}: command must declare retry semantics`);
    }
    if (
      definition.effect.mutation !== "none" &&
      definition.observation !== "not-applicable"
    ) {
      errors.push(`${identity}: command cannot declare query observation`);
    }
    if (
      definition.effect.mutation === "external-system" &&
      definition.idempotency !== "key-required"
    ) {
      errors.push(`${identity}: external side effect must require a key`);
    }
    if (
      definition.approval === "required-before-effect" &&
      definition.effect.mutation !== "external-system"
    ) {
      errors.push(`${identity}: approval gate must protect an external effect`);
    }
    if (
      definition.effect.visibility === "publicly-visible" &&
      definition.effect.mutation !== "external-system"
    ) {
      errors.push(`${identity}: public visibility requires external reach`);
    }
    if (definition.execution === "durable-async") {
      if (!definition.returnsResource) {
        errors.push(`${identity}: async capability must return a domain resource`);
      }
      if (!definition.inspectCapability) {
        errors.push(`${identity}: async capability needs an inspect capability`);
      } else {
        const inspect = definitions.find(
          (candidate) =>
            candidate.id === definition.inspectCapability!.id &&
            candidate.version === definition.inspectCapability!.version,
        );
        if (!inspect || inspect.effect.mutation !== "none") {
          errors.push(`${identity}: inspect capability must be a catalog query`);
        }
      }
      if (definition.eventCapability) {
        const events = definitions.find(
          (candidate) =>
            candidate.id === definition.eventCapability!.id &&
            candidate.version === definition.eventCapability!.version,
        );
        if (!events || events.effect.mutation !== "none") {
          errors.push(`${identity}: event capability must be a catalog query`);
        }
      }
    } else if (definition.inspectCapability || definition.eventCapability) {
      errors.push(`${identity}: immediate result cannot declare continuation`);
    }
    if (definition.principalKinds.length === 0) {
      errors.push(`${identity}: at least one Principal kind is required`);
    }
    const error = sampleError(definition);
    if (
      error.capability.id !== definition.id ||
      error.capability.version !== definition.version ||
      !error.error.code ||
      !error.error.traceRef
    ) {
      errors.push(`${identity}: malformed canonical error`);
    }
    for (const transport of TRANSPORTS) {
      const mapping = mapInvocation(definition, transport);
      if (
        mapping.canonicalCapability.id !== definition.id ||
        mapping.canonicalCapability.version !== definition.version
      ) {
        errors.push(`${identity}: ${transport} mapping drifted`);
      }
    }
  }

  const capabilityIds = new Set(
    definitions.map((definition) => `${definition.id}@${definition.version}`),
  );
  const agentCallable = definitions.filter((definition) =>
    definition.principalKinds.includes("agent"),
  ).length;
  const humanOnly = definitions.filter(
    (definition) =>
      definition.principalKinds.includes("human") &&
      !definition.principalKinds.includes("agent"),
  ).length;
  if (agentCallable !== 71 || humanOnly !== 22) {
    errors.push(
      `minimum v1 exposure drifted: expected 71 agent-callable and ` +
        `22 human-only, received ${agentCallable} and ${humanOnly}`,
    );
  }
  const recipeIds = new Set<string>();
  for (const recipe of CANDIDATE_RECIPES) {
    const identity = `${recipe.id}@${recipe.version}`;
    if (recipeIds.has(identity)) errors.push(`duplicate recipe: ${identity}`);
    recipeIds.add(identity);
    if (recipe.ownsDurableState !== false) {
      errors.push(`${identity}: Agent Recipe cannot own durable state`);
    }
    for (const step of recipe.steps) {
      const stepIdentity = `${step.capability.id}@${step.capability.version}`;
      if (!capabilityIds.has(stepIdentity)) {
        errors.push(
          `${identity}/${step.id}: unknown capability ${stepIdentity}`,
        );
      }
      for (const recovery of step.recovery ?? []) {
        const recoveryIdentity = `${recovery.id}@${recovery.version}`;
        if (!capabilityIds.has(recoveryIdentity)) {
          errors.push(
            `${identity}/${step.id}: unknown recovery capability ${recoveryIdentity}`,
          );
        }
      }
    }
  }

  return errors;
}

export function catalogSummary(
  definitions: CapabilityDefinition[] = CANDIDATE_CAPABILITIES,
) {
  const countBy = <K extends string>(
    getKey: (definition: CapabilityDefinition) => K,
  ) =>
    Object.fromEntries(
      definitions.reduce((counts, definition) => {
        const key = getKey(definition);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map<K, number>()),
    );

  return {
    definitions: definitions.length,
    recipes: CANDIDATE_RECIPES.length,
    recipeSteps: CANDIDATE_RECIPES.reduce(
      (count, recipe) => count + recipe.steps.length,
      0,
    ),
    domains: countBy((definition) => definition.domain),
    effects: {
      mutation: countBy((definition) => definition.effect.mutation),
      visibility: countBy((definition) => definition.effect.visibility),
      timing: countBy((definition) => definition.effect.timing),
      reversibility: countBy(
        (definition) => definition.effect.reversibility,
      ),
      maySpendProviderBudget: definitions.filter(
        (definition) => definition.effect.maySpendProviderBudget,
      ).length,
    },
    idempotency: countBy((definition) => definition.idempotency),
    execution: countBy((definition) => definition.execution),
    observation: countBy((definition) => definition.observation),
    lifecycle: countBy((definition) => definition.lifecycle.status),
    principalKinds: {
      humanCallable: definitions.filter((definition) =>
        definition.principalKinds.includes("human"),
      ).length,
      agentCallable: definitions.filter((definition) =>
        definition.principalKinds.includes("agent"),
      ).length,
      humanOnly: definitions.filter(
        (definition) =>
          definition.principalKinds.includes("human") &&
          !definition.principalKinds.includes("agent"),
      ).length,
    },
  };
}
