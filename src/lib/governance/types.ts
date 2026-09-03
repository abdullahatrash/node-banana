export const GOVERNANCE_RESOURCE_KINDS = [
  "custom_role",
  "member_role_assignment",
  "invitation_binding",
  "portfolio",
  "portfolio_assignment",
  "review_guest_grant",
  "review_guest_session",
  "approval_policy",
  "step_up_challenge",
  "step_up_session",
  "audit_export",
  "workspace_export",
  "workspace_import",
  "data_region_policy",
  "retention_policy",
  "retention_hold",
  "deletion_receipt",
  "tombstone",
  "safety_decision",
  "safety_appeal",
  "bulk_operation",
  "workspace_closure",
] as const;

export type GovernanceResourceKind = (typeof GOVERNANCE_RESOURCE_KINDS)[number];

export const BUILT_IN_WORKSPACE_ROLES = [
  "owner",
  "admin",
  "billing_admin",
  "creator",
  "approver",
  "analyst",
  "viewer",
] as const;

export type BuiltInWorkspaceRole = (typeof BUILT_IN_WORKSPACE_ROLES)[number];

export const GOVERNANCE_CAPABILITIES = [
  "governance.view",
  "members.invite",
  "members.manage",
  "roles.manage",
  "portfolios.manage",
  "reviews.create",
  "reviews.decide_content",
  "reviews.decide_publishing",
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
  "workspace.transfer_ownership",
  "workspace.close",
] as const;

export type GovernanceCapability = (typeof GOVERNANCE_CAPABILITIES)[number];

export interface CustomRoleRevision {
  schema: "custom-role-revision/v1";
  revision: number;
  name: string;
  description: string;
  capabilities: GovernanceCapability[];
  createdByUserId: string;
  createdAt: string;
}

export type WorkspaceRoleBinding =
  | { kind: "built_in"; role: BuiltInWorkspaceRole }
  | { kind: "custom"; roleId: string; roleRevision: number };

export interface GovernanceResource<T = Record<string, unknown>> {
  id: string;
  workspaceId: string;
  kind: GovernanceResourceKind;
  version: number;
  status: string;
  body: T;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceAuditEvent {
  schema: "workspace-audit-event/v1";
  id: string;
  workspaceId: string;
  sequence?: number;
  actor: { kind: "human" | "review_guest" | "system"; id: string | null };
  capability: string;
  action: string;
  resource: { kind: string; id: string } | null;
  outcome: "allowed" | "denied" | "accepted" | "completed" | "failed";
  redactedDetails: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}

export interface GovernanceReceipt {
  workspaceId: string;
  capability: string;
  idempotencyKey: string;
  requestDigest: string;
  result: unknown;
  createdAt: Date;
}

export interface GovernanceMutation {
  type: "create" | "update";
  resource: GovernanceResource;
  expectedVersion: number | null;
}

export interface GovernanceCommit {
  receipt: GovernanceReceipt;
  mutations: GovernanceMutation[];
  audit: GovernanceAuditEvent;
}

export type GovernanceCommitResult =
  | { type: "committed"; result: unknown }
  | { type: "replayed"; result: unknown }
  | { type: "conflict" };

export interface GovernanceRepository {
  getResource<T = Record<string, unknown>>(input: {
    workspaceId: string;
    kind: GovernanceResourceKind;
    id: string;
  }): Promise<GovernanceResource<T> | null>;
  listResources<T = Record<string, unknown>>(input: {
    workspaceId: string;
    kinds?: GovernanceResourceKind[];
    status?: string;
  }): Promise<GovernanceResource<T>[]>;
  listAudit(input: {
    workspaceId: string;
    afterSequence?: number;
    limit: number;
  }): Promise<GovernanceAuditEvent[]>;
  commit(input: GovernanceCommit): Promise<GovernanceCommitResult>;
}

export type ApprovalPolicyMode =
  | { kind: "single"; eligibleRoleIds: string[] }
  | { kind: "any_of"; eligibleRoleIds: string[] }
  | { kind: "sequential"; stages: Array<{ eligibleRoleIds: string[] }> }
  | { kind: "quorum"; eligibleRoleIds: string[]; required: number };

export interface ApprovalPolicyRevision {
  schema: "approval-policy-revision/v1";
  revision: number;
  purpose: "content_acceptance" | "publishing_approval";
  mode: ApprovalPolicyMode;
  separationOfDuty: boolean;
  deadlineSeconds: number;
  escalationRoleIds: string[];
  expiresAfterSeconds: number;
  createdByUserId: string;
  createdAt: string;
}

export const RETENTION_CLASSES = [
  "recoverable_draft",
  "workspace_media",
  "published_lineage",
  "consent_evidence",
  "security_evidence",
  "billing_tax_evidence",
  "provider_diagnostic",
  "support_attachment",
] as const;

export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export interface RetentionRule {
  retentionClass: RetentionClass;
  durationDays: number;
  recoverableDays: number;
  legalFloorDays: number;
}

export interface BulkOperationItem {
  id: string;
  targetWorkspaceId: string;
  targetKind: string;
  targetId: string;
  capability: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
  state:
    | "previewed"
    | "queued"
    | "running"
    | "succeeded"
    | "failed_known"
    | "outcome_unknown"
    | "cancelled";
  outcome: Record<string, unknown> | null;
}

export interface GovernanceActor {
  workspaceId: string;
  userId: string;
  legacyRole: "owner" | "admin" | "member";
}

export interface GovernanceSnapshot {
  workspaceId: string;
  actorCapabilities: GovernanceCapability[];
  resources: Partial<Record<GovernanceResourceKind, GovernanceResource[]>>;
  audit: GovernanceAuditEvent[];
}

export interface GovernanceMembershipPort {
  provisionAcceptedMembership(input: {
    workspaceId: string;
    userId: string;
    binding: WorkspaceRoleBinding;
  }): Promise<void>;
  removeMembership(input: {
    workspaceId: string;
    userId: string;
  }): Promise<"removed" | "not_found" | "owner_forbidden">;
  transferOwnership(input: {
    workspaceId: string;
    currentOwnerUserId: string;
    newOwnerUserId: string;
  }): Promise<"transferred" | "target_not_member" | "not_current_owner">;
  closeWorkspace(input: {
    workspaceId: string;
    currentOwnerUserId: string;
    closedAt: Date;
  }): Promise<"closed" | "not_current_owner">;
}

export interface GovernanceBulkAuthorizationPort {
  resolveActor(input: {
    workspaceId: string;
    userId: string;
  }): Promise<GovernanceActor | null>;
}

export interface GovernanceBulkCapabilityPort {
  execute(input: {
    actor: GovernanceActor;
    capability: string;
    capabilityInput: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<
    | { type: "succeeded"; output: unknown }
    | { type: "failed_known"; code: string }
    | { type: "outcome_unknown"; safeReason: string }
  >;
}
