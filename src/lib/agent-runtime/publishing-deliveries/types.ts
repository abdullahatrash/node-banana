import type {
  PublishingApprovalConsumptionRecord,
  PublishingApprovalRequestRecord,
  PublishingApprovalValidationSession,
} from "../publishing-approvals/types";
import type {
  NormalizedPublishingPlanTarget,
  PublishingPlanRevisionRecord,
  PublishingPlanSuccessfulTargetValidationEvidence,
} from "../publishing-plans/types";

export type PublishingDeliveryState =
  | "scheduled"
  | "blocked"
  | "dispatching"
  | "confirmation_pending"
  | "succeeded"
  | "failed_transient"
  | "failed_terminal"
  | "outcome_unknown"
  | "cancelled";

export type PublishingDeliveryTerminalState = Extract<
  PublishingDeliveryState,
  | "succeeded"
  | "failed_transient"
  | "failed_terminal"
  | "outcome_unknown"
  | "cancelled"
>;

export type PublishingDeliveryFailureClass = "transient" | "terminal";
export type PublishingDeliveryFailureEffectDisposition =
  | "not_created"
  | "provider_failed_known"
  | "ambiguous";

export interface PublishingDeliveryTargetSnapshot {
  schema: "publishing-delivery-target-snapshot/v1";
  target: NormalizedPublishingPlanTarget;
  validation: PublishingPlanSuccessfulTargetValidationEvidence;
  targetDigest: string;
}

/** Immutable record of the one release decision that created a Delivery set. */
export interface PublishingDeliveryReleaseRecord {
  id: string;
  workspaceId: string;
  planId: string;
  planRevisionId: string;
  planRevision: number;
  planRevisionDigest: string;
  approvalRequestId: string;
  approvalDecisionId: string;
  consumingPrincipalId: string;
  consumingKeyId: string;
  capability: "publishing_plan_revisions.release@1";
  authorizationContractDigest: string;
  authorizationEvidenceRef: string;
  authorizedResources: { channelIds: string[]; artifactIds: string[] };
  authorizationIssuedAt: Date;
  authorizationExpiresAt: Date;
  validationSessionId: string;
  validationEvidenceDigest: string;
  validationCurrentStateDigest: string;
  /** Immutable Durable Acceptance projection; later Delivery state never mutates replay. */
  acceptedDeliveries: PublishingDeliveryAcceptedRef[];
  createdAt: Date;
}

