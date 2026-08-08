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
  | "dispatching"
  | "confirmation_pending"
  | "succeeded"
  | "failed"
  | "outcome_unknown";

export type PublishingDeliveryTerminalState = Extract<
  PublishingDeliveryState,
  "succeeded" | "failed" | "outcome_unknown"
>;

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
  releaseId: string;
  planId: string;
  planRevisionId: string;
  planRevision: number;
  planRevisionDigest: string;
  approvalRequestId: string;
  approvalDecisionId: string;
  targetId: string;
  channelId: string;
  artifactIds: string[];
  targetSnapshot: PublishingDeliveryTargetSnapshot;
  targetSnapshotDigest: string;
  publishAt: Date;
  desiredState: "publish";
  state: PublishingDeliveryState;
  /** Stable across dispatch retries and provider reconciliation. */
  effectKey: string;
  /** Set durably before the first adapter contact; immutable afterwards. */
  intentDigest: string | null;
  providerOperationRef: string | null;
  latestEffectEvidenceDigest: string | null;
  failureCode: string | null;
  nextEventSequence: number;
  /** Independent from event sequence; v1 is the release outbox intent. */
  nextOutboxGeneration: number;
  acceptedAt: Date;
  scheduledAt: Date;
  dispatchStartedAt: Date | null;
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
      type: "delivery.accepted";
      evidence: {
        releaseId: string;
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
      type: "effect.not_created";
      evidence: {
        effectKey: string;
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
      evidence: { effectKey: string; intentDigest: string };
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
      type: "publication.outcome_unknown";
      evidence: {
        effectKey: string;
        providerOperationRef: null;
        evidenceDigest: string;
        failureCode: string;
      };
      occurredAt: Date;
    };

export interface PublishingDeliveryOutboxIntentRecord {
  id: string;
  workspaceId: string;
  deliveryId: string;
  dedupeKey: string;
  generation: number;
  state: "pending" | "claimed" | "delivered";
  availableAt: Date;
  deliveryToken: string | null;
  deliveryAttempts: number;
  claimedAt: Date | null;
  deliveredAt: Date | null;
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
    preparedAt: Date;
  }): Promise<
    | {
        kind: "prepared" | "replayed";
        delivery: PublishingDeliveryRecord;
        event: PublishingDeliveryEvent;
      }
    | { kind: "stale" | "unavailable" }
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
    occurredAt: Date;
  }): Promise<
    | {
        kind: "settled" | "replayed";
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
          providerOperationRef: null;
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
}

export interface PublishingDeliveryDto
  extends Omit<
    PublishingDeliveryRecord,
    | "publishAt"
    | "acceptedAt"
    | "scheduledAt"
    | "dispatchStartedAt"
    | "completedAt"
    | "updatedAt"
  > {
  publishAt: string;
  acceptedAt: string;
  scheduledAt: string;
  dispatchStartedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  externallyCompleted: boolean;
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
