import type { SocialPlatform } from "@/lib/db/schema";
import type { AgentResourceConstraints } from "@/types/agentAuthorization";

export type PublishingPlanBlockerCode =
  | "CHANNEL_INACCESSIBLE"
  | "ARTIFACT_MISSING"
  | "CONTENT_INVALID"
  | "MEDIA_INVALID"
  | "SETTINGS_INVALID"
  | "TIMING_INVALID"
  | "CONTEXT_EXPIRED"
  | "POLICY_BLOCKED";

export interface PublishingPlanDraftContext {
  contextId: string;
  contextDigest: string;
  issuedAt: string;
  expiresAt: string;
}

export type PublishingPlanDraftTiming =
  | { kind: "now" }
  | { kind: "scheduled"; scheduledAt: string };

export interface PublishingPlanDraftTarget {
  targetId: string;
  channelId: string;
  contentArtifactId: string;
  mediaArtifactIds: string[];
  settings: Record<string, unknown>;
  timing: PublishingPlanDraftTiming;
}

export interface PublishingPlanDraft {
  schema: "publishing-plan-draft/v1";
  planId: string;
  channelIds: string[];
  artifactIds: string[];
  targets: PublishingPlanDraftTarget[];
}

export interface NormalizedPublishingPlanTarget
  extends Omit<PublishingPlanDraftTarget, "settings" | "timing"> {
  settings: Record<string, unknown>;
  timing:
    | { kind: "now"; publishAt: string }
    | { kind: "scheduled"; publishAt: string };
}

export interface NormalizedPublishingPlanDefinition
  extends Omit<PublishingPlanDraft, "schema" | "targets"> {
  schema: "publishing-plan-revision-definition/v1";
  targets: NormalizedPublishingPlanTarget[];
}

export interface PublishingPlanArtifactSnapshot {
  id: string;
  workspaceId: string;
  digest: string;
  /** Stable digest of the canonical Artifact row/version, not read time. */
  versionDigest: string;
  kind: "text" | "image";
  mediaType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  /** Used only during validation and never copied into evidence or a revision. */
  inlineText: string | null;
  deletedAt: Date | null;
  observedAt: Date;
}

export interface PublishingPlanChannelSnapshot {
  id: string;
  workspaceId: string;
  platform: SocialPlatform;
  authorKind: "person" | "organization";
  /** Stable digest of the canonical Channel row/version, not read time. */
  versionDigest: string;
  state: "active" | "disconnected" | "revoked";
  capabilityVersion: string;
  maxContentLength: number;
  supportsImages: boolean;
  maxImages: number;
  observedAt: Date;
}

export interface PublishingPlanArtifactSnapshotPort {
  getCurrent(input: {
    workspaceId: string;
    artifactId: string;
  }): Promise<PublishingPlanArtifactSnapshot | null>;
}

export interface PublishingPlanChannelSnapshotPort {
  getCurrent(input: {
    workspaceId: string;
    channelId: string;
  }): Promise<PublishingPlanChannelSnapshot | null>;
}

export interface PublishingPlanValidationContextSnapshot {
  contextId: string;
  contextDigest: string;
  workspaceId: string;
  principalId: string;
  keyId: string;
  authorizationEvidenceRef: string;
  capability:
    | "publishing_plan_revisions.validate@1"
    | "publishing_plan_revisions.create@1";
  authorizationContractDigest: string;
  resources: {
    channelIds: string[];
    artifactIds: string[];
  };
  issuedAt: Date;
  expiresAt: Date;
}

/** Resolves a server-issued context; draft timestamps are claims, not trust. */
export interface PublishingPlanValidationContextPort {
  resolveCurrent(input: {
    workspaceId: string;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    capability:
      | "publishing_plan_revisions.validate@1"
      | "publishing_plan_revisions.create@1";
  }): Promise<PublishingPlanValidationContextSnapshot | null>;
}

export interface PublishingPlanRuntimePolicyDecision {
  allowed: boolean;
  reasonCodes: string[];
  evidenceDigest: string;
  stateDigest: string;
}