export interface PublishingDeliveryRecord {
  id: string;
  workspaceId: string;
  /** Derived manual retries are new Deliveries; their terminal source is immutable. */
  sourceDeliveryId: string | null;
  retryId: string | null;
  /** Exactly one origin is present: releaseId, or sourceDeliveryId + retryId. */
  releaseId: string | null;
  planId: string;
  planRevisionId: string;
  planRevision: number;
  planRevisionDigest: string;
  approvalRequestId: string;
  approvalDecisionId: string;
  /** Immutable principal/key accountable for the Approval that accepted this Delivery. */
  requestingPrincipalId: string;
  requestingKeyId: string;
  targetId: string;
  channelId: string;
  artifactIds: string[];
  targetSnapshot: PublishingDeliveryTargetSnapshot;
  targetSnapshotDigest: string;
  publishAt: Date;
  desiredState: "publish" | "cancel";
  state: PublishingDeliveryState;
  /** Stable across dispatch retries and provider reconciliation. */
  effectKey: string;
  /** Active immutable effect-identity generation; release starts at one. */
  effectGeneration: number;
  /** Set durably before the first adapter contact; immutable afterwards. */
  intentDigest: string | null;
  /** Exact adapter operation contract used for launch and later observation. */
  providerAdapterContractDigest: string | null;
  /** One-based next provider-contact attempt within the active effect identity. */
  nextEffectAttempt: number;
  providerOperationRef: string | null;
  latestEffectEvidenceDigest: string | null;
  failureCode: string | null;
  /** Normalized provider/pre-contact truth; never inferred from failureCode. */
  failureClass: PublishingDeliveryFailureClass | null;
  failureRetryable: boolean | null;
  failureEffectDisposition: PublishingDeliveryFailureEffectDisposition | null;
  readinessBlockCode: PublishingDeliveryExecutionReadinessFailureCode | null;
  readinessEvidenceDigest: string | null;
  readinessBlockedAt: Date | null;
  readinessRetryAt: Date | null;
  readinessBlockCount: number;
  nextEventSequence: number;
  /** Independent from event sequence; v1 is the release outbox intent. */
  nextOutboxGeneration: number;
  acceptedAt: Date;
  scheduledAt: Date;
  dispatchStartedAt: Date | null;
  /** Fenced boundary after which adapter contact may have happened. */
  effectContactStartedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export type PublishingDeliveryEvent =
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "delivery.blocked";
      evidence: {
        failureCode: PublishingDeliveryExecutionReadinessFailureCode;
        evidenceDigest: string;
        retryAt: string;
        blockCount: number;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "delivery.resumed";
      evidence: {
        priorFailureCode: PublishingDeliveryExecutionReadinessFailureCode;
        priorEvidenceDigest: string;
        readinessEvidenceDigest: string;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "delivery.accepted";
      evidence:
        | {
            origin: "release";
            releaseId: string;
            sourceDeliveryId: null;
            retryId: null;
            approvalRequestId: string;
            approvalDecisionId: string;
            targetSnapshotDigest: string;
          }
        | {
            origin: "retry";
            releaseId: null;
            sourceDeliveryId: string;
            retryId: string;
            approvalRequestId: string;
            approvalDecisionId: string;
            targetSnapshotDigest: string;
          };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "effect.contact_started";
      evidence: {
        effectKey: string;
        effectGeneration: number;
        intentDigest: string;
        providerAdapterContractDigest: string;
        readinessEvidenceDigest: string;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "delivery.cancellation_requested";
      evidence: {
        cancellationId: string;
        actorKind: "agent" | "human";
        effectDisposition:
          | "not_created"
          | "contact_started"
          | "provider_accepted"
          | "terminal";
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "delivery.cancelled";
      evidence: {
        cancellationId: string;
        effectKey: string;
        effectDisposition: "not_created";
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "effect.not_created";
      evidence: {
        effectKey: string;
        effectGeneration: number;
        evidenceDigest: string;
        failureCode: string;
        failureClass: PublishingDeliveryFailureClass;
        retryable: boolean;
        effectDisposition: "not_created";
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "publication.confirmation_pending";
      evidence: {
        effectKey: string;
        providerOperationRef: string;
        evidenceDigest: string;
        pollAt: string;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "publication.retry_scheduled";
      evidence: {
        effectKey: string;
        evidenceDigest: string;
        failureCode: string;
        retryAt: string;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "delivery.scheduled";
      evidence: { publishAt: string };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "effect.prepared";
      evidence: {
        effectKey: string;
        effectGeneration: number;
        intentDigest: string;
        providerAdapterContractDigest: string;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "publication.succeeded";
      evidence: {
        effectKey: string;
        providerOperationRef: string;
        evidenceDigest: string;
        failureCode: null;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "publication.failed";
      evidence: {
        effectKey: string;
        providerOperationRef: string | null;
        evidenceDigest: string;
        failureCode: string;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "publication.failed_transient";
      evidence: {
        effectKey: string;
        effectGeneration: number;
        providerOperationRef: string | null;
        evidenceDigest: string;
        failureCode: string;
        failureClass: "transient";
        retryable: true;
        effectDisposition: "not_created" | "provider_failed_known";
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "publication.failed_terminal";
      evidence: {
        effectKey: string;
        effectGeneration: number;
        providerOperationRef: string | null;
        evidenceDigest: string;
        failureCode: string;
        failureClass: "terminal";
        retryable: false;
        effectDisposition: "not_created" | "provider_failed_known";
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "publication.outcome_unknown";
      evidence: {
        effectKey: string;
        providerOperationRef: string | null;
        evidenceDigest: string;
        failureCode: string;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "delivery.retry_requested";
      evidence: {
        retryId: string;
        sourceDeliveryId: string;
        approvalRequestId: string;
        approvalDecisionId: string;
        sourceEffectKey: string;
        sourceEffectGeneration: number;
        sourceEvidenceDigest: string;
        deliveryId: string;
        effectKey: string;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "delivery.reconciliation_requested";
      evidence: {
        reconciliationId: string;
        effectKey: string;
        effectGeneration: number;
        sourceEvidenceDigest: string;
      };
      occurredAt: Date;
    }
  | {
      schema: "publishing-delivery-event/v1";
      id: string;
      workspaceId: string;
      deliveryId: string;
      sequence: number;
      type: "delivery.reconciled";
      evidence: {
        reconciliationId: string;
        effectKey: string;
        effectGeneration: number;
        sourceEvidenceDigest: string;
        evidenceDigest: string;
        resolution:
          | "succeeded"
          | "failed_transient"
          | "failed_terminal"
          | "still_unknown"
          | "operator_required";
        providerOperationRef: string | null;
        failureCode: string | null;
        retryable: boolean | null;
      };
      occurredAt: Date;
    };

export interface PublishingDeliveryOutboxIntentRecord {
  id: string;
  workspaceId: string;
  deliveryId: string;
  purpose: "publish" | "reconcile";
  dedupeKey: string;
  generation: number;
  state: "pending" | "claimed" | "delivered";
  availableAt: Date;
  deliveryToken: string | null;
  deliveryAttempts: number;
  claimedAt: Date | null;
  deliveredAt: Date | null;
}

export interface PublishingDeliveryEffectIdentityRecord {
  schema: "publishing-delivery-effect-identity/v1";
  workspaceId: string;
  deliveryId: string;
  generation: number;
  effectKey: string;
  intentDigest: string | null;
  providerAdapterContractDigest: string | null;
  parentEffectKey: string | null;
  parentGeneration: number | null;
  derivation: "release" | "manual_retry";
  sourceEvidenceDigest: string | null;
  createdAt: Date;
}

export type PublishingDeliveryRecoveryActor =
  PublishingDeliveryCancellationActor;

export type PublishingDeliveryRecoveryCapability =
  | "publishing_deliveries.retry@1"
  | "publishing_deliveries.reconcile@1";

export interface PublishingDeliveryRecoveryAuthorizationSession {
  schema: "publishing-delivery-recovery-authorization-session/v1";
  id: string;
  workspaceId: string;
  actor: PublishingDeliveryRecoveryActor;
  capability: PublishingDeliveryRecoveryCapability;
  contractDigest: string;
  admissionEvidenceRef: string;
  evidenceRef: string;
  evidenceDigest: string;
  resources: { channelIds: string[]; artifactIds: string[] };
  humanGrants: Array<{ channelId: string; grantId: string }>;
  issuedAt: Date;
  expiresAt: Date;
}

export interface PublishingDeliveryRecoveryAuthorizationPort {
  checkCurrent(input: {
    workspaceId: string;
    actor: PublishingDeliveryRecoveryActor;
    capability: PublishingDeliveryRecoveryCapability;
    authorizationContractDigest: string;
    authorizationEvidenceRef: string;
    channelIds: string[];
    artifactIds: string[];
    evaluatedAt: Date;
  }): Promise<PublishingDeliveryRecoveryAuthorizationSession | null>;
}

export type PublishingDeliveryExecutionReadinessFailureCode =
  | "EXECUTION_AUTHORIZATION_REVOKED"
  | "APPROVAL_NO_LONGER_VALID"
  | "CHANNEL_UNAVAILABLE"
  | "CREDENTIAL_UNAVAILABLE"
  | "VALIDATION_STALE";

export interface PublishingDeliveryExecutionReadinessSession {
  schema: "publishing-delivery-execution-readiness/v1";
  id: string;
  workspaceId: string;
  deliveryId: string;
  effectKey: string;
  effectGeneration: number;
  intentDigest: string;
  providerAdapterContractDigest: string;
  mode: "launch";
  authorizationEvidenceDigest: string;
  approvalEvidenceDigest: string;
  channelEvidenceDigest: string;
  credentialEvidenceDigest: string;
  validationEvidenceDigest: string;
  evidenceDigest: string;
  evaluatedAt: Date;
  expiresAt: Date;
}

export interface PublishingDeliveryExecutionReadinessPort {
  checkCurrent(input: {
    workspaceId: string;
    deliveryId: string;
    effectKey: string;
    effectGeneration: number;
    intentDigest: string;
    providerAdapterContractDigest: string;
    evaluatedAt: Date;
  }): Promise<
    | { kind: "ready"; session: PublishingDeliveryExecutionReadinessSession }
    | {
        kind: "blocked";
        failureCode: PublishingDeliveryExecutionReadinessFailureCode;
        evidenceDigest: string;
      }
    | { kind: "unavailable" }
  >;
}

export interface PublishingDeliveryRetryRecord {
  schema: "publishing-delivery-retry-record/v1";
  id: string;
  workspaceId: string;
  sourceDeliveryId: string;
  /** The newly accepted Delivery created by this manual retry. */
  deliveryId: string;
  actor: PublishingDeliveryRecoveryActor;
  sourceEffectKey: string;
  sourceEffectGeneration: number;
  sourceIntentDigest: string | null;
  sourceProviderAdapterContractDigest: string | null;
  sourceEvidenceDigest: string;
  sourceFailureClass: PublishingDeliveryFailureClass;
  sourceEffectDisposition: "not_created" | "provider_failed_known";
  approvalRequestId: string;
  approvalDecisionId: string;
  authorization: PublishingDeliveryRecoveryAuthorizationSession;
  requestedAt: Date;
}

export interface PublishingDeliveryRetryMutationReceiptRecord {
  schema: "publishing-delivery-retry-mutation-receipt/v1";
  workspaceId: string;
  actorKind: "agent" | "human";
  actorId: string;
  capability: "publishing_deliveries.retry@1";
  idempotencyKey: string;
  requestFingerprint: string;
  retryId: string;
  sourceDeliveryId: string;
  deliveryId: string;
  createdAt: Date;
}

/** Retry-specific Approval claim retaining both the requester and Human/Agent initiator. */
export interface PublishingDeliveryRetryApprovalConsumptionRecord {
  schema: "publishing-delivery-retry-approval-consumption/v1";
  id: string;
  workspaceId: string;
  approvalRequestId: string;
  approvalDecisionId: string;
  sourceDeliveryId: string;
  deliveryId: string;
  sourceEvidenceDigest: string;
  requestingPrincipalId: string;
  requestingKeyId: string;
  actor: PublishingDeliveryRecoveryActor;
  capability: "publishing_deliveries.retry@1";
  authorizationContractDigest: string;
  authorizationEvidenceRef: string;
  authorizedResources: { channelIds: string[]; artifactIds: string[] };
  consumedAt: Date;
}

export interface PublishingDeliveryRetryDto {
  schema: "publishing-delivery-retry/v1";
  retryId: string;
  sourceDeliveryId: string;
  sourceEvidenceDigest: string;
  delivery: PublishingDeliveryAcceptedRef;
  requestedAt: string;
  durable: true;
  externallyCompleted: false;
}

export type PublishingDeliveryReconciliationResolution =
  | {
      kind: "succeeded";
      providerOperationRef: string;
      evidenceDigest: string;
    }
  | {
      kind: "failed_known";
      providerOperationRef: string | null;
      evidenceDigest: string;
      failureCode: string;
      failureClass: PublishingDeliveryFailureClass;
      retryable: boolean;
      effectDisposition: "not_created" | "provider_failed_known";
    }
  | {
      kind: "still_unknown";
      providerOperationRef: string | null;
      evidenceDigest: string;
      failureCode: string;
    }
  | {
      kind: "operator_required";
      providerOperationRef: string | null;
      evidenceDigest: string;
      failureCode: string;
    };

export interface PublishingDeliveryReconciliationRequestRecord {
  schema: "publishing-delivery-reconciliation-request/v1";
  id: string;
  workspaceId: string;
  deliveryId: string;
  actor: PublishingDeliveryRecoveryActor;
  sourceEffectKey: string;
  sourceEffectGeneration: number;
  sourceIntentDigest: string;
  sourceProviderAdapterContractDigest: string;
  sourceProviderOperationRef: string | null;
  sourceEvidenceDigest: string;
  authorization: PublishingDeliveryRecoveryAuthorizationSession;
  requestedAt: Date;
}

export interface PublishingDeliveryReconciliationResultRecord {
  schema: "publishing-delivery-reconciliation-result/v1";
  id: string;
  workspaceId: string;
  deliveryId: string;
  reconciliationId: string;
  sourceEvidenceDigest: string;
  effectKey: string;
  effectGeneration: number;
  resolution: PublishingDeliveryReconciliationResolution;
  completedAt: Date;
}

export interface PublishingDeliveryReconciliationProjection {
  request: PublishingDeliveryReconciliationRequestRecord;
  result: PublishingDeliveryReconciliationResultRecord | null;
}

export interface PublishingDeliveryReconciliationDto {
  schema: "publishing-delivery-reconciliation/v1";
  reconciliationId: string;
  deliveryId: string;
  sourceEvidenceDigest: string;
  effectKey: string;
  effectGeneration: number;
  status: "queued" | "completed";
  resolution:
    | "succeeded"
    | "failed_transient"
    | "failed_terminal"
    | "still_unknown"
    | "operator_required"
    | null;
  requestedAt: string;
  completedAt: string | null;
  durable: true;
  externallyCompleted: boolean | null;
}

export interface PublishingDeliveryExecutionLeaseRecord {
  workspaceId: string;
  deliveryId: string;
  workerId: string;
  leaseToken: string;
  fence: bigint;
  acquiredAt: Date;
  expiresAt: Date;
  renewedAt: Date;
  releasedAt: Date | null;
}

export interface PublishingDeliveryAuthorizationSession {
  schema: "publishing-delivery-authorization-session/v1";
  id: string;
  workspaceId: string;
  principalId: string;
  keyId: string;
  capability: "publishing_plan_revisions.release@1";
  contractDigest: string;
  evidenceRef: string;
  resources: { channelIds: string[]; artifactIds: string[] };
  issuedAt: Date;
  expiresAt: Date;
}

export interface PublishingDeliveryAuthorizationPort {
  checkCurrent(input: {
    workspaceId: string;
    principalId: string;
    keyId: string;
    capability: "publishing_plan_revisions.release@1";
    authorizationContractDigest: string;
    authorizationEvidenceRef: string;
    channelIds: string[];
    artifactIds: string[];
    evaluatedAt: Date;
  }): Promise<PublishingDeliveryAuthorizationSession | null>;
}

export type PublishingDeliveryCancellationActor =
  | { kind: "agent"; principalId: string; keyId: string }
  | { kind: "human"; userId: string };

export interface PublishingDeliveryCancellationAuthorizationSession {
  schema: "publishing-delivery-cancellation-authorization-session/v1";
  id: string;
  workspaceId: string;
  actor: PublishingDeliveryCancellationActor;
  capability: "publishing_deliveries.cancel@1";
  contractDigest: string;
  admissionEvidenceRef: string;
  /** Agent admission evidence or explicit Human Channel-grant evidence. */
  evidenceRef: string;
  evidenceDigest: string;
  resources: { channelIds: string[]; artifactIds: string[] };
  /** Human authority is explicit and Channel-scoped; role is never authority. */
  humanGrants: Array<{ channelId: string; grantId: string }>;
  issuedAt: Date;
  expiresAt: Date;
}

export interface PublishingDeliveryCancellationAuthorizationPort {
  checkCurrent(input: {
    workspaceId: string;
    actor: PublishingDeliveryCancellationActor;
    capability: "publishing_deliveries.cancel@1";
    authorizationContractDigest: string;
    authorizationEvidenceRef: string;
    channelIds: string[];
    artifactIds: string[];
    evaluatedAt: Date;
  }): Promise<PublishingDeliveryCancellationAuthorizationSession | null>;
}

export type PublishingDeliveryCancellationOutcome =
  | "prevented"
  | "conditional"
  | "unknown"
  | "too_late";

/** Immutable, authority-retaining record behind intrinsic cancellation replay. */
export interface PublishingDeliveryCancellationRecord {
  schema: "publishing-delivery-cancellation-record/v1";
  id: string;
  workspaceId: string;
  deliveryId: string;
  actor: PublishingDeliveryCancellationActor;
  capability: "publishing_deliveries.cancel@1";
  authorizationContractDigest: string;
  authorizationAdmissionEvidenceRef: string;
  authorizationEvidenceRef: string;
  authorizationEvidenceDigest: string;
  authorizedResources: { channelIds: string[]; artifactIds: string[] };
  authorityGrants: Array<{ channelId: string; grantId: string }>;
  stateAtRequest: PublishingDeliveryState;
  outcome: PublishingDeliveryCancellationOutcome;
  /** Null when provider contact makes completion unknowable at request time. */
  externallyCompletedAtRequest: boolean | null;
  requestedAt: Date;
}

export interface PublishingDeliveryCancellationDto {
  schema: "publishing-delivery-cancellation/v1";
  cancellationId: string;
  deliveryId: string;
  desiredState: "cancel";
  stateAtRequest: PublishingDeliveryState;
  outcome: PublishingDeliveryCancellationOutcome;
  externallyCompletedAtRequest: boolean | null;
  requestedAt: string;
  durable: true;
  externallyReversed: false;
}

export interface PublishingDeliveryRevisionPort {
  getCurrentRevision(input: {
    workspaceId: string;
    revisionId: string;
  }): Promise<PublishingPlanRevisionRecord | null>;
}

export interface PublishingDeliveryValidationPort {
  verifyCurrent(input: {
    workspaceId: string;
    revision: PublishingPlanRevisionRecord;
    targetIds: string[];
    evaluatedAt: Date;
    mode: "release" | "retry_due";
  }): Promise<PublishingApprovalValidationSession | null>;
}

export interface PublishingDeliveryMutationReceiptRecord {
  workspaceId: string;
  principalId: string;
  capability: "publishing_plan_revisions.release@1";
  idempotencyKey: string;
  requestFingerprint: string;
  releaseId: string;
  createdAt: Date;
}

export type PublishingDeliveryReceiptResult =
  | { kind: "absent" }
  | { kind: "conflict" }
  | { kind: "replayed"; releaseId: string };

export type PublishingDeliveryReleaseResult =
  | {
      kind: "created" | "replayed";
      release: PublishingDeliveryReleaseRecord;
      deliveries: PublishingDeliveryRecord[];
    }
  | { kind: "conflict" }
  | { kind: "approval_invalid" | "approval_consumed" }
  | { kind: "stale_revision" }
  | { kind: "authorization_stale" }
  | { kind: "validation_stale" }
  | { kind: "unavailable" };

export interface PublishingDeliveryListFilters {
  planRevisionId?: string;
  state?: PublishingDeliveryState;
  targetId?: string;
  consumingPrincipalId?: string;
  authorizedChannelIds?: string[];
  authorizedArtifactIds?: string[];
}

export interface PublishingDeliveryListPosition {
  acceptedAt: Date;
  id: string;
}

export interface PublishingDeliveryCursorCodec {
  seal(input: {
    workspaceId: string;
    principalId: string;
    filterDigest: string;
    position: PublishingDeliveryListPosition;
  }): string;
  open(input: {
    cursor: string;
    workspaceId: string;
    principalId: string;
    filterDigest: string;
  }): PublishingDeliveryListPosition;
}

export interface PublishingDeliveryRepository {
  readReleaseReceipt(input: {
    workspaceId: string;
    principalId: string;
    capability: "publishing_plan_revisions.release@1";
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<PublishingDeliveryReceiptResult>;
  getApprovalForRelease(input: {
    workspaceId: string;
    approvalRequestId: string;
    requestingPrincipalId: string;
  }): Promise<PublishingApprovalRequestRecord | null>;
  /**
   * One transaction must lock and revalidate the receipt, Approval decision,
   * Plan head, authorization, and validation evidence before writing every
   * consumption, Delivery, first event, outbox intent, and release receipt.
   */
  release(input: {
    release: PublishingDeliveryReleaseRecord;
    approval: PublishingApprovalRequestRecord;
    revision: PublishingPlanRevisionRecord;
    approvalConsumption: PublishingApprovalConsumptionRecord;
    authorizationSession: PublishingDeliveryAuthorizationSession;
    validationSession: PublishingApprovalValidationSession;
    deliveries: PublishingDeliveryRecord[];
    firstEvents: PublishingDeliveryEvent[];
    outboxIntents: PublishingDeliveryOutboxIntentRecord[];
    receipt: PublishingDeliveryMutationReceiptRecord;
  }): Promise<PublishingDeliveryReleaseResult>;
  getRelease(input: {
    workspaceId: string;
    releaseId: string;
    consumingPrincipalId?: string;
  }): Promise<PublishingDeliveryReleaseRecord | null>;
  getDeliveriesByRelease(input: {
    workspaceId: string;
    releaseId: string;
    consumingPrincipalId?: string;
  }): Promise<PublishingDeliveryRecord[]>;
  getDelivery(input: {
    workspaceId: string;
    deliveryId: string;
    consumingPrincipalId?: string;
    authorizedChannelIds?: string[];
    authorizedArtifactIds?: string[];
  }): Promise<PublishingDeliveryRecord | null>;
  listDeliveries(input: {
    workspaceId: string;
    filters: PublishingDeliveryListFilters;
    before?: PublishingDeliveryListPosition;
    limit: number;
  }): Promise<PublishingDeliveryRecord[]>;
  listEvents(input: {
    workspaceId: string;
    deliveryId: string;
    afterSequence: number;
    limit: number;
    consumingPrincipalId?: string;
    authorizedChannelIds?: string[];
    authorizedArtifactIds?: string[];
  }): Promise<PublishingDeliveryEvent[] | null>;
  getCancellation(input: {
    workspaceId: string;
    deliveryId: string;
    actor?: PublishingDeliveryCancellationActor;
  }): Promise<PublishingDeliveryCancellationRecord | null>;
  /** Intrinsic Delivery-scoped cancellation; replay must return the first record. */
  cancel(input: {
    workspaceId: string;
    deliveryId: string;
    cancellationId: string;
    actor: PublishingDeliveryCancellationActor;
    authorizationSession: PublishingDeliveryCancellationAuthorizationSession;
    requestedAt: Date;
  }): Promise<
    | {
        kind: "created" | "replayed";
        cancellation: PublishingDeliveryCancellationRecord;
        delivery: PublishingDeliveryRecord;
        events: PublishingDeliveryEvent[];
      }
    | { kind: "not_found" | "authorization_stale" | "unavailable" }
  >;

  getRetry(input: {
    workspaceId: string;
    sourceDeliveryId: string;
    sourceEvidenceDigest: string;
    actor: PublishingDeliveryRecoveryActor;
  }): Promise<PublishingDeliveryRetryRecord | null>;
  getRetryMutationReceipt(input: {
    workspaceId: string;
    actorKind: "agent" | "human";
    actorId: string;
    capability: "publishing_deliveries.retry@1";
    idempotencyKey: string;
  }): Promise<PublishingDeliveryRetryMutationReceiptRecord | null>;
  /** Safe retry is governed by normalized retained effect evidence, never codes. */
  retryKnownFailure(input: {
    retry: PublishingDeliveryRetryRecord;
    sourceDelivery: PublishingDeliveryRecord;
    /** Fresh accepted Delivery; the source is never updated or appended to. */
    delivery: PublishingDeliveryRecord;
    approval: PublishingApprovalRequestRecord;
    approvalConsumption: PublishingDeliveryRetryApprovalConsumptionRecord;
    mutationReceipt: PublishingDeliveryRetryMutationReceiptRecord;
    revision: PublishingPlanRevisionRecord;
    validationSession: PublishingApprovalValidationSession;
    authorizationSession: PublishingDeliveryRecoveryAuthorizationSession;
    effectIdentity: PublishingDeliveryEffectIdentityRecord;
    events: PublishingDeliveryEvent[];
    outboxIntent: PublishingDeliveryOutboxIntentRecord;
  }): Promise<
    | {
        kind: "created" | "replayed";
        retry: PublishingDeliveryRetryRecord;
        delivery: PublishingDeliveryRecord;
        events: PublishingDeliveryEvent[];
      }
    | {
        kind:
          | "not_found"
          | "not_retryable"
          | "retry_conflict"
          | "approval_invalid"
          | "approval_consumed"
          | "stale_revision"
          | "authorization_stale"
          | "validation_stale"
          | "unavailable";
      }
  >;
  getReconciliation(input: {
    workspaceId: string;
    deliveryId: string;
    sourceEvidenceDigest: string;
    actor: PublishingDeliveryRecoveryActor;
  }): Promise<PublishingDeliveryReconciliationProjection | null>;
  requestReconciliation(input: {
    reconciliation: PublishingDeliveryReconciliationRequestRecord;
    authorizationSession: PublishingDeliveryRecoveryAuthorizationSession;
    event: PublishingDeliveryEvent;
    outboxIntent: PublishingDeliveryOutboxIntentRecord;
  }): Promise<
    | {
        kind: "created" | "replayed";
        reconciliation: PublishingDeliveryReconciliationRequestRecord;
        delivery: PublishingDeliveryRecord;
        event: PublishingDeliveryEvent;
      }
    | {
        kind:
          | "not_found"
          | "not_reconcilable"
          | "reconciliation_conflict"
          | "authorization_stale"
          | "unavailable";
      }
  >;

  claimOutbox(input: {
    now: Date;
    claimExpiresBefore: Date;
    deliveryToken: string;
  }): Promise<
    | { kind: "claimed"; intent: PublishingDeliveryOutboxIntentRecord }
    | { kind: "empty" }
    | { kind: "unavailable" }
  >;
  markOutboxDelivered(input: {
    intentId: string;
    deliveryToken: string;
    deliveredAt: Date;
  }): Promise<"delivered" | "stale" | "unavailable">;
  releaseOutbox(input: {
    intentId: string;
    deliveryToken: string;
    availableAt: Date;
  }): Promise<"released" | "stale" | "unavailable">;
  acquireLease(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<
    | {
        kind: "acquired";
        delivery: PublishingDeliveryRecord;
        lease: PublishingDeliveryExecutionLeaseRecord;
      }
    | { kind: "not_due" }
    | { kind: "terminal" }
    | { kind: "busy" }
    | { kind: "unavailable" }
  >;
  renewLease(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    leaseToken: string;
    fence: bigint;
    now: Date;
    expiresAt: Date;
  }): Promise<PublishingDeliveryExecutionLeaseRecord | null>;
  prepareEffect(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    leaseToken: string;
    fence: bigint;
    effectKey: string;
    intentDigest: string;
    providerAdapterContractDigest: string;
    preparedAt: Date;
  }): Promise<
    | {
        kind: "prepared" | "replayed";
        delivery: PublishingDeliveryRecord;
        event: PublishingDeliveryEvent;
      }
    | { kind: "stale" | "unavailable" }
  >;
  /** Last fenced local barrier before any adapter call. */
  beginEffectContact(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    leaseToken: string;
    fence: bigint;
    effectKey: string;
    intentDigest: string;
    providerAdapterContractDigest: string;
    readinessSession: PublishingDeliveryExecutionReadinessSession;
    startedAt: Date;
  }): Promise<
    | {
        kind: "started" | "replayed";
        delivery: PublishingDeliveryRecord;
        event: PublishingDeliveryEvent;
      }
    | {
        kind: "blocked";
        failureCode: PublishingDeliveryExecutionReadinessFailureCode;
        evidenceDigest: string;
      }
    | { kind: "cancelled" | "stale" | "unavailable" }
  >;
  /** Fenced terminal proof that no complete intent or external effect existed. */
  failBeforeEffect(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    leaseToken: string;
    fence: bigint;
    effectKey: string;
    evidenceDigest: string;
    failureCode: string;
    failureClass: PublishingDeliveryFailureClass;
    retryable: boolean;
    effectDisposition: "not_created";
    occurredAt: Date;
  }): Promise<
    | {
        kind: "settled" | "replayed";
        delivery: PublishingDeliveryRecord;
        event: PublishingDeliveryEvent;
      }
    | { kind: "stale" | "unavailable" }
  >;
  /** Nonterminal immediate-readiness drift; schedules a bounded same-Delivery recheck. */
  blockForReadiness(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    leaseToken: string;
    fence: bigint;
    effectKey: string;
    failureCode: PublishingDeliveryExecutionReadinessFailureCode;
    evidenceDigest: string;
    retryAt: Date;
    blockedAt: Date;
    outboxIntent: PublishingDeliveryOutboxIntentRecord;
  }): Promise<
    | {
        kind: "blocked" | "replayed";
        delivery: PublishingDeliveryRecord;
        event: PublishingDeliveryEvent;
      }
    | { kind: "stale" | "unavailable" }
  >;
  settleEffect(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    leaseToken: string;
    fence: bigint;
    effectKey: string;
    intentDigest: string;
    outcome:
      | {
          kind: "succeeded";
          providerOperationRef: string;
          evidenceDigest: string;
        }
      | {
          kind: "failed";
          providerOperationRef: string | null;
          evidenceDigest: string;
          failureCode: string;
          failureClass: PublishingDeliveryFailureClass;
          retryable: boolean;
          effectDisposition: "not_created" | "provider_failed_known";
        }
      | {
          kind: "retry_scheduled";
          evidenceDigest: string;
          failureCode: string;
          retryAt: Date;
        }
      | {
          kind: "confirmation_pending";
          providerOperationRef: string;
          evidenceDigest: string;
          pollAt: Date;
        }
      | {
          /** Terminal ambiguity only when the adapter cannot safely observe. */
          kind: "outcome_unknown";
          providerOperationRef: string | null;
          evidenceDigest: string;
          failureCode: string;
        };
    retryOutboxIntent?: PublishingDeliveryOutboxIntentRecord;
    occurredAt: Date;
  }): Promise<
    | {
        kind: "settled" | "replayed";
        delivery: PublishingDeliveryRecord;
        event: PublishingDeliveryEvent;
      }
    | { kind: "stale" | "unavailable" }
  >;
  acquireReconciliationLease(input: {
    workspaceId: string;
    deliveryId: string;
    workerId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<
    | {
        kind: "acquired";
        delivery: PublishingDeliveryRecord;
        reconciliation: PublishingDeliveryReconciliationRequestRecord;
        lease: PublishingDeliveryExecutionLeaseRecord;
      }
    | { kind: "not_due" | "busy" | "terminal" | "unavailable" }
  >;
  settleReconciliation(input: {
    workspaceId: string;
    deliveryId: string;
    reconciliationId: string;
    workerId: string;
    leaseToken: string;
    fence: bigint;
    effectKey: string;
    effectGeneration: number;
    intentDigest: string;
    providerAdapterContractDigest: string;
    sourceEvidenceDigest: string;
    resolution: PublishingDeliveryReconciliationResolution;
    event: PublishingDeliveryEvent;
    occurredAt: Date;
  }): Promise<
    | {
        kind: "settled" | "replayed";
        delivery: PublishingDeliveryRecord;
        reconciliation: PublishingDeliveryReconciliationRequestRecord;
        result: PublishingDeliveryReconciliationResultRecord;
        event: PublishingDeliveryEvent;
      }
    | { kind: "stale" | "unavailable" }
  >;
}

export interface PublishingDeliveryDto
  extends Omit<
    PublishingDeliveryRecord,
    | "publishAt"
    | "acceptedAt"
    | "scheduledAt"
    | "dispatchStartedAt"
    | "effectContactStartedAt"
    | "readinessBlockedAt"
    | "readinessRetryAt"
    | "completedAt"
    | "updatedAt"
  > {
  publishAt: string;
  acceptedAt: string;
  scheduledAt: string;
  dispatchStartedAt: string | null;
  effectContactStartedAt: string | null;
  readinessBlockedAt: string | null;
  readinessRetryAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  externallyCompleted: boolean | null;
}

export interface PublishingDeliveryEventDto
  extends Omit<PublishingDeliveryEvent, "occurredAt"> {
  occurredAt: string;
}

export interface PublishingDeliveryDurableAcceptance {
  schema: "publishing-delivery-durable-acceptance/v1";
  releaseId: string;
  approvalRequestId: string;
  approvalDecisionId: string;
  deliveries: PublishingDeliveryAcceptedRef[];
  acceptedAt: string;
  durable: true;
  /** Durable local scheduling intent is not proof of provider publication. */
  externallyCompleted: false;
}

export interface PublishingDeliveryAcceptedRef {
  id: string;
  targetId: string;
  channelId: string;
  publishAt: string;
  state: "scheduled";
  effectKey: string;
  acceptedAt: string;
  scheduledAt: string;
  externallyCompleted: false;
}

export interface PublishingDeliveryClock {
  now(): Date;
}
