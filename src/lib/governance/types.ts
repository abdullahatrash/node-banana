export const GOVERNANCE_RESOURCE_KINDS = [
  "custom_role",
  "member_role_assignment",
  "invitation_binding",
  "portfolio",
  "portfolio_assignment",
  "review_guest_grant",
  "review_guest_session",
  "approval_policy",
  "approval_request",
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
  "membership_projection",
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

/** Exact stable Application Capability reference carried by a role revision. */
export interface ApplicationCapabilityReference {
  name: string;
  version: number;
}

export interface CustomRoleRevision {
  schema: "custom-role-revision/v1";
  revision: number;
  name: string;
  description: string;
  capabilities: GovernanceCapability[];
  applicationCapabilities: ApplicationCapabilityReference[];
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
  /** Null only for internal worker receipts that cannot deliver human secrets. */
  actorIdentity?: string | null;
  /** Digest of server-validated authentication context; never a raw session token. */
  authContextDigest?: string | null;
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
  canonicalEffects?: GovernanceCanonicalEffect[];
  secretDelivery?: GovernanceSecretDelivery;
}

export interface GovernanceSecretDelivery {
  workspaceId: string;
  capability: string;
  idempotencyKey: string;
  requestDigest: string;
  actorIdentity: string;
  authContextDigest: string;
  encryptedPayload: string;
  expiresAt: Date;
  createdAt: Date;
}

export type GovernanceCanonicalEffect =
  | {
      type: "membership_upsert";
      workspaceId: string;
      userId: string;
      role: "admin" | "member";
      occurredAt: Date;
    }
  | {
      type: "membership_remove";
      workspaceId: string;
      userId: string;
      occurredAt: Date;
    }
  | {
      type: "membership_role_update";
      workspaceId: string;
      userId: string;
      role: "admin" | "member";
      occurredAt: Date;
    }
  | {
      type: "ownership_transfer";
      workspaceId: string;
      currentOwnerUserId: string;
      newOwnerUserId: string;
      occurredAt: Date;
    }
  | {
      type: "workspace_close";
      workspaceId: string;
      currentOwnerUserId: string;
      occurredAt: Date;
    };

export type GovernanceCommitResult =
  | { type: "committed"; result: unknown }
  | { type: "replayed"; result: unknown }
  | { type: "conflict" };

export interface GovernanceRepository {
  findReceipt(input: {
    workspaceId: string;
    capability: string;
    idempotencyKey: string;
  }): Promise<GovernanceReceipt | null>;
  findSecretDelivery(input: {
    workspaceId: string;
    capability: string;
    idempotencyKey: string;
  }): Promise<GovernanceSecretDelivery | null>;
  purgeExpiredSecretDeliveries(input: {
    expiredBefore: Date;
    limit: number;
  }): Promise<number>;
  listClaimableMembershipProjections(input: {
    evaluatedAt: Date;
    limit: number;
  }): Promise<GovernanceResource[]>;
  listClaimableGovernanceJobs(input: {
    evaluatedAt: Date;
    after?: GovernanceJobCursor;
    limit: number;
  }): Promise<GovernanceResource[]>;
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

export interface GovernanceJobCursor {
  updatedAt: Date;
  workspaceId: string;
  kind: GovernanceResourceKind;
  id: string;
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

export interface ContentAcceptanceDecision {
  userId: string;
  roleId: string;
  decision: "approve" | "reject";
  stage: number;
  decidedAt: string;
}

export interface ContentAcceptanceProgress {
  schema: "content-acceptance-progress/v1";
  status: "pending" | "escalated" | "accepted" | "rejected" | "expired";
  requesterUserId: string;
  currentStage: number;
  decisions: ContentAcceptanceDecision[];
  deadlineAt: string;
  expiresAt: string;
  escalatedAt: string | null;
  authorizesExecution: false;
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
  /** Server-owned session/invocation identity, never supplied by command input. */
  authContextId: string;
  portfolioAssignmentId?: string;
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
    sourceWorkspaceId: string;
    targetWorkspaceId: string;
    userId: string;
    capability: string;
    targetKind: string;
    targetId: string;
    evaluatedAt: Date;
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

export interface GovernanceBulkPreviewPort {
  inspect(input: {
    sourceWorkspaceId: string;
    requestedByUserId: string;
    capability: string;
    targetWorkspaceId: string;
    targetKind: string;
    targetId: string;
    capabilityInput: Record<string, unknown>;
    quoteRef: string | null;
    evaluatedAt: Date;
  }): Promise<
    | { type: "ready"; authorizationEvidenceRef: string; authorizationContractDigest: string; targetStateDigest: string; entitlement: "exact_capability_granted"; quote:
      | { required: false; amount: "0"; currency: "USD"; source: "capability_effect_contract"; digest: string }
      | { required: true; ref: string; amount: string; currency: string; source: "workflow_run_budget_preview"; providerModels: Array<{ provider: string; model: string; pricePerAttempt: string; automaticAttempts: number; pricingSnapshotIds: string[] }>; quotedAt: string; expiresAt: string; targetStateDigest: string; digest: string }
    }
    | { type: "blocked"; code: string }
  >;
}

export interface GovernanceReviewPresentation {
  schema: "governance-review-presentation/v1";
  resourceKind: "render_proof" | "plan_revision";
  resourceId: string;
  revisionDigest: string;
  purpose: "inspect" | "comment" | "accept_content" | "approve_publishing" | "reject";
  presentedAt: string;
  expiresAt: string;
  renderProof: null | {
    artifactId: string;
    kind: "text" | "image";
    mediaType: string;
    sizeBytes: number;
    text: string | null;
    mediaAccess: null | { url: string; expiresAt: string; digest: string };
  };
  planRevision: null | {
    planRevisionId: string;
    planRevision: number;
    planRevisionDigest: string;
    targets: Array<{
      targetId: string;
      targetEvidenceDigest: string;
      channel: { id: string; platform: string; authorKind: string; displayName: string | null; historical: boolean };
      content: { artifactId: string; digest: string; text: string };
      media: Array<{ artifactId: string; digest: string; mediaType: string; sizeBytes: number; access: { url: string; expiresAt: string; digest: string } }>;
      settings: Record<string, unknown>;
      timing: { kind: "now" | "scheduled"; publishAt: string };
      validationExpiresAt: string;
    }>;
  };
  presentationDigest: string;
}

export interface GovernanceReviewPresentationPort {
  present(input: {
    workspaceId: string;
    grantId: string;
    sessionId: string;
    purpose: GovernanceReviewPresentation["purpose"];
    resourceKind: GovernanceReviewPresentation["resourceKind"];
    resourceId: string;
    revisionDigest: string;
    approvalRequestId: string | null;
    sessionExpiresAt: Date;
    presentedAt: Date;
  }): Promise<GovernanceReviewPresentation | null>;
}
