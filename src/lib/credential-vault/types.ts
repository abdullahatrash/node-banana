import type {
  CredentialEffectIntent,
  CredentialAuditEvent,
  ImmutableWorkflowStepRef,
  CredentialProfileStatus,
  CredentialSpendGrant,
  SafeCredentialProfile,
  SpendGrantMode,
  WorkflowCredentialBinding,
} from "@/types/credentials";

export interface CredentialEffectTarget {
  workspaceId: string;
  principalId: string;
  slotId: string;
  profileId: string;
  versionId: string;
  version: number;
  provider: string;
  spendGrantId: string;
}

export type CredentialEffectAuditEventType =
  | "effect.reserved"
  | "effect.completed"
  | "effect.failed"
  | "effect.unknown"
  | "effect.reconciled"
  | "effect.released"
  | "effect.replayed";

export interface CredentialEffectAuditEventRecord {
  id: string;
  workspaceId: string;
  principalId: string;
  profileId: string;
  versionId: string;
  spendGrantId: string;
  effectRef: string;
  effectSequence: number;
  eventType: CredentialEffectAuditEventType;
  requestFingerprint: string;
  failureCode: string | null;
  reconciliationReference: string | null;
  createdAt: Date;
}

/** Internal repository projection. Never export from the vault module. */
export interface CredentialEffectMaterial extends CredentialEffectTarget {
  secretCiphertext: string;
}

export type CredentialSafeJsonValue =
  | null
  | boolean
  | number
  | string
  | CredentialSafeJsonValue[]
  | { [key: string]: CredentialSafeJsonValue };

export type CredentialSafeEffectResult = Exclude<
  CredentialSafeJsonValue,
  null
>;

export interface CredentialHumanMutationReceipt {
  capabilityIdentity: string;
  idempotencyKey: string;
  requestFingerprint: string;
}

export type CredentialHumanMutationResult<Value> =
  | { kind: "completed"; value: Value; replayed: boolean }
  | { kind: "conflict" }
  | { kind: "unavailable" };

export type CredentialEffectReservation =
  | { kind: "reserved"; target: CredentialEffectTarget }
  | {
      kind: "completed";
      target: CredentialEffectTarget;
      safeResult: CredentialSafeEffectResult;
    }
  | {
      kind: "reconciliation_required";
      status: "pending" | "unknown";
    }
  | { kind: "conflict" }
  | { kind: "unavailable" };

export type CredentialEffectReceiptLookup =
  | { kind: "absent" }
  | Exclude<CredentialEffectReservation, { kind: "reserved" }>;

export interface CredentialProviderEffectAdapter {
  readonly provider: string;
  validate(input: {
    operation: string;
    intent: Record<string, unknown>;
  }): void;
  /**
   * A server-owned conservative price ceiling. Callers never submit an
   * authoritative amount.
   */
  quote(input: {
    operation: string;
    intent: Record<string, unknown>;
  }): Promise<{ priceCeilingCents: number }> | { priceCeilingCents: number };
  execute(input: {
    operation: string;
    intent: Record<string, unknown>;
    credential: { secret: string };
    idempotencyKey: string;
  }): Promise<unknown>;
}