export interface PublishingPlanRuntimePolicyPort {
  readonly identity: string;
  readonly contractDigest: string;
  evaluate(input: {
    workspaceId: string;
    principalId: string;
    target: NormalizedPublishingPlanTarget;
    channel: PublishingPlanChannelSnapshot;
    content: PublishingPlanArtifactSnapshot;
    media: PublishingPlanArtifactSnapshot[];
    evaluatedAt: Date;
  }): Promise<PublishingPlanRuntimePolicyDecision>;
}

export interface PublishingPlanBlocker {
  code: PublishingPlanBlockerCode;
  targetId: string;
  path: string;
  message: string;
  details?: { reasonCodes: string[] };
}

export interface PublishingPlanDraftIssue {
  code: "PUBLISHING_PLAN_DRAFT_INVALID";
  path: string;
  message: string;
}

export interface PublishingPlanTargetValidationEvidence {
  targetId: string;
  channel: {
    id: string;
    platform: SocialPlatform;
    authorKind: "person" | "organization";
    snapshotDigest: string;
    capabilityVersion: string;
  } | null;
  artifacts: Array<{
    id: string;
    digest: string;
    snapshotDigest: string;
    kind: "text" | "image";
    mediaType: string;
    sizeBytes: number;
  }>;
  settingsDigest: string;
  publishAt: string | null;
  policyEvidenceDigest: string | null;
  policyStateDigest: string | null;
  blockerCodes: PublishingPlanBlockerCode[];
}

export interface PublishingPlanValidationEvidence {
  schema: "publishing-plan-validation-evidence/v1";
  submittedDraftDigest: string;
  definitionDigest: string;
  currentStateDigest: string;
  evaluatedAt: string;
  context: PublishingPlanDraftContext & {
    capability:
      | "publishing_plan_revisions.validate@1"
      | "publishing_plan_revisions.create@1";
    keyId: string;
    authorizationEvidenceRef: string;
    authorizationContractDigest: string;
    resources: {
      channelIds: string[];
      artifactIds: string[];
    };
  };
  runtimePolicy: {
    identity: string;
    contractDigest: string;
  };
  targets: PublishingPlanTargetValidationEvidence[];
  authorizesExecution: false;
}

export interface PublishingPlanSuccessfulTargetValidationEvidence
  extends Omit<
    PublishingPlanTargetValidationEvidence,
    "channel" | "policyEvidenceDigest" | "policyStateDigest" | "blockerCodes"
  > {
  channel: NonNullable<PublishingPlanTargetValidationEvidence["channel"]>;
  policyEvidenceDigest: string;
  policyStateDigest: string;
  blockerCodes: [];
}

export interface PublishingPlanSuccessfulValidationEvidence
  extends Omit<PublishingPlanValidationEvidence, "targets"> {
  targets: PublishingPlanSuccessfulTargetValidationEvidence[];
}

export interface PublishingPlanValidationResult {
  schema: "publishing-plan-validation-result/v1";
  valid: boolean;
  issues: PublishingPlanDraftIssue[];
  blockers: PublishingPlanBlocker[];
  definitionDigest: string | null;
  normalizedDefinition: NormalizedPublishingPlanDefinition | null;
  evidence: PublishingPlanValidationEvidence | null;
}

export interface PublishingPlanRevisionRecord {
  id: string;
  workspaceId: string;
  planId: string;
  revision: number;
  definitionDigest: string;
  definition: NormalizedPublishingPlanDefinition;
  validationEvidence: PublishingPlanSuccessfulValidationEvidence;
  authorPrincipalId: string;
  authorKeyId: string;
  creationAuthorizationEvidenceRef: string;
  createdAt: Date;
}

