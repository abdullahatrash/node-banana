import type {
  ApplicationCapabilityReference,
  BuiltInWorkspaceRole,
  GovernanceCapability,
} from "./types";
import { GOVERNANCE_CAPABILITIES } from "./types";

const ALL_ADMINISTRATIVE = [
  "governance.view",
  "members.invite",
  "members.manage",
  "roles.manage",
  "portfolios.manage",
  "reviews.create",
  "approval_policies.manage",
  "audit.view",
  "audit.export",
  "regions.manage",
  "retention.manage",
  "safety.decide",
  "safety.appeal",
  "bulk.preview",
  "bulk.execute",
  "imports.manage",
  "exports.manage",
] as const satisfies readonly GovernanceCapability[];

/** Roles are discoverable capability bundles, never Approval, credential, or spend authority. */
export const BUILT_IN_ROLE_CAPABILITIES = Object.freeze({
  owner: Object.freeze([
    ...ALL_ADMINISTRATIVE,
    "workspace.transfer_ownership",
    "workspace.close",
  ]),
  admin: Object.freeze(ALL_ADMINISTRATIVE),
  billing_admin: Object.freeze([
    "governance.view",
    "audit.view",
    "audit.export",
    "exports.manage",
  ]),
  creator: Object.freeze([
    "governance.view",
    "reviews.decide_content",
    "safety.appeal",
    "bulk.preview",
  ]),
  approver: Object.freeze([
    "governance.view",
    "reviews.decide_content",
    "audit.view",
    "safety.appeal",
  ]),
  analyst: Object.freeze([
    "governance.view",
    "audit.view",
    "exports.manage",
  ]),
  viewer: Object.freeze(["governance.view"]),
} satisfies Record<BuiltInWorkspaceRole, readonly GovernanceCapability[]>);

export function legacyRoleBinding(
  role: "owner" | "admin" | "member",
): BuiltInWorkspaceRole {
  return role === "member" ? "creator" : role;
}

export const RESERVED_ROLE_CAPABILITIES = new Set<GovernanceCapability>([
  "reviews.decide_publishing",
  "workspace.transfer_ownership",
  "workspace.close",
]);

function ref(name: string, version = 1): ApplicationCapabilityReference {
  return Object.freeze({ name, version });
}

const CORE_READ = [
  ref("capabilities.list"),
  ref("capabilities.get"),
  ref("agents.current.get"),
  ref("artifacts.get"),
  ref("artifacts.list"),
  ref("artifact_downloads.create"),
  ref("workflow_operations.list"),
  ref("workflow_operations.get"),
  ref("workflow_versions.get", 2),
  ref("workflow_runs.get", 2),
  ref("workflow_run_events.list", 2),
  ref("workflow_step_attempts.list", 2),
  ref("workflow_run_artifacts.get", 2),
  ref("publishing_plan_revisions.get", 2),
  ref("publishing_plan_revisions.list"),
  ref("publishing_approvals.get", 2),
  ref("publishing_approvals.list"),
  ref("publishing_deliveries.get", 2),
  ref("publishing_deliveries.list", 2),
  ref("publishing_delivery_events.list", 2),
] as const;

const SAFE_CREATION = [
  ref("artifacts.import"),
  ref("artifact_uploads.begin"),
  ref("artifact_uploads.complete"),
  ref("workflows.create"),
  ref("workflow_versions.validate"),
  ref("workflow_versions.create"),
  ref("publishing_plan_revisions.validate"),
  ref("publishing_plan_revisions.create"),
] as const;

const FINANCIAL_READ = [
  ref("usage_records.get"),
  ref("usage_records.list"),
  ref("cost_valuations.get"),
  ref("cost_valuations.list"),
  ref("usage_summaries.get"),
  ref("usage_events.list"),
  ref("budget_status.get"),
  ref("budget_policies.list"),
  ref("pricing_overrides.list"),
  ref("spend_controls.get", 2),
  ref("quota_policies.list"),
] as const;

const ANALYTICS_READ = [
  ref("operational_metrics.list"),
  ref("observability_retention.get"),
  ref("support_bundle_audit.list"),
] as const;

/**
 * Product-wide role bundles are exact versioned references. They intentionally
 * exclude credential mutation, Agent/key creation, Approval decisions,
 * publishing release, provider-spending runs, payouts, and refunds.
 */
export const BUILT_IN_ROLE_APPLICATION_CAPABILITIES = Object.freeze({
  owner: Object.freeze([...CORE_READ, ...SAFE_CREATION, ...FINANCIAL_READ, ...ANALYTICS_READ]),
  admin: Object.freeze([...CORE_READ, ...SAFE_CREATION, ...FINANCIAL_READ, ...ANALYTICS_READ]),
  billing_admin: Object.freeze([...FINANCIAL_READ, ref("credentials.audit.list")]),
  creator: Object.freeze([...CORE_READ, ...SAFE_CREATION]),
  approver: Object.freeze([...CORE_READ]),
  analyst: Object.freeze([...CORE_READ, ...FINANCIAL_READ, ...ANALYTICS_READ]),
  viewer: Object.freeze([...CORE_READ]),
} satisfies Record<BuiltInWorkspaceRole, readonly ApplicationCapabilityReference[]>);

export const CUSTOM_ROLE_APPLICATION_CAPABILITIES = Object.freeze(
  [...new Map(
    Object.values(BUILT_IN_ROLE_APPLICATION_CAPABILITIES)
      .flat()
      .map((capability) => [`${capability.name}@${capability.version}`, capability]),
  ).values()].sort((left, right) => left.name.localeCompare(right.name) || left.version - right.version),
);

export function applicationCapabilityKey(capability: ApplicationCapabilityReference): string {
  return `${capability.name}@${capability.version}`;
}

export function governanceCapabilityForApplicationCapability(
  capabilityName: string,
): GovernanceCapability | null {
  if (capabilityName === "governance.snapshot.get") return "governance.view";
  return (GOVERNANCE_CAPABILITIES as readonly string[]).includes(capabilityName)
    ? capabilityName as GovernanceCapability
    : null;
}
