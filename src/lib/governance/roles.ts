import type {
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

export function governanceCapabilityForApplicationCapability(
  capabilityName: string,
): GovernanceCapability | null {
  if (capabilityName === "governance.snapshot.get") return "governance.view";
  return (GOVERNANCE_CAPABILITIES as readonly string[]).includes(capabilityName)
    ? capabilityName as GovernanceCapability
    : null;
}