/** Mutable allocation head. Revisions themselves are append-only. */
export interface PublishingPlanRecord {
  id: string;
  workspaceId: string;
  currentRevision: number;
  createdByPrincipalId: string;
  createdByKeyId: string;
  creationAuthorizationEvidenceRef: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublishingPlanRevisionDto
  extends Omit<
    PublishingPlanRevisionRecord,
    | "authorPrincipalId"
    | "authorKeyId"
    | "creationAuthorizationEvidenceRef"
    | "createdAt"
  > {
  author: {
    principalId: string;
    keyId: string;
    creationAuthorizationEvidenceRef: string;
  };
  createdAt: string;
}

export interface PublishingPlanMutationReceiptRecord {
  workspaceId: string;
  principalId: string;
  capability: "publishing_plan_revisions.create@1";
  idempotencyKey: string;
  requestFingerprint: string;
  revisionId: string;
  createdAt: Date;
}

export type PublishingPlanReceiptResult =
  | { kind: "absent" }
  | { kind: "conflict" }
  | { kind: "replayed"; revisionId: string };

export type PublishingPlanCommitResult =
  | { kind: "created" | "replayed"; revision: PublishingPlanRevisionRecord }
  | { kind: "conflict" }
  | { kind: "plan_conflict" }
  | { kind: "stale_revision" }
  | { kind: "validation_expired" }
  | { kind: "unavailable" };

export interface PublishingPlanValidationSession {
  schema: "publishing-plan-validation-session/v1";
  id: string;
  workspaceId: string;
  principalId: string;
  planId: string;
  submittedDraftDigest: string;
  definitionDigest: string;
  currentStateDigest: string;
  authorizationContext: {
    keyId: string;
    authorizationEvidenceRef: string;
    capability: "publishing_plan_revisions.create@1";
    contextId: string;
    contextDigest: string;
    contextIssuedAt: Date;
    contextExpiresAt: Date;
    authorizationContractDigest: string;
    resources: {
      channelIds: string[];
      artifactIds: string[];
    };
  };
  targets: Array<{
    targetId: string;
    channelId: string;
    channelSnapshotDigest: string;
    contentArtifactId: string;
    mediaArtifactIds: string[];
    artifactSnapshotDigests: string[];
    settings: Record<string, unknown>;
    timing: NormalizedPublishingPlanTarget["timing"];
    policyEvidenceDigest: string;
    policyStateDigest: string;
  }>;
  issuedAt: Date;
  expiresAt: Date;
}

export interface PublishingPlanListFilters {
  planId?: string;
}

export interface PublishingPlanListPosition {
  createdAt: Date;
  id: string;
}

export interface PublishingPlanRepository {
  readReceipt(input: {
    workspaceId: string;
    principalId: string;
    capability: "publishing_plan_revisions.create@1";
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<PublishingPlanReceiptResult>;
  createRevision(input: {
    mode:
      | { kind: "new" }
      | { kind: "edit"; expectedRevision: number };
    plan: PublishingPlanRecord;
    revision: PublishingPlanRevisionRecord;
    receipt: PublishingPlanMutationReceiptRecord;
    /** Repository must atomically verify current tokens and consume this session. */
    validationSession: PublishingPlanValidationSession;
  }): Promise<PublishingPlanCommitResult>;
  getRevision(input: {
    workspaceId: string;
    revisionId: string;
  }): Promise<PublishingPlanRevisionRecord | null>;
  listRevisions(input: {
    workspaceId: string;
    filters: PublishingPlanListFilters;
    before?: PublishingPlanListPosition;
    limit: number;
  }): Promise<PublishingPlanRevisionRecord[]>;
}

export interface PublishingPlanCursorCodec {
  seal(input: {
    workspaceId: string;
    principalId: string;
    filterDigest: string;
    position: PublishingPlanListPosition;
  }): string;
  open(input: {
    cursor: string;
    workspaceId: string;
    principalId: string;
    filterDigest: string;
  }): PublishingPlanListPosition;
}

export interface PublishingPlanClock {
  now(): Date;
}

export interface PublishingPlanValidationInput {
  candidate: unknown;
  workspaceId: string;
  principalId: string;
  authorizationContext: {
    keyId: string;
    authorizationEvidenceRef: string;
    capability:
      | "publishing_plan_revisions.validate@1"
      | "publishing_plan_revisions.create@1";
  };
  effectiveResources: AgentResourceConstraints;
}