export interface CredentialVaultRepository {
  createProfile(input: {
    id: string;
    versionId: string;
    slotId: string;
    workspaceId: string;
    actorUserId: string;
    name: string;
    provider: string;
    slotName: string;
    secretCiphertext: string;
    secretHint: string;
    now: Date;
    receipt: CredentialHumanMutationReceipt;
  }): Promise<CredentialHumanMutationResult<SafeCredentialProfile>>;
  reprovisionProfile(input: {
    versionId: string;
    slotId: string;
    workspaceId: string;
    actorUserId: string;
    profileId: string;
    provider: string;
    slotName: string;
    secretCiphertext: string;
    secretHint: string;
    now: Date;
    receipt: CredentialHumanMutationReceipt;
  }): Promise<CredentialHumanMutationResult<SafeCredentialProfile>>;
  rotateProfile(input: {
    profileId: string;
    versionId: string;
    workspaceId: string;
    actorUserId: string;
    expectedActiveVersion: number;
    overlapUntil: Date | null;
    secretCiphertext: string;
    secretHint: string;
    now: Date;
    receipt: CredentialHumanMutationReceipt;
  }): Promise<CredentialHumanMutationResult<SafeCredentialProfile>>;
  revokeVersion(input: {
    profileId: string;
    version: number;
    workspaceId: string;
    actorUserId: string;
    now: Date;
  }): Promise<boolean>;
  setProfileStatus(input: {
    profileId: string;
    workspaceId: string;
    actorUserId: string;
    status: CredentialProfileStatus;
    now: Date;
  }): Promise<
    | { kind: "completed"; value: SafeCredentialProfile }
    | { kind: "unavailable" }
    | { kind: "conflict" }
  >;
  getSafeProfile(input: {
    workspaceId: string;
    profileId: string;
  }): Promise<SafeCredentialProfile | null>;
  listSafeProfiles(workspaceId: string): Promise<SafeCredentialProfile[]>;
  listSpendGrants(workspaceId: string): Promise<CredentialSpendGrant[]>;
  listAuditEvents(input: {
    workspaceId: string;
    limit: number;
    cursor: { createdAt: Date; id: string } | null;
  }): Promise<CredentialAuditEvent[]>;
  createSpendGrant(input: {
    id: string;
    workspaceId: string;
    actorUserId: string;
    principalId: string;
    profileId: string;
    mode: SpendGrantMode;
    limitCents: number | null;
    now: Date;
    receipt: CredentialHumanMutationReceipt;
  }): Promise<CredentialHumanMutationResult<CredentialSpendGrant>>;
  revokeSpendGrant(input: {
    grantId: string;
    workspaceId: string;
    actorUserId: string;
    now: Date;
  }): Promise<boolean>;
  resolveWorkflowStepBinding(input: {
    workspaceId: string;
    step: ImmutableWorkflowStepRef;
  }): Promise<WorkflowCredentialBinding | null>;
  snapshotEffectTarget(input: {
    workspaceId: string;
    principalId: string;
    slotId: string;
    now: Date;
  }): Promise<CredentialEffectTarget | null>;
  loadEffectMaterial(input: {
    intent: CredentialEffectIntent;
    now: Date;
  }): Promise<CredentialEffectMaterial | null>;
  readEffectReceipt(input: {
    workspaceId: string;
    effectRef: string;
    requestFingerprint: string;
    now: Date;
  }): Promise<CredentialEffectReceiptLookup>;
  reserveEffect(input: {
    intent: CredentialEffectIntent;
    requestFingerprint: string;
    priceCeilingCents: number;
    eventId: string;
    now: Date;
  }): Promise<CredentialEffectReservation>;
  completeEffect(input: {
    workspaceId: string;
    effectRef: string;
    requestFingerprint: string;
    safeResult: CredentialSafeEffectResult;
    now: Date;
  }): Promise<boolean>;
  failEffectBeforeStart(input: {
    workspaceId: string;
    effectRef: string;
    requestFingerprint: string;
    failureCode: string;
    now: Date;
  }): Promise<boolean>;
  markEffectUnknown(input: {
    workspaceId: string;
    effectRef: string;
    requestFingerprint: string;
    failureCode: string;
    now: Date;
  }): Promise<boolean>;
  reconcileEffect(input: {
    workspaceId: string;
    effectRef: string;
    requestFingerprint: string;
    reconciliationReference: string;
    resolution:
      | {
          kind: "completed";
          safeResult: CredentialSafeEffectResult;
        }
      | {
          kind: "failed";
          failureCode: string;
        };
    now: Date;
  }): Promise<boolean>;
}
