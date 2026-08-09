import type { PublishingPlanRevisionRecord } from "../publishing-plans/types";

export type PublishingApprovalAction = "publish";
export type PublishingApprovalDecision = "approved" | "denied";
export type PublishingApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "consumed"
  | "expired";

export interface PublishingApprovalValidationBinding {
  evidenceDigest: string;
  currentStateDigest: string;
  contextId: string;
  contextDigest: string;
  evaluatedAt: string;
  expiresAt: string;
  runtimePolicyIdentity: string;
  runtimePolicyContractDigest: string;
}

export interface PublishingApprovalDecisionPolicy {
  mode: "expires_at";
  expiresAt: Date;
}

export interface PublishingApprovalAuthorityGrantRecord {
  id: string;
  workspaceId: string;
  userId: string;
  subjectRoleAtIssue: "owner" | "admin";
  channelId: string;
  action: PublishingApprovalAction;
  issuedByUserId: string;
  issuedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
}

export interface PublishingApprovalAuthoritySession {
  schema: "publishing-approval-authority-session/v1";
  id: string;
  workspaceId: string;
  userId: string;
  /** Current Workspace role; membership is necessary but never sufficient. */
  subjectRole: "owner" | "admin";
  action: PublishingApprovalAction;
  channelIds: string[];
  grants: Array<{ channelId: string; grantId: string }>;
  evidenceRef: string;
  evidenceDigest: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface PublishingApprovalValidationSession {
  schema: "publishing-approval-validation-session/v1";
  id: string;
  workspaceId: string;
  planRevisionId: string;
  planRevisionDigest: string;
  targetIds: string[];
  binding: PublishingApprovalValidationBinding;
  issuedAt: Date;
  expiresAt: Date;
}

export interface PublishingApprovalDecisionRecord {
  id: string;
  workspaceId: string;
  approvalRequestId: string;
  decision: PublishingApprovalDecision;
  decidedByUserId: string;
  authorityEvidenceRef: string;
  authorityEvidenceDigest: string;
  authorityGrants: Array<{ channelId: string; grantId: string }>;
  inspectionDigest: string;
  decidedAt: Date;
  /** Approval satisfies only the human gate; release authorization is separate. */
  authorizesExecution: false;
}

export interface PublishingApprovalRequestRecord {
  id: string;
  workspaceId: string;
  planId: string;
  planRevisionId: string;
  planRevision: number;
  planRevisionDigest: string;
  action: PublishingApprovalAction;
  targetIds: string[];
  channelIds: string[];
  artifactIds: string[];
  /** Exact manual-retry recovery claim; null for an initial release Approval. */
  retrySource: { deliveryId: string; evidenceDigest: string } | null;
  requestingPrincipalId: string;
  requestingKeyId: string;
  requestAuthorization: {
    capability: "publishing_approvals.request@1";
    contractDigest: string;
    evidenceRef: string;
    resources: { channelIds: string[]; artifactIds: string[] };
  };
  validation: PublishingApprovalValidationBinding;
  decisionPolicy: PublishingApprovalDecisionPolicy;
  createdAt: Date;
  decision: PublishingApprovalDecisionRecord | null;
  consumption: PublishingApprovalConsumptionRecord | null;
  /** Transport acceptance never represents a human decision. */
  authorizesExecution: false;
}

/** Authoritative terminal Delivery projection used atomically when creating retry Approval. */
export interface PublishingApprovalRetrySourceRecord {
  workspaceId: string;
  deliveryId: string;
  evidenceDigest: string;
  desiredState: "publish";
  state: "failed_transient" | "failed_terminal";
  failureClass: "transient" | "terminal";
  retryable: boolean;
  planId: string;
  planRevisionId: string;
  planRevision: number;
  planRevisionDigest: string;
  targetId: string;
  channelId: string;
  artifactIds: string[];
  requestingPrincipalId: string;
}

export interface PublishingApprovalDto
  extends Omit<
    PublishingApprovalRequestRecord,
    "decisionPolicy" | "createdAt" | "decision" | "consumption"
  > {
  status: PublishingApprovalStatus;
  /** Opaque digest of the exact inspected request and current decision state. */
  inspectionDigest: string;
  decisionPolicy: { mode: "expires_at"; expiresAt: string };
  createdAt: string;
  decision: (Omit<PublishingApprovalDecisionRecord, "decidedAt"> & {
    decidedAt: string;
  }) | null;
  consumption: (Omit<PublishingApprovalConsumptionRecord, "consumedAt"> & {
    consumedAt: string;
  }) | null;
}

/** Agent-safe projection: no human IDs, grant refs, keys, or auth evidence. */
export interface PublishingApprovalAgentDto {
  id: string;
  workspaceId: string;
  planId: string;
  planRevisionId: string;
  planRevision: number;
  planRevisionDigest: string;
  action: PublishingApprovalAction;
  targetIds: string[];
  channelIds: string[];
  artifactIds: string[];
  retrySource: { deliveryId: string; evidenceDigest: string } | null;
  validation: PublishingApprovalValidationBinding;
  decisionPolicy: { mode: "expires_at"; expiresAt: string };
  status: PublishingApprovalStatus;
  decision: {
    approvalRef: string;
    decision: PublishingApprovalDecision;
    decidedAt: string;
    authorizesExecution: false;
  } | null;
  consumption: { consumed: true; consumedAt: string } | null;
  createdAt: string;
  authorizesExecution: false;
}

export interface PublishingApprovalPresentationTarget {
  targetId: string;
  channel: {
    id: string;
    platform: "linkedin";
    authorKind: "person" | "organization";
    /** Live safe label when still available; immutable evidence remains authoritative. */
    displayName: string | null;
    historical: boolean;
  };
  content: {
    artifactId: string;
    digest: string;
    mediaType: "text/plain; charset=utf-8";
    text: string;
  };
  media: Array<{
    artifactId: string;
    digest: string;
    mediaType: "image/jpeg" | "image/png" | "image/gif";
    previewUrl: string;
  }>;
  settings: { type: "person" | "organization" };
  timing: { kind: "now" | "scheduled"; publishAt: string };
  targetEvidenceDigest: string;
  /** Closed, secret-safe facts copied from the immutable successful validation. */
  validation: {
    evaluatedAt: string;
    expiresAt: string;
    channelSnapshot: {
      id: string;
      platform: "linkedin";
      authorKind: "person" | "organization";
      snapshotDigest: string;
      capabilityVersion: string;
    };
    artifacts: {
      content: {
        id: string;
        digest: string;
        snapshotDigest: string;
        kind: "text";
        mediaType: "text/plain; charset=utf-8";
        sizeBytes: number;
      };
      media: Array<{
        id: string;
        digest: string;
        snapshotDigest: string;
        kind: "image";
        mediaType: "image/jpeg" | "image/png" | "image/gif";
        sizeBytes: number;
      }>;
    };
    settingsDigest: string;
    publishAt: string;
    policy: {
      identity: "publishing-runtime-policy/default@1";
      contractDigest: string;
      evidenceDigest: string;
      stateDigest: string;
      outcome: "allowed";
      blockerCodes: [];
    };
  };
  costContext: {
    /** Informational; release independently rechecks current spend authorization. */
    authoritative: false;
    currency: "USD";
    estimatedAmount: string;
    pricingSnapshotIds: string[];
    computedAt: string;
  } | null;
}

export interface PublishingApprovalPresentation {
  schema: "publishing-approval-presentation/v1";
  approval: PublishingApprovalDto;
  targets: PublishingApprovalPresentationTarget[];
  decisionEligibility: {
    eligible: boolean;
    blockerCodes: Array<
      | "REQUEST_FINAL"
      | "REQUEST_EXPIRED"
      | "REVISION_SUPERSEDED"
      | "VALIDATION_STALE"
      | "AUTHORITY_MISSING"
    >;
  };
  authorityCoverage: Array<{
    targetId: string;
    channelId: string;
    action: PublishingApprovalAction;
    covered: boolean;
    grantRefs: string[];
  }>;
}

/** Returns only an immutable revision that is still the Plan's current head. */
export interface PublishingApprovalRevisionPort {
  getRevision(input: {
    workspaceId: string;
    revisionId: string;
  }): Promise<PublishingPlanRevisionRecord | null>;
  getCurrentRevision(input: {
    workspaceId: string;
    revisionId: string;
  }): Promise<PublishingPlanRevisionRecord | null>;
}

export interface PublishingApprovalValidationPort {
  verifyCurrent(input: {
    workspaceId: string;
    revision: PublishingPlanRevisionRecord;
    targetIds: string[];
    evaluatedAt: Date;
    /** Delivery recovery revalidates all evidence while allowing already-due timing. */
    mode?: "release" | "retry_due";
  }): Promise<PublishingApprovalValidationSession | null>;
}

export interface PublishingApprovalAuthorityPort {
  checkCurrent(input: {
    workspaceId: string;
    userId: string;
    action: PublishingApprovalAction;
    channelIds: string[];
    evaluatedAt: Date;
  }): Promise<PublishingApprovalAuthoritySession | null>;
}

export interface PublishingApprovalPresentationPort {
  present(input: {
    approval: PublishingApprovalRequestRecord;
    revision: PublishingPlanRevisionRecord;
    actorUserId: string;
    presentedAt: Date;
  }): Promise<PublishingApprovalPresentationTarget[]>;
}

export interface PublishingApprovalAuthorityAdminPort {
  listGrants(input: {
    workspaceId: string;
    userId?: string;
    channelId?: string;
  }): Promise<PublishingApprovalAuthorityGrantRecord[]>;
  issueGrantIdempotent(input: {
    workspaceId: string;
    userId: string;
    channelId: string;
    action: "publish";
    issuedByUserId: string;
    expiresAt: Date | null;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<PublishingApprovalAuthorityAdminMutationResult>;
  revokeGrantIdempotent(input: {
    workspaceId: string;
    grantId: string;
    revokedByUserId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<PublishingApprovalAuthorityAdminMutationResult>;
}

export type PublishingApprovalAuthorityAdminMutationResult =
  | {
      kind: "created" | "replayed";
      grant: PublishingApprovalAuthorityGrantRecord;
    }
  | { kind: "conflict" | "forbidden" | "not_found" | "unavailable" };

export interface PublishingApprovalMutationReceiptRecord {
  workspaceId: string;
  actorKind: "agent" | "human";
  actorId: string;
  capability:
    | "publishing_approvals.request@1"
    | "publishing_approvals.decide@1";
  idempotencyKey: string;
  requestFingerprint: string;
  approvalRequestId: string;
  decisionId: string | null;
  createdAt: Date;
}

export type PublishingApprovalReceiptResult =
  | { kind: "absent" }
  | { kind: "conflict" }
  | {
      kind: "replayed";
      approvalRequestId: string;
      decisionId: string | null;
    };

export type PublishingApprovalCreateResult =
  | { kind: "created" | "replayed"; request: PublishingApprovalRequestRecord }
  | { kind: "conflict" }
  | { kind: "stale_revision" }
  | { kind: "stale_validation" }
  | { kind: "unavailable" };

export type PublishingApprovalDecideResult =
  | { kind: "decided" | "replayed"; request: PublishingApprovalRequestRecord }
  | { kind: "conflict" }
  | { kind: "stale_view" }
  | { kind: "final" }
  | { kind: "expired" }
  | { kind: "stale_revision" }
  | { kind: "stale_validation" }
  | { kind: "authority_stale" }
  | { kind: "unavailable" };

export interface PublishingApprovalListFilters {
  status?: PublishingApprovalStatus;
  planRevisionId?: string;
  requestingPrincipalId?: string;
  authorizedChannelIds?: string[];
  authorizedArtifactIds?: string[];
}

export interface PublishingApprovalListPosition {
  createdAt: Date;
  id: string;
}

export interface PublishingApprovalCursorCodec {
  seal(input: {
    workspaceId: string;
    actorId: string;
    filterDigest: string;
    position: PublishingApprovalListPosition;
  }): string;
  open(input: {
    cursor: string;
    workspaceId: string;
    actorId: string;
    filterDigest: string;
  }): PublishingApprovalListPosition;
}

export interface PublishingApprovalRepository {
  readMutationReceipt(input: {
    workspaceId: string;
    actorKind: "agent" | "human";
    actorId: string;
    capability:
      | "publishing_approvals.request@1"
      | "publishing_approvals.decide@1";
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<PublishingApprovalReceiptResult>;
  createRequest(input: {
    request: PublishingApprovalRequestRecord;
    receipt: PublishingApprovalMutationReceiptRecord;
    validationSession: PublishingApprovalValidationSession;
  }): Promise<PublishingApprovalCreateResult>;
  getRequest(input: {
    workspaceId: string;
    approvalRequestId: string;
    requestingPrincipalId?: string;
  }): Promise<PublishingApprovalRequestRecord | null>;
  listRequests(input: {
    workspaceId: string;
    filters: PublishingApprovalListFilters;
    evaluatedAt: Date;
    before?: PublishingApprovalListPosition;
    limit: number;
  }): Promise<PublishingApprovalRequestRecord[]>;
  decide(input: {
    decision: PublishingApprovalDecisionRecord;
    expectedInspectionDigest: string;
    receipt: PublishingApprovalMutationReceiptRecord;
    authoritySession: PublishingApprovalAuthoritySession;
    validationSession: PublishingApprovalValidationSession;
  }): Promise<PublishingApprovalDecideResult>;
}

/** #167 consumes one approved decision and supplies fresh publish authorization. */
export interface PublishingApprovalConsumptionRecord {
  id: string;
  workspaceId: string;
  approvalRequestId: string;
  decisionId: string;
  consumingPrincipalId: string;
  consumingKeyId: string;
  capability: "publishing_plan_revisions.release@1";
  authorizationContractDigest: string;
  authorizationEvidenceRef: string;
  authorizedResources: { channelIds: string[]; artifactIds: string[] };
  authorizationIssuedAt: Date;
  authorizationExpiresAt: Date;
  consumedAt: Date;
}

/** #167 atomically writes this record; its unique decision ID is single-use. */
export interface PublishingApprovalConsumptionPort {
  consume(input: {
    consumption: PublishingApprovalConsumptionRecord;
  }): Promise<"consumed" | "already_consumed" | "invalid" | "authorization_stale">;
}

export interface PublishingApprovalClock {
  now(): Date;
}
