import type {
  CredentialEffectIntent,
  CredentialVersionStatus,
  CredentialSpendGrant,
  SafeCredentialProfile,
} from "@/types/credentials";
import type {
  CredentialSafeEffectResult,
  CredentialEffectAuditEventRecord,
  CredentialEffectAuditEventType,
  CredentialHumanMutationResult,
  CredentialVaultRepository,
} from "./types";

type ProfileState = SafeCredentialProfile & { deletedAt: Date | null };
type StoredCredentialVersion = {
  id: string;
  profileId: string;
  version: number;
  secretCiphertext: string;
  secretHint: string;
  status: CredentialVersionStatus;
  createdByUserId: string;
  createdAt: Date;
  usableUntil: Date | null;
  revokedAt: Date | null;
};

export class InMemoryCredentialVaultRepository
  implements CredentialVaultRepository
{
  readonly administrators = new Set<string>();
  readonly profiles = new Map<string, ProfileState>();
  readonly versions = new Map<string, StoredCredentialVersion>();
  readonly slots = new Map<
    string,
    {
      id: string;
      workspaceId: string;
      profileId: string;
      name: string;
      provider: string;
    }
  >();
  readonly grants = new Map<string, CredentialSpendGrant>();
  readonly principals = new Map<
    string,
    { workspaceId: string; status: "active" | "suspended" | "revoked" }
  >();
  readonly workflowBindings = new Map<
    string,
    import("@/types/credentials").WorkflowCredentialBinding
  >();
  readonly humanMutationReceipts = new Map<
    string,
    { requestFingerprint: string; value: unknown }
  >();
  readonly spendEvents: Array<{
    id: string;
    workspaceId: string;
    principalId: string;
    slotId: string;
    profileId: string;
    versionId: string;
    spendGrantId: string;
    priceCeilingCents: number;
    mode: string;
    effectRef: string;
    requestFingerprint: string;
    resolvedVersion: number;
    resolvedProvider: string;
    status: "pending" | "completed" | "failed" | "unknown";
    safeResult: CredentialSafeEffectResult | null;
    failureCode: string | null;
    completedAt: Date | null;
    failedAt: Date | null;
    unknownAt: Date | null;
    reconciliationReference: string | null;
    reconciledAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }> = [];
  readonly effectAuditEvents: CredentialEffectAuditEventRecord[] = [];

  private appendEffectAuditEvents(
    receipt: InMemoryCredentialVaultRepository["spendEvents"][number],
    events: Array<{
      eventType: CredentialEffectAuditEventType;
      failureCode?: string | null;
      reconciliationReference?: string | null;
    }>,
    now: Date,
  ): void {
    const currentSequence = this.effectAuditEvents
      .filter(
        (event) =>
          event.workspaceId === receipt.workspaceId &&
          event.effectRef === receipt.effectRef,
      )
      .reduce(
        (highest, event) => Math.max(highest, event.effectSequence),
        0,
      );
    this.effectAuditEvents.push(
      ...events.map((event, index) => ({
        id: randomUUID(),
        workspaceId: receipt.workspaceId,
        principalId: receipt.principalId,
        profileId: receipt.profileId,
        versionId: receipt.versionId,
        spendGrantId: receipt.spendGrantId,
        effectRef: receipt.effectRef,
        effectSequence: currentSequence + index + 1,
        eventType: event.eventType,
        requestFingerprint: receipt.requestFingerprint,
        failureCode: event.failureCode ?? null,
        reconciliationReference: event.reconciliationReference ?? null,
        createdAt: new Date(now.getTime() + index),
      })),
    );
  }

  addAdministrator(workspaceId: string, userId: string): void {
    this.administrators.add(`${workspaceId}:${userId}`);
  }

  addPrincipal(
    workspaceId: string,
    principalId: string,
    status: "active" | "suspended" | "revoked" = "active",
  ): void {
    this.principals.set(principalId, { workspaceId, status });
  }

  addWorkflowBinding(input: {
    workspaceId: string;
    workflowId: string;
    workflowRevision: string;
    binding: import("@/types/credentials").WorkflowCredentialBinding;
  }): void {
    this.workflowBindings.set(
      [
        input.workspaceId,
        input.workflowId,
        input.workflowRevision,
        input.binding.nodeId,
        input.binding.operationIdentity,
      ].join("\u0000"),
      { ...input.binding },
    );
  }

  private manager(workspaceId: string, userId: string): boolean {
    return this.administrators.has(`${workspaceId}:${userId}`);
  }

  private humanReceiptKey(input: {
    workspaceId: string;
    actorUserId: string;
    receipt: { capabilityIdentity: string; idempotencyKey: string };
  }): string {
    return [
      input.workspaceId,
      input.actorUserId,
      input.receipt.capabilityIdentity,
      input.receipt.idempotencyKey,
    ].join("\u0000");
  }

  private replayHumanMutation<Value>(input: {
    workspaceId: string;
    actorUserId: string;
    receipt: {
      capabilityIdentity: string;
      idempotencyKey: string;
      requestFingerprint: string;
    };
  }): CredentialHumanMutationResult<Value> | null {
    const receipt = this.humanMutationReceipts.get(
      this.humanReceiptKey(input),
    );
    if (!receipt) return null;
    if (receipt.requestFingerprint !== input.receipt.requestFingerprint) {
      return { kind: "conflict" };
    }
    return {
      kind: "completed",
      value: structuredClone(receipt.value) as Value,
      replayed: true,
    };
  }

  private completeHumanMutation<Value>(
    input: {
      workspaceId: string;
      actorUserId: string;
      receipt: {
        capabilityIdentity: string;
        idempotencyKey: string;
        requestFingerprint: string;
      };
    },
    value: Value,
  ): CredentialHumanMutationResult<Value> {
    this.humanMutationReceipts.set(this.humanReceiptKey(input), {
      requestFingerprint: input.receipt.requestFingerprint,
      value: structuredClone(value),
    });
    return { kind: "completed", value: structuredClone(value), replayed: false };
  }

  async createProfile(
    input: Parameters<CredentialVaultRepository["createProfile"]>[0],
  ): Promise<CredentialHumanMutationResult<SafeCredentialProfile>> {
    if (!this.manager(input.workspaceId, input.actorUserId)) {
      return { kind: "unavailable" };
    }
    const replay = this.replayHumanMutation<SafeCredentialProfile>(input);
    if (replay) return replay;
    if (
      [...this.profiles.values()].some(
        (profile) =>
          profile.workspaceId === input.workspaceId &&
          profile.name === input.name &&
          !profile.deletedAt,
      )
    ) {
      return { kind: "unavailable" };
    }
    const profile: ProfileState = {
      id: input.id,
      workspaceId: input.workspaceId,
      name: input.name,
      provider: input.provider,
      slotId: input.slotId,
      slotName: input.slotName,
      status: "active",
      activeVersion: 1,
      secretHint: input.secretHint,
      rotatedAt: input.now,
      reprovisionable: false,
      deletedAt: null,
    };
    this.profiles.set(profile.id, profile);
    this.versions.set(input.versionId, {
      id: input.versionId,
      profileId: profile.id,
      version: 1,
      secretCiphertext: input.secretCiphertext,
      secretHint: input.secretHint,
      status: "active",
      createdByUserId: input.actorUserId,
      createdAt: input.now,
      usableUntil: null,
      revokedAt: null,
    });
    this.slots.set(input.slotId, {
      id: input.slotId,
      workspaceId: input.workspaceId,
      profileId: profile.id,
      name: input.slotName,
      provider: input.provider,
    });
    return this.completeHumanMutation(input, profile);
  }

  async reprovisionProfile(
    input: Parameters<CredentialVaultRepository["reprovisionProfile"]>[0],
  ): Promise<CredentialHumanMutationResult<SafeCredentialProfile>> {
    if (!this.manager(input.workspaceId, input.actorUserId)) {
      return { kind: "unavailable" };
    }
    const replay = this.replayHumanMutation<SafeCredentialProfile>(input);
    if (replay) return replay;
    const profile = this.profiles.get(input.profileId);
    if (
      !profile ||
      profile.workspaceId !== input.workspaceId ||
      profile.status !== "disabled"
    ) {
      return { kind: "unavailable" };
    }
    const versions = [...this.versions.values()]
      .filter((version) => version.profileId === profile.id)
      .sort((left, right) => right.version - left.version);
    if (
      versions.some(
        (version) => version.status === "active" && !version.revokedAt,
      )
    ) {
      return { kind: "unavailable" };
    }
    const nextVersion = (versions[0]?.version ?? 0) + 1;
    const existingSlot = [...this.slots.values()].find(
      (slot) =>
        slot.workspaceId === input.workspaceId &&
        slot.profileId === profile.id,
    );
    profile.provider = input.provider;
    profile.status = "active";
    profile.activeVersion = nextVersion;
    profile.secretHint = input.secretHint;
    profile.rotatedAt = input.now;
    profile.slotId = existingSlot?.id ?? input.slotId;
    profile.slotName = input.slotName;
    profile.reprovisionable = false;
    this.versions.set(input.versionId, {
      id: input.versionId,
      profileId: profile.id,
      version: nextVersion,
      secretCiphertext: input.secretCiphertext,
      secretHint: input.secretHint,
      status: "active",
      createdByUserId: input.actorUserId,
      createdAt: input.now,
      usableUntil: null,
      revokedAt: null,
    });
    this.slots.set(profile.slotId, {
      id: profile.slotId,
      workspaceId: input.workspaceId,
      profileId: profile.id,
      name: input.slotName,
      provider: input.provider,
    });
    return this.completeHumanMutation(input, profile);
  }

  async rotateProfile(
    input: Parameters<CredentialVaultRepository["rotateProfile"]>[0],
  ): Promise<CredentialHumanMutationResult<SafeCredentialProfile>> {
    if (!this.manager(input.workspaceId, input.actorUserId)) {
      return { kind: "unavailable" };
    }
    const replay = this.replayHumanMutation<SafeCredentialProfile>(input);
    if (replay) return replay;
    const profile = this.profiles.get(input.profileId);
    if (
      !profile ||
      profile.workspaceId !== input.workspaceId ||
      profile.status !== "active" ||
      profile.activeVersion !== input.expectedActiveVersion ||
      profile.deletedAt
    ) {
      return { kind: "unavailable" };
    }
    const active = [...this.versions.values()].find(
      (version) =>
        version.profileId === profile.id &&
        version.version === profile.activeVersion &&
        version.status === "active",
    );
    if (!active) return { kind: "unavailable" };
    active.status = "superseded";
    active.usableUntil = input.overlapUntil;
    const nextVersion = profile.activeVersion + 1;
    this.versions.set(input.versionId, {
      id: input.versionId,
      profileId: profile.id,
      version: nextVersion,
      secretCiphertext: input.secretCiphertext,
      secretHint: input.secretHint,
      status: "active",
      createdByUserId: input.actorUserId,
      createdAt: input.now,
      usableUntil: null,
      revokedAt: null,
    });
    profile.activeVersion = nextVersion;
    profile.secretHint = input.secretHint;
    profile.rotatedAt = input.now;
    return this.completeHumanMutation(input, profile);
  }

  async revokeVersion(
    input: Parameters<CredentialVaultRepository["revokeVersion"]>[0],
  ): Promise<boolean> {
    if (!this.manager(input.workspaceId, input.actorUserId)) return false;
    const profile = this.profiles.get(input.profileId);
    const version = [...this.versions.values()].find(
      (candidate) =>
        candidate.profileId === input.profileId &&
        candidate.version === input.version,
    );
    if (
      !profile ||
      profile.workspaceId !== input.workspaceId ||
      !version
    ) {
      return false;
    }
    if (version.status === "revoked") return true;
    version.status = "revoked";
    version.revokedAt = input.now;
    version.usableUntil = null;
    if (profile.activeVersion === version.version) {
      profile.status = "disabled";
      profile.activeVersion = null;
      profile.secretHint = null;
      profile.rotatedAt = null;
      profile.reprovisionable = true;
    }
    return true;
  }

  async setProfileStatus(
    input: Parameters<CredentialVaultRepository["setProfileStatus"]>[0],
  ): ReturnType<CredentialVaultRepository["setProfileStatus"]> {
    if (!this.manager(input.workspaceId, input.actorUserId)) {
      return { kind: "unavailable" };
    }
    const profile = this.profiles.get(input.profileId);
    if (!profile || profile.workspaceId !== input.workspaceId) {
      return { kind: "unavailable" };
    }
    if (input.status === "active") {
      const slot = [...this.slots.values()].find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.profileId === input.profileId &&
          candidate.provider === profile.provider,
      );
      const version = [...this.versions.values()].find(
        (candidate) =>
          candidate.profileId === input.profileId &&
          candidate.version === profile.activeVersion &&
          candidate.status === "active" &&
          !candidate.revokedAt,
      );
      if (!slot || !version) return { kind: "conflict" };
    }
    profile.status = input.status;
    return { kind: "completed", value: structuredClone(profile) };
  }

  async getSafeProfile(
    input: Parameters<CredentialVaultRepository["getSafeProfile"]>[0],
  ): Promise<SafeCredentialProfile | null> {
    const profile = this.profiles.get(input.profileId);
    return profile &&
      profile.workspaceId === input.workspaceId &&
      !profile.deletedAt
      ? structuredClone(profile)
      : null;
  }

  async listSafeProfiles(workspaceId: string): Promise<SafeCredentialProfile[]> {
    return [...this.profiles.values()]
      .filter(
        (profile) =>
          profile.workspaceId === workspaceId && !profile.deletedAt,
      )
      .map((profile) => structuredClone(profile));
  }

  async listSpendGrants(workspaceId: string): Promise<CredentialSpendGrant[]> {
    return [...this.grants.values()]
      .filter((grant) => grant.workspaceId === workspaceId)
      .map((grant) => ({
        ...structuredClone(grant),
        spentCents: this.spendEvents
          .filter(
            (event) =>
              event.spendGrantId === grant.id &&
              event.status !== "failed",
          )
          .reduce(
            (total, event) => total + event.priceCeilingCents,
            0,
          ),
      }));
  }

  async listAuditEvents(
    input: Parameters<CredentialVaultRepository["listAuditEvents"]>[0],
  ): Promise<import("@/types").CredentialAuditEvent[]> {
    return this.effectAuditEvents
      .filter(
        (event) =>
          event.workspaceId === input.workspaceId &&
          (!input.cursor ||
            event.createdAt < input.cursor.createdAt ||
            (event.createdAt.getTime() === input.cursor.createdAt.getTime() &&
              event.id < input.cursor.id)),
      )
      .map((event) => ({
        id: event.id,
        workspaceId: event.workspaceId,
        source: "credential" as const,
        eventType: event.eventType,
        outcome:
          event.eventType === "effect.reserved"
            ? ("pending" as const)
            : event.eventType === "effect.unknown"
              ? ("unknown" as const)
              : event.eventType === "effect.failed"
                ? ("failed" as const)
                : event.eventType === "effect.released"
                  ? ("released" as const)
                  : ("succeeded" as const),
        reason: event.failureCode,
        actorUserId: null,
        principalId: event.principalId,
        profileId: event.profileId,
        correlationRef:
          event.reconciliationReference ?? event.requestFingerprint,
        idempotencyKey: event.effectRef,
        effectRef: event.effectRef,
        effectSequence: event.effectSequence,
        createdAt: event.createdAt,
      }))
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      )
      .slice(0, input.limit);
  }

  async createSpendGrant(
    input: Parameters<CredentialVaultRepository["createSpendGrant"]>[0],
  ): Promise<CredentialHumanMutationResult<CredentialSpendGrant>> {
    if (!this.manager(input.workspaceId, input.actorUserId)) {
      return { kind: "unavailable" };
    }
    const replay = this.replayHumanMutation<CredentialSpendGrant>(input);
    if (replay) return replay;
    const profile = this.profiles.get(input.profileId);
    const principal = this.principals.get(input.principalId);
    const slot = [...this.slots.values()].find(
      (candidate) =>
        candidate.workspaceId === input.workspaceId &&
        candidate.profileId === input.profileId &&
        candidate.provider === profile?.provider,
    );
    const version = [...this.versions.values()].find(
      (candidate) =>
        candidate.profileId === input.profileId &&
        candidate.version === profile?.activeVersion &&
        candidate.status === "active" &&
        !candidate.revokedAt,
    );
    if (
      !principal ||
      principal.workspaceId !== input.workspaceId ||
      principal.status !== "active" ||
      !profile ||
      profile.workspaceId !== input.workspaceId ||
      profile.status !== "active" ||
      profile.deletedAt ||
      !slot ||
      !version
    ) {
      return { kind: "unavailable" };
    }
    for (const grant of this.grants.values()) {
      if (
        grant.workspaceId === input.workspaceId &&
        grant.principalId === input.principalId &&
        grant.profileId === input.profileId &&
        grant.status === "active"
      ) {
        return { kind: "unavailable" };
      }
    }
    const grant: CredentialSpendGrant = {
      id: input.id,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      profileId: input.profileId,
      mode: input.mode,
      limitCents: input.limitCents,
      spentCents: 0,
      status: "active",
      createdByUserId: input.actorUserId,
      createdAt: input.now,
      revokedAt: null,
    };
    this.grants.set(grant.id, grant);
    return this.completeHumanMutation(input, grant);
  }

  async revokeSpendGrant(
    input: Parameters<CredentialVaultRepository["revokeSpendGrant"]>[0],
  ): Promise<boolean> {
    if (!this.manager(input.workspaceId, input.actorUserId)) return false;
    const grant = this.grants.get(input.grantId);
    if (
      !grant ||
      grant.workspaceId !== input.workspaceId
    ) {
      return false;
    }
    if (grant.status === "revoked") return true;
    grant.status = "revoked";
    grant.revokedAt = input.now;
    return true;
  }

  async snapshotEffectTarget(
    input: Parameters<CredentialVaultRepository["snapshotEffectTarget"]>[0],
  ) {
    const slot = this.slots.get(input.slotId);
    if (!slot || slot.workspaceId !== input.workspaceId) return null;
    const profile = this.profiles.get(slot.profileId);
    if (
      !profile ||
      profile.workspaceId !== input.workspaceId ||
      profile.status !== "active" ||
      profile.deletedAt
    ) {
      return null;
    }
    const version = [...this.versions.values()].find(
      (candidate) =>
        candidate.profileId === profile.id &&
        candidate.version === profile.activeVersion &&
        candidate.status === "active" &&
        !candidate.revokedAt,
    );
    const grant = [...this.grants.values()].find(
      (candidate) =>
        candidate.workspaceId === input.workspaceId &&
        candidate.principalId === input.principalId &&
        candidate.profileId === profile.id &&
        candidate.status === "active" &&
        !candidate.revokedAt,
    );
    if (!version || !grant) return null;
    return {
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      slotId: slot.id,
      profileId: profile.id,
      versionId: version.id,
      version: version.version,
      provider: profile.provider,
      spendGrantId: grant.id,
    };
  }

  async resolveWorkflowStepBinding(
    input: Parameters<
      CredentialVaultRepository["resolveWorkflowStepBinding"]
    >[0],
  ) {
    return (
      this.workflowBindings.get(
        [
          input.workspaceId,
          input.step.workflowId,
          input.step.workflowRevision,
          input.step.nodeId,
          input.step.operationIdentity,
        ].join("\u0000"),
      ) ?? null
    );
  }

  async loadEffectMaterial(input: {
    intent: CredentialEffectIntent;
    now: Date;
  }) {
    const { intent } = input;
    const slot = this.slots.get(intent.slotId);
    const profile = this.profiles.get(intent.profileId);
    const version = this.versions.get(intent.versionId);
    const grant = this.grants.get(intent.spendGrantId);
    if (
      !slot ||
      slot.workspaceId !== intent.workspaceId ||
      slot.profileId !== intent.profileId ||
      !profile ||
      profile.workspaceId !== intent.workspaceId ||
      profile.status !== "active" ||
      profile.deletedAt ||
      !version ||
      version.profileId !== profile.id ||
      version.version !== intent.version ||
      version.status === "revoked" ||
      version.revokedAt ||
      (version.status === "superseded" &&
        (!version.usableUntil || version.usableUntil < input.now)) ||
      !grant ||
      grant.workspaceId !== intent.workspaceId ||
      grant.principalId !== intent.principalId ||
      grant.profileId !== profile.id ||
      grant.status !== "active" ||
      grant.revokedAt
    ) {
      return null;
    }
    return {
      workspaceId: intent.workspaceId,
      principalId: intent.principalId,
      slotId: intent.slotId,
      profileId: intent.profileId,
      versionId: intent.versionId,
      version: intent.version,
      provider: intent.provider,
      spendGrantId: intent.spendGrantId,
      secretCiphertext: version.secretCiphertext,
    };
  }

  async reserveEffect(
    input: Parameters<CredentialVaultRepository["reserveEffect"]>[0],
  ) {
    const existing = this.spendEvents.find(
      (event) =>
        event.workspaceId === input.intent.workspaceId &&
        event.effectRef === input.intent.effectRef,
    );
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        return { kind: "conflict" as const };
      }
      if (existing.status === "pending" || existing.status === "unknown") {
        return {
          kind: "reconciliation_required" as const,
          status: existing.status,
        };
      }
      if (existing.status !== "completed" || existing.safeResult === null) {
        return { kind: "unavailable" as const };
      }
      this.appendEffectAuditEvents(
        existing,
        [{ eventType: "effect.replayed" }],
        input.now,
      );
      return {
        kind: "completed" as const,
        target: {
          workspaceId: existing.workspaceId,
          principalId: existing.principalId,
          slotId: existing.slotId,
          profileId: existing.profileId,
          versionId: existing.versionId,
          version: existing.resolvedVersion,
          provider: existing.resolvedProvider,
          spendGrantId: existing.spendGrantId,
        },
        safeResult: existing.safeResult,
      };
    }
    if (
      !Number.isInteger(input.priceCeilingCents) ||
      input.priceCeilingCents < 0 ||
      input.priceCeilingCents > 2_147_483_647
    ) {
      return { kind: "unavailable" as const };
    }
    const material = await this.loadEffectMaterial({
      intent: input.intent,
      now: input.now,
    });
    if (!material) return { kind: "unavailable" as const };
    const grant = this.grants.get(input.intent.spendGrantId)!;
    const spentCents = this.spendEvents
      .filter(
        (event) =>
          event.spendGrantId === grant.id && event.status !== "failed",
      )
      .reduce(
        (total, event) => total + event.priceCeilingCents,
        0,
      );
    if (
      grant.mode === "bounded" &&
      (grant.limitCents === null ||
        spentCents + input.priceCeilingCents > grant.limitCents)
    ) {
      return { kind: "unavailable" as const };
    }
    const receipt: InMemoryCredentialVaultRepository["spendEvents"][number] = {
      id: input.eventId,
      workspaceId: input.intent.workspaceId,
      principalId: input.intent.principalId,
      slotId: input.intent.slotId,
      profileId: input.intent.profileId,
      versionId: input.intent.versionId,
      spendGrantId: grant.id,
      priceCeilingCents: input.priceCeilingCents,
      mode: grant.mode,
      effectRef: input.intent.effectRef,
      requestFingerprint: input.requestFingerprint,
      resolvedVersion: input.intent.version,
      resolvedProvider: input.intent.provider,
      status: "pending",
      safeResult: null,
      failureCode: null,
      completedAt: null,
      failedAt: null,
      unknownAt: null,
      reconciliationReference: null,
      reconciledAt: null,
      updatedAt: input.now,
      createdAt: input.now,
    };
    this.spendEvents.push(receipt);
    this.appendEffectAuditEvents(
      receipt,
      [{ eventType: "effect.reserved" }],
      input.now,
    );
    return {
      kind: "reserved" as const,
      target: material,
    };
  }

  async readEffectReceipt(
    input: Parameters<CredentialVaultRepository["readEffectReceipt"]>[0],
  ) {
    const existing = this.spendEvents.find(
      (event) =>
        event.workspaceId === input.workspaceId &&
        event.effectRef === input.effectRef,
    );
    if (!existing) return { kind: "absent" as const };
    if (existing.requestFingerprint !== input.requestFingerprint) {
      return { kind: "conflict" as const };
    }
    if (existing.status === "pending" || existing.status === "unknown") {
      return {
        kind: "reconciliation_required" as const,
        status: existing.status,
      };
    }
    if (existing.status !== "completed" || existing.safeResult === null) {
      return { kind: "unavailable" as const };
    }
    this.appendEffectAuditEvents(
      existing,
      [{ eventType: "effect.replayed" }],
      input.now,
    );
    return {
      kind: "completed" as const,
      target: {
        workspaceId: existing.workspaceId,
        principalId: existing.principalId,
        slotId: existing.slotId,
        profileId: existing.profileId,
        versionId: existing.versionId,
        version: existing.resolvedVersion,
        provider: existing.resolvedProvider,
        spendGrantId: existing.spendGrantId,
      },
      safeResult: existing.safeResult,
    };
  }

  async completeEffect(
    input: Parameters<CredentialVaultRepository["completeEffect"]>[0],
  ): Promise<boolean> {
    const receipt = this.findReceipt(input);
    if (!receipt) return false;
    if (receipt.status === "completed") return true;
    if (receipt.status !== "pending") return false;
    receipt.status = "completed";
    receipt.safeResult = input.safeResult;
    receipt.completedAt = input.now;
    receipt.updatedAt = input.now;
    this.appendEffectAuditEvents(
      receipt,
      [{ eventType: "effect.completed" }],
      input.now,
    );
    return true;
  }

  async failEffectBeforeStart(
    input: Parameters<CredentialVaultRepository["failEffectBeforeStart"]>[0],
  ): Promise<boolean> {
    return this.transitionPendingEffect({ ...input, status: "failed" });
  }

  async markEffectUnknown(
    input: Parameters<CredentialVaultRepository["markEffectUnknown"]>[0],
  ): Promise<boolean> {
    return this.transitionPendingEffect({ ...input, status: "unknown" });
  }

  private findReceipt(input: {
    workspaceId: string;
    effectRef: string;
    requestFingerprint: string;
  }) {
    return this.spendEvents.find(
      (event) =>
        event.workspaceId === input.workspaceId &&
        event.effectRef === input.effectRef &&
        event.requestFingerprint === input.requestFingerprint,
    );
  }

  private transitionPendingEffect(input: {
    workspaceId: string;
    effectRef: string;
    requestFingerprint: string;
    failureCode: string;
    status: "failed" | "unknown";
    now: Date;
  }): boolean {
    if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(input.failureCode)) return false;
    const receipt = this.findReceipt(input);
    if (!receipt) return false;
    if (
      receipt.status === input.status &&
      receipt.failureCode === input.failureCode
    ) {
      return true;
    }
    if (receipt.status !== "pending") return false;
    receipt.status = input.status;
    receipt.failureCode = input.failureCode;
    receipt.failedAt = input.status === "failed" ? input.now : null;
    receipt.unknownAt = input.status === "unknown" ? input.now : null;
    receipt.updatedAt = input.now;
    this.appendEffectAuditEvents(
      receipt,
      input.status === "failed"
        ? [
            {
              eventType: "effect.failed",
              failureCode: input.failureCode,
            },
            {
              eventType: "effect.released",
              failureCode: input.failureCode,
            },
          ]
        : [
            {
              eventType: "effect.unknown",
              failureCode: input.failureCode,
            },
          ],
      input.now,
    );
    return true;
  }

  async reconcileEffect(
    input: Parameters<CredentialVaultRepository["reconcileEffect"]>[0],
  ): Promise<boolean> {
    if (
      !input.reconciliationReference.trim() ||
      input.reconciliationReference.length > 200 ||
      (input.resolution.kind === "failed" &&
        !/^[A-Z][A-Z0-9_]{0,79}$/.test(input.resolution.failureCode))
    ) {
      return false;
    }
    const receipt = this.findReceipt(input);
    if (!receipt) return false;
    if (receipt.reconciliationReference !== null) {
      if (
        receipt.reconciliationReference !== input.reconciliationReference
      ) {
        return false;
      }
      return input.resolution.kind === "completed"
        ? receipt.status === "completed" &&
            JSON.stringify(receipt.safeResult) ===
              JSON.stringify(input.resolution.safeResult)
        : receipt.status === "failed" &&
            receipt.failureCode === input.resolution.failureCode;
    }
    if (receipt.status !== "pending" && receipt.status !== "unknown") {
      return false;
    }
    receipt.reconciliationReference = input.reconciliationReference;
    receipt.reconciledAt = input.now;
    receipt.unknownAt = null;
    receipt.updatedAt = input.now;
    const terminalEvents =
      input.resolution.kind === "completed"
        ? [{ eventType: "effect.completed" as const }]
        : [
            {
              eventType: "effect.failed" as const,
              failureCode: input.resolution.failureCode,
            },
            {
              eventType: "effect.released" as const,
              failureCode: input.resolution.failureCode,
            },
          ];
    if (input.resolution.kind === "completed") {
      receipt.status = "completed";
      receipt.safeResult = input.resolution.safeResult;
      receipt.failureCode = null;
      receipt.completedAt = input.now;
      receipt.failedAt = null;
    } else {
      receipt.status = "failed";
      receipt.safeResult = null;
      receipt.failureCode = input.resolution.failureCode;
      receipt.completedAt = null;
      receipt.failedAt = input.now;
    }
    this.appendEffectAuditEvents(
      receipt,
      [
        {
          eventType: "effect.reconciled",
          reconciliationReference: input.reconciliationReference,
        },
        ...terminalEvents,
      ],
      input.now,
    );
    return true;
  }
}
import { randomUUID } from "node:crypto";
