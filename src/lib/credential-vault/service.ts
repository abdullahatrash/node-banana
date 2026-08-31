import { randomUUID } from "node:crypto";
import type { AgentSecurityContext } from "@/types/agentAuth";
import type { CapabilityAuthorizer } from "@/types/agentAuthorization";
import type {
  CredentialEffectIntent,
  CredentialEffectResult,
  ImmutableWorkflowStepRef,
  CredentialAuditPage,
  CredentialProfileStatus,
  SafeCredentialProfile,
  SpendGrantMode,
  WorkflowCredentialBinding,
} from "@/types/credentials";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import type { CredentialSecretCipher } from "./crypto";
import type {
  CredentialProviderEffectAdapter,
  CredentialEffectRecoveryReceipt,
  CredentialSafeEffectResult,
  CredentialTransientEffectResult,
  CredentialVaultRepository,
} from "./types";

function transientResultContainsSecret(
  value: unknown,
  secret: string,
  seen = new WeakSet<object>(),
  representations?: readonly string[],
): boolean {
  const encodedRepresentations = representations ?? [
    secret,
    Buffer.from(secret, "utf8").toString("base64"),
    Buffer.from(secret, "utf8").toString("base64url"),
    Buffer.from(secret, "utf8").toString("hex"),
    encodeURIComponent(secret),
    new URLSearchParams({ value: secret })
      .toString()
      .slice("value=".length),
  ];
  if (typeof value === "string") {
    return encodedRepresentations.some((candidate) => value.includes(candidate));
  }
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const encoded = Buffer.from(bytes);
    return encodedRepresentations.some((candidate) =>
      encoded.includes(Buffer.from(candidate, "utf8")),
    );
  }
  return Object.entries(value).some(
    ([key, child]) =>
      /(?:secret|token|password|ciphertext)/i.test(key) ||
      transientResultContainsSecret(
        child,
        secret,
        seen,
        encodedRepresentations,
      ),
  );
}

export class CredentialVaultError extends CapabilityFailure {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "CONFLICT"
      | "CREDENTIAL_UNAVAILABLE"
      | "SPEND_NOT_AUTHORIZED"
      | "INVALID_INPUT",
    message: string,
  ) {
    super({
      code,
      category:
        code === "CONFLICT"
          ? "conflict"
          : code === "INVALID_INPUT"
            ? "validation"
            : "authorization",
      message,
    });
    this.name = "CredentialVaultError";
  }
}

export class CredentialProviderEffectError extends Error {
  constructor(
    readonly outcome: "not_started" | "unknown",
    readonly failureCode: string,
    message: string,
  ) {
    super(message);
    this.name = "CredentialProviderEffectError";
  }
}

function clean(value: string, label: string, max = 120): string {
  const result = value.trim();
  if (!result || result.length > max) {
    throw new CredentialVaultError(
      "INVALID_INPUT",
      `${label} must be between 1 and ${max} characters.`,
    );
  }
  return result;
}

function cleanSecret(value: string): string {
  if (
    value.length < 8 ||
    value.length > 10_000 ||
    value.trim().length === 0
  ) {
    throw new CredentialVaultError(
      "INVALID_INPUT",
      "Secret must be between 8 and 10000 characters.",
    );
  }
  return value;
}

function secretHint(secret: string): string {
  return `••••${secret.slice(-4)}`;
}

function effectRequestFingerprint(intent: CredentialEffectIntent): string {
  return canonicalDigest({
    workspaceId: intent.workspaceId,
    principalId: intent.principalId,
    slotId: intent.slotId,
    profileId: intent.profileId,
    versionId: intent.versionId,
    version: intent.version,
    spendGrantId: intent.spendGrantId,
    priceCeilingCents: intent.priceCeilingCents,
    provider: intent.provider,
    providerOperation: intent.providerOperation,
    providerIntentDigest: intent.providerIntentDigest,
    workflowStepRef: intent.workflowStepRef,
  });
}

function validateSafeEffectResult(
  value: CredentialSafeEffectResult,
): CredentialSafeEffectResult {
  const serialized = JSON.stringify(value);
  if (
    !serialized ||
    value === null ||
    Buffer.byteLength(serialized, "utf8") > 65_536 ||
    /"[^"]*(?:secret|token|password|ciphertext)[^"]*"\s*:/i.test(
      serialized,
    )
  ) {
    throw new CredentialVaultError(
      "INVALID_INPUT",
      "Durable provider settlement is invalid.",
    );
  }
  return JSON.parse(serialized) as CredentialSafeEffectResult;
}

function idempotencyKey(value: string): string {
  const key = value.trim();
  if (
    key.length < 8 ||
    key.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    throw new CredentialVaultError(
      "INVALID_INPUT",
      "Idempotency-Key must contain 8 to 200 printable characters.",
    );
  }
  return key;
}

function mutationConflict(): never {
  throw new CredentialVaultError(
    "CONFLICT",
    "Idempotency-Key was already used with a different request.",
  );
}

function encodeAuditCursor(
  workspaceId: string,
  createdAt: Date,
  id: string,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      workspaceId,
      createdAt: createdAt.toISOString(),
      id,
    }),
  ).toString("base64url");
}

function decodeAuditCursor(
  value: string,
  workspaceId: string,
): { createdAt: Date; id: string } {
  try {
    if (value.length > 1_024) throw new Error("oversized");
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const createdAt =
      typeof parsed.createdAt === "string"
        ? new Date(parsed.createdAt)
        : new Date(Number.NaN);
    if (
      parsed.v !== 1 ||
      parsed.workspaceId !== workspaceId ||
      typeof parsed.id !== "string" ||
      !parsed.id ||
      parsed.id.length > 200 ||
      Number.isNaN(createdAt.getTime())
    ) {
      throw new Error("invalid");
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new CredentialVaultError(
      "INVALID_INPUT",
      "Audit cursor is invalid or belongs to another Workspace.",
    );
  }
}

export class CredentialVaultService {
  constructor(
    private readonly repository: CredentialVaultRepository,
    private readonly cipher: CredentialSecretCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listProfiles(workspaceId: string): Promise<SafeCredentialProfile[]> {
    return this.repository.listSafeProfiles(workspaceId);
  }

  getSafeProfile(input: {
    workspaceId: string;
    profileId: string;
  }): Promise<SafeCredentialProfile | null> {
    return this.repository.getSafeProfile(input);
  }

  listSpendGrants(workspaceId: string) {
    return this.repository.listSpendGrants(workspaceId);
  }

  listAuditEvents(workspaceId: string): Promise<CredentialAuditPage["events"]>;
  listAuditEvents(input: {
    workspaceId: string;
    limit?: number;
    cursor?: string;
  }): Promise<CredentialAuditPage>;
  async listAuditEvents(
    request:
      | string
      | {
          workspaceId: string;
          limit?: number;
          cursor?: string;
        },
  ): Promise<CredentialAuditPage | CredentialAuditPage["events"]> {
    const legacy = typeof request === "string";
    const input = legacy ? { workspaceId: request } : request;
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
      throw new CredentialVaultError(
        "INVALID_INPUT",
        "Audit page limit must be between 1 and 250.",
      );
    }
    const cursor = input.cursor
      ? decodeAuditCursor(input.cursor, input.workspaceId)
      : null;
    const rows = await this.repository.listAuditEvents({
      workspaceId: input.workspaceId,
      limit: limit + 1,
      cursor,
    });
    const events = rows.slice(0, limit);
    const last = events.at(-1);
    const page = {
      events,
      nextCursor:
        rows.length > limit && last
          ? encodeAuditCursor(input.workspaceId, last.createdAt, last.id)
          : null,
    };
    return legacy ? page.events : page;
  }

  async createProfile(input: {
    workspaceId: string;
    actorUserId: string;
    idempotencyKey: string;
    name: string;
    provider: string;
    slotName: string;
    secret: string;
  }): Promise<SafeCredentialProfile> {
    const secret = cleanSecret(input.secret);
    const name = clean(input.name, "Credential Profile name");
    const provider = clean(input.provider, "Provider", 80);
    const slotName = clean(input.slotName, "Credential Slot name");
    const result = await this.repository.createProfile({
      id: randomUUID(),
      versionId: randomUUID(),
      slotId: randomUUID(),
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      name,
      provider,
      slotName,
      secretCiphertext: this.cipher.encrypt(secret),
      secretHint: secretHint(secret),
      now: this.now(),
      receipt: {
        capabilityIdentity: "credentials.profiles.create@1",
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        requestFingerprint: canonicalDigest({
          name,
          provider,
          slotName,
          secret,
        }),
      },
    });
    if (result.kind === "conflict") mutationConflict();
    if (result.kind === "unavailable") {
      throw new CredentialVaultError(
        "FORBIDDEN",
        "Credential Profile creation is not authorized.",
      );
    }
    return result.value;
  }

  async reprovisionProfile(input: {
    workspaceId: string;
    actorUserId: string;
    idempotencyKey: string;
    profileId: string;
    provider: string;
    slotName: string;
    secret: string;
  }): Promise<SafeCredentialProfile> {
    const secret = cleanSecret(input.secret);
    const profileId = clean(input.profileId, "Credential Profile ID", 200);
    const provider = clean(input.provider, "Provider", 80);
    const slotName = clean(input.slotName, "Credential Slot name");
    const result = await this.repository.reprovisionProfile({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      profileId,
      provider,
      slotName,
      versionId: randomUUID(),
      slotId: randomUUID(),
      secretCiphertext: this.cipher.encrypt(secret),
      secretHint: secretHint(secret),
      now: this.now(),
      receipt: {
        capabilityIdentity: "credentials.profiles.reprovision@1",
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        requestFingerprint: canonicalDigest({
          profileId,
          provider,
          slotName,
          secret,
        }),
      },
    });
    if (result.kind === "conflict") mutationConflict();
    if (result.kind === "unavailable") {
      throw new CredentialVaultError(
        "CONFLICT",
        "Only a disabled Credential Profile without a usable active version can be reprovisioned.",
      );
    }
    return result.value;
  }

  async rotateProfile(input: {
    workspaceId: string;
    actorUserId: string;
    idempotencyKey: string;
    profileId: string;
    expectedActiveVersion: number;
    overlapSeconds?: number;
    secret: string;
  }): Promise<SafeCredentialProfile> {
    const secret = cleanSecret(input.secret);
    const overlapSeconds = input.overlapSeconds ?? 0;
    if (
      !Number.isInteger(overlapSeconds) ||
      overlapSeconds < 0 ||
      overlapSeconds > 86_400
    ) {
      throw new CredentialVaultError(
        "INVALID_INPUT",
        "Credential rotation overlap must be between 0 and 86400 seconds.",
      );
    }
    const now = this.now();
    const profileId = clean(input.profileId, "Credential Profile ID", 200);
    const result = await this.repository.rotateProfile({
      profileId,
      versionId: randomUUID(),
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      expectedActiveVersion: input.expectedActiveVersion,
      overlapUntil:
        overlapSeconds === 0
          ? null
          : new Date(now.getTime() + overlapSeconds * 1000),
      secretCiphertext: this.cipher.encrypt(secret),
      secretHint: secretHint(secret),
      now,
      receipt: {
        capabilityIdentity: "credentials.profiles.rotate@1",
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        requestFingerprint: canonicalDigest({
          profileId,
          expectedActiveVersion: input.expectedActiveVersion,
          overlapSeconds,
          secret,
        }),
      },
    });
    if (result.kind === "conflict") mutationConflict();
    if (result.kind === "unavailable") {
      throw new CredentialVaultError(
        "CONFLICT",
        "Credential Profile rotation conflicted or is unavailable.",
      );
    }
    return result.value;
  }

  async revokeVersion(input: {
    workspaceId: string;
    actorUserId: string;
    profileId: string;
    version: number;
  }): Promise<void> {
    if (
      !Number.isInteger(input.version) ||
      input.version < 1 ||
      !(await this.repository.revokeVersion({ ...input, now: this.now() }))
    ) {
      throw new CredentialVaultError(
        "CONFLICT",
        "Credential version is unavailable or cannot be revoked.",
      );
    }
  }

  async setProfileStatus(input: {
    workspaceId: string;
    actorUserId: string;
    profileId: string;
    status: CredentialProfileStatus;
  }): Promise<SafeCredentialProfile> {
    const result = await this.repository.setProfileStatus({
      ...input,
      now: this.now(),
    });
    if (result.kind === "conflict") {
      throw new CredentialVaultError(
        "CONFLICT",
        "Credential Profile cannot be enabled without a usable Credential Slot and active unrevoked version; reprovision it first.",
      );
    }
    if (result.kind === "unavailable") {
      throw new CredentialVaultError(
        "FORBIDDEN",
        "Credential Profile mutation is not authorized.",
      );
    }
    return result.value;
  }

  async createSpendGrant(input: {
    workspaceId: string;
    actorUserId: string;
    idempotencyKey: string;
    principalId: string;
    profileId: string;
    mode: SpendGrantMode;
    limitCents?: number | null;
  }) {
    const limitCents =
      input.mode === "bounded" ? input.limitCents ?? null : null;
    if (
      (input.mode === "bounded" &&
        (!Number.isInteger(limitCents) ||
          (limitCents ?? 0) <= 0 ||
          (limitCents ?? 0) > 2_147_483_647)) ||
      (input.mode !== "bounded" && input.mode !== "audited_unbounded")
    ) {
      throw new CredentialVaultError(
        "INVALID_INPUT",
        "Choose a positive bounded Credential Spend Grant or audited unbounded spend.",
      );
    }
    const principalId = clean(input.principalId, "Agent Principal ID", 200);
    const profileId = clean(input.profileId, "Credential Profile ID", 200);
    const result = await this.repository.createSpendGrant({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      principalId,
      profileId,
      mode: input.mode,
      limitCents,
      now: this.now(),
      receipt: {
        capabilityIdentity: "credentials.spend_grants.create@1",
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        requestFingerprint: canonicalDigest({
          principalId,
          profileId,
          mode: input.mode,
          limitCents,
        }),
      },
    });
    if (result.kind === "conflict") mutationConflict();
    if (result.kind === "unavailable") {
      throw new CredentialVaultError(
        "FORBIDDEN",
        "Credential Spend Grant creation is not authorized.",
      );
    }
    return result.value;
  }

  async revokeSpendGrant(input: {
    workspaceId: string;
    actorUserId: string;
    grantId: string;
  }): Promise<void> {
    if (
      !(await this.repository.revokeSpendGrant({ ...input, now: this.now() }))
    ) {
      throw new CredentialVaultError(
        "FORBIDDEN",
        "Credential Spend Grant revocation is not authorized.",
      );
    }
  }

}

export class CredentialEffectExecutor {
  private readonly adapters: Map<string, CredentialProviderEffectAdapter>;

  constructor(
    private readonly repository: CredentialVaultRepository,
    private readonly cipher: CredentialSecretCipher,
    private readonly authorizer: CapabilityAuthorizer,
    private readonly authorization: {
      capability: { name: string; version: number };
      authorizationContractDigest: string;
    },
    adapters: CredentialProviderEffectAdapter[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  }

  private async reauthorize(
    securityContext: AgentSecurityContext,
    profileId: string,
  ): Promise<void> {
    const admission = await this.authorizer.authorize({
      securityContext: { kind: "agent", ...securityContext },
      audience: "agent",
      capability: this.authorization.capability,
      authorizationContractDigest:
        this.authorization.authorizationContractDigest,
      resources: [{ kind: "credential_profile", id: profileId }],
      resourceExtractionValid: true,
    });
    if (!admission.allowed) {
      throw new CredentialVaultError(
        "FORBIDDEN",
        "Credential effect authority is unavailable.",
      );
    }
  }

  async snapshotEffectIntent(input: {
    securityContext: AgentSecurityContext;
    binding: WorkflowCredentialBinding;
    workflowStepRef: ImmutableWorkflowStepRef;
    effectRef: string;
    providerIntent: Record<string, unknown>;
  }): Promise<CredentialEffectIntent> {
    const persistedBinding =
      await this.repository.resolveWorkflowStepBinding({
        workspaceId: input.securityContext.workspaceId,
        step: input.workflowStepRef,
      });
    if (
      !persistedBinding ||
      persistedBinding.slotId !== input.binding.slotId ||
      persistedBinding.nodeId !== input.binding.nodeId ||
      persistedBinding.operationIdentity !== input.binding.operationIdentity ||
      input.binding.nodeId !== input.workflowStepRef.nodeId ||
      input.binding.operationIdentity !==
        input.workflowStepRef.operationIdentity ||
      !input.workflowStepRef.workflowId.trim() ||
      !input.workflowStepRef.workflowRevision.trim()
    ) {
      throw new CredentialVaultError(
        "CONFLICT",
        "Credential binding does not match the immutable Workflow step.",
      );
    }
    const operationMatch =
      /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_.]*)@([1-9][0-9]*)$/.exec(
        input.binding.operationIdentity,
      );
    if (!operationMatch) {
      throw new CredentialVaultError(
        "INVALID_INPUT",
        "Workflow Credential binding requires an exact provider operation identity.",
      );
    }
    const target = await this.repository.snapshotEffectTarget({
      workspaceId: input.securityContext.workspaceId,
      principalId: input.securityContext.principalId,
      slotId: clean(input.binding.slotId, "Credential Slot ID", 200),
      now: this.now(),
    });
    if (!target) {
      throw new CredentialVaultError(
        "SPEND_NOT_AUTHORIZED",
        "Credential or spend authority is unavailable.",
      );
    }
    await this.reauthorize(input.securityContext, target.profileId);
    if (
      (operationMatch[1] === "google" ? "gemini" : operationMatch[1]) !==
      target.provider
    ) {
      throw new CredentialVaultError(
        "CONFLICT",
        "Workflow Credential binding provider does not match the resolved profile.",
      );
    }
    const adapter = this.adapters.get(target.provider);
    if (!adapter) {
      throw new CredentialVaultError(
        "CREDENTIAL_UNAVAILABLE",
        "No server-owned provider adapter is registered for this Credential Slot.",
      );
    }
    const providerOperation = clean(operationMatch[2], "Provider operation", 80);
    adapter.validate({
      operation: providerOperation,
      intent: input.providerIntent,
    });
    const { priceCeilingCents } = await adapter.quote({
      operation: providerOperation,
      intent: input.providerIntent,
    });
    if (
      !Number.isInteger(priceCeilingCents) ||
      priceCeilingCents < 0 ||
      priceCeilingCents > 2_147_483_647
    ) {
      throw new CredentialVaultError(
        "CREDENTIAL_UNAVAILABLE",
        "Provider adapter returned an invalid server price ceiling.",
      );
    }
    const snapshottedAt = this.now();
    return {
      ...target,
      effectRef: clean(input.effectRef, "Effect reference", 200),
      priceCeilingCents,
      providerOperation,
      workflowStepRef: { ...input.workflowStepRef },
      providerIntentDigest: canonicalDigest(input.providerIntent),
      snapshottedAt: snapshottedAt.toISOString(),
    };
  }

  /**
   * Executes a provider callback while the plaintext credential is scoped to
   * this stack frame. Only the caller-provided bounded summary is durable;
   * large generated bytes remain transient for immediate Artifact settlement.
   */
  async withCredentialMaterialForEffect<Result>(input: {
    securityContext: AgentSecurityContext;
    effectIntent: CredentialEffectIntent;
    providerIntent: Record<string, unknown>;
    invoke: (credential: {
      profileId: string;
      version: number;
      secret: string;
    }) => Promise<Result>;
    summarize: (result: Result) => CredentialSafeEffectResult;
    disposition?: (result: Result) =>
      | { kind: "completed" }
      | { kind: "failed_not_started"; failureCode: string }
      | { kind: "outcome_unknown"; failureCode: string };
  }): Promise<CredentialTransientEffectResult<Result>> {
    const { securityContext, effectIntent } = input;
    if (
      effectIntent.workspaceId !== securityContext.workspaceId ||
      effectIntent.principalId !== securityContext.principalId ||
      effectIntent.providerIntentDigest !==
        canonicalDigest(input.providerIntent)
    ) {
      throw new CredentialVaultError(
        "CONFLICT",
        "Credential effect intent does not match this request.",
      );
    }
    await this.reauthorize(securityContext, effectIntent.profileId);
    const requestFingerprint = effectRequestFingerprint(effectIntent);
    const existing = await this.repository.readEffectReceipt({
      workspaceId: effectIntent.workspaceId,
      effectRef: effectIntent.effectRef,
      requestFingerprint,
      now: this.now(),
    });
    if (existing.kind === "conflict") {
      throw new CredentialVaultError(
        "CONFLICT",
        "Effect reference was already used for a different request.",
      );
    }
    if (existing.kind === "reconciliation_required") {
      throw new CredentialVaultError(
        "CONFLICT",
        `Effect ${effectIntent.effectRef} is ${existing.status} and requires reconciliation before retry.`,
      );
    }
    if (existing.kind === "unavailable") {
      throw new CredentialVaultError(
        "SPEND_NOT_AUTHORIZED",
        "Credential effect receipt is unavailable for retry.",
      );
    }
    if (existing.kind === "completed") {
      return {
        effectRef: effectIntent.effectRef,
        profileId: existing.target.profileId,
        versionId: existing.target.versionId,
        version: existing.target.version,
        spendGrantId: existing.target.spendGrantId,
        replayed: true,
        safeResult: existing.safeResult,
      };
    }
    const material = await this.repository.loadEffectMaterial({
      intent: effectIntent,
      now: this.now(),
    });
    if (!material) {
      throw new CredentialVaultError(
        "CREDENTIAL_UNAVAILABLE",
        "The snapshotted Credential version is unavailable.",
      );
    }
    const secret = this.cipher.decrypt(material.secretCiphertext);
    const reservation = await this.repository.reserveEffect({
      intent: effectIntent,
      requestFingerprint,
      priceCeilingCents: effectIntent.priceCeilingCents,
      eventId: randomUUID(),
      now: this.now(),
    });
    if (reservation.kind === "conflict") {
      throw new CredentialVaultError(
        "CONFLICT",
        "Effect reference was already used for a different request.",
      );
    }
    if (reservation.kind === "unavailable") {
      throw new CredentialVaultError(
        "SPEND_NOT_AUTHORIZED",
        "Credential or spend authority is unavailable.",
      );
    }
    if (reservation.kind === "reconciliation_required") {
      throw new CredentialVaultError(
        "CONFLICT",
        `Effect ${effectIntent.effectRef} is ${reservation.status} and requires reconciliation before retry.`,
      );
    }
    if (reservation.kind === "completed") {
      return {
        effectRef: effectIntent.effectRef,
        profileId: reservation.target.profileId,
        versionId: reservation.target.versionId,
        version: reservation.target.version,
        spendGrantId: reservation.target.spendGrantId,
        replayed: true,
        safeResult: reservation.safeResult,
      };
    }
    let result: Result;
    try {
      result = await input.invoke({
        profileId: material.profileId,
        version: material.version,
        secret,
      });
    } catch (error) {
      const providerError =
        error instanceof CredentialProviderEffectError ? error : null;
      const persisted =
        providerError?.outcome === "not_started"
          ? await this.repository.failEffectBeforeStart({
              workspaceId: effectIntent.workspaceId,
              effectRef: effectIntent.effectRef,
              requestFingerprint,
              failureCode: providerError.failureCode,
              now: this.now(),
            })
          : await this.repository.markEffectUnknown({
              workspaceId: effectIntent.workspaceId,
              effectRef: effectIntent.effectRef,
              requestFingerprint,
              failureCode:
                providerError?.failureCode ?? "PROVIDER_OUTCOME_UNKNOWN",
              now: this.now(),
            });
      if (!persisted) {
        throw new CredentialVaultError(
          "CONFLICT",
          "Provider effect outcome could not be durably audited and requires operator reconciliation.",
        );
      }
      throw error;
    }
    let safeResult: CredentialSafeEffectResult;
    try {
      if (transientResultContainsSecret(result, secret)) {
        throw new Error("unsafe transient result");
      }
      safeResult = input.summarize(result);
      const serialized = JSON.stringify(safeResult);
      if (
        !serialized ||
        safeResult === null ||
        Buffer.byteLength(serialized, "utf8") > 65_536 ||
        serialized.includes(secret) ||
        /"[^"]*(?:secret|token|password|ciphertext)[^"]*"\s*:/i.test(
          serialized,
        )
      ) {
        throw new Error("unsafe summary");
      }
      safeResult = JSON.parse(serialized) as CredentialSafeEffectResult;
    } catch {
      await this.repository.markEffectUnknown({
        workspaceId: effectIntent.workspaceId,
        effectRef: effectIntent.effectRef,
        requestFingerprint,
        failureCode: "UNSAFE_PROVIDER_RESULT",
        now: this.now(),
      });
      throw new CredentialProviderEffectError(
        "unknown",
        "UNSAFE_PROVIDER_RESULT",
        "Provider effect summary requires reconciliation.",
      );
    }
    const disposition = input.disposition?.(result) ?? { kind: "completed" };
    if (disposition.kind === "failed_not_started") {
      if (
        !(await this.repository.failEffectBeforeStart({
          workspaceId: effectIntent.workspaceId,
          effectRef: effectIntent.effectRef,
          requestFingerprint,
          failureCode: disposition.failureCode,
          safeResult,
          now: this.now(),
        }))
      ) {
        throw new CredentialVaultError(
          "CONFLICT",
          "Provider rejection could not be durably audited.",
        );
      }
      return {
        effectRef: effectIntent.effectRef,
        profileId: reservation.target.profileId,
        versionId: reservation.target.versionId,
        version: reservation.target.version,
        spendGrantId: reservation.target.spendGrantId,
        replayed: false,
        result,
      };
    }
    if (disposition.kind === "outcome_unknown") {
      if (
        !(await this.repository.markEffectUnknown({
          workspaceId: effectIntent.workspaceId,
          effectRef: effectIntent.effectRef,
          requestFingerprint,
          failureCode: disposition.failureCode,
          now: this.now(),
        }))
      ) {
        throw new CredentialVaultError(
          "CONFLICT",
          "Ambiguous provider outcome could not be durably audited.",
        );
      }
      return {
        effectRef: effectIntent.effectRef,
        profileId: reservation.target.profileId,
        versionId: reservation.target.versionId,
        version: reservation.target.version,
        spendGrantId: reservation.target.spendGrantId,
        replayed: false,
        result,
      };
    }
    if (
      !(await this.repository.completeEffect({
        workspaceId: effectIntent.workspaceId,
        effectRef: effectIntent.effectRef,
        requestFingerprint,
        safeResult,
        now: this.now(),
      }))
    ) {
      await this.repository.markEffectUnknown({
        workspaceId: effectIntent.workspaceId,
        effectRef: effectIntent.effectRef,
        requestFingerprint,
        failureCode: "RECEIPT_COMPLETION_FAILED",
        now: this.now(),
      });
      throw new CredentialVaultError(
        "CONFLICT",
        "Provider effect completed but its receipt requires reconciliation.",
      );
    }
    return {
      effectRef: effectIntent.effectRef,
      profileId: reservation.target.profileId,
      versionId: reservation.target.versionId,
      version: reservation.target.version,
      spendGrantId: reservation.target.spendGrantId,
      replayed: false,
      result,
    };
  }

  /**
   * Converges a pending/unknown Credential receipt after provider output was
   * durably settled as an Artifact. This path never loads plaintext material.
   */
  async reconcileDurableEffect(input: {
    securityContext: AgentSecurityContext;
    effectRef: string;
    safeResult: CredentialSafeEffectResult;
    reconciliationReference: string;
  }): Promise<boolean> {
    const effectRef = clean(input.effectRef, "Effect reference", 200);
    const receipt = await this.inspectEffectForRecovery({
      securityContext: input.securityContext,
      effectRef,
    });
    if (receipt.kind !== "pending" && receipt.kind !== "unknown") return false;
    return this.repository.reconcileEffect({
      workspaceId: input.securityContext.workspaceId,
      effectRef,
      requestFingerprint: receipt.requestFingerprint,
      reconciliationReference: clean(
        input.reconciliationReference,
        "Reconciliation reference",
        200,
      ),
      resolution: {
        kind: "completed",
        safeResult: validateSafeEffectResult(input.safeResult),
      },
      now: this.now(),
    });
  }

  /** Reads a provider receipt without loading a Credential or launching work. */
  async inspectEffectForRecovery(input: {
    securityContext: AgentSecurityContext;
    effectRef: string;
  }): Promise<CredentialEffectRecoveryReceipt> {
    const effectRef = clean(input.effectRef, "Effect reference", 200);
    const receipt = await this.repository.inspectEffectReceipt({
      workspaceId: input.securityContext.workspaceId,
      effectRef,
    });
    if (receipt.kind === "absent") return receipt;
    if (
      receipt.target.workspaceId !== input.securityContext.workspaceId ||
      receipt.target.principalId !== input.securityContext.principalId
    ) {
      throw new CredentialVaultError(
        "FORBIDDEN",
        "Credential effect receipt is unavailable.",
      );
    }
    await this.reauthorize(input.securityContext, receipt.target.profileId);
    return receipt;
  }

  /**
   * The only interface that can use plaintext. Decryption and provider
   * invocation remain inside this module; returned values contain safe receipt
   * identifiers and provider output only.
   */
  async withCredentialForEffect(input: {
    securityContext: AgentSecurityContext;
    effectIntent: CredentialEffectIntent;
    providerIntent: Record<string, unknown>;
  }): Promise<CredentialEffectResult> {
    const { securityContext, effectIntent } = input;
    if (
      effectIntent.workspaceId !== securityContext.workspaceId ||
      effectIntent.principalId !== securityContext.principalId ||
      effectIntent.providerIntentDigest !==
        canonicalDigest(input.providerIntent)
    ) {
      throw new CredentialVaultError(
        "CONFLICT",
        "Credential effect intent does not match this request.",
      );
    }
    await this.reauthorize(securityContext, effectIntent.profileId);
    const requestFingerprint = effectRequestFingerprint(effectIntent);
    const existing = await this.repository.readEffectReceipt({
      workspaceId: effectIntent.workspaceId,
      effectRef: effectIntent.effectRef,
      requestFingerprint,
      now: this.now(),
    });
    if (existing.kind === "conflict") {
      throw new CredentialVaultError(
        "CONFLICT",
        "Effect reference was already used for a different request.",
      );
    }
    if (existing.kind === "reconciliation_required") {
      throw new CredentialVaultError(
        "CONFLICT",
        `Effect ${effectIntent.effectRef} is ${existing.status} and requires reconciliation before retry.`,
      );
    }
    if (existing.kind === "unavailable") {
      throw new CredentialVaultError(
        "SPEND_NOT_AUTHORIZED",
        "Credential effect receipt is unavailable for retry.",
      );
    }
    if (existing.kind === "completed") {
      return {
        effectRef: effectIntent.effectRef,
        profileId: existing.target.profileId,
        versionId: existing.target.versionId,
        version: existing.target.version,
        spendGrantId: existing.target.spendGrantId,
        replayed: true,
        result: existing.safeResult,
      };
    }
    const material = await this.repository.loadEffectMaterial({
      intent: effectIntent,
      now: this.now(),
    });
    if (!material) {
      throw new CredentialVaultError(
        "CREDENTIAL_UNAVAILABLE",
        "The snapshotted Credential version is unavailable.",
      );
    }
    const adapter = this.adapters.get(material.provider);
    if (!adapter) {
      throw new CredentialVaultError(
        "CREDENTIAL_UNAVAILABLE",
        "No server-owned provider adapter is registered for this Credential Slot.",
      );
    }
    adapter.validate({
      operation: effectIntent.providerOperation,
      intent: input.providerIntent,
    });
    // Key/configuration failure happens before any spend reservation.
    const secret = this.cipher.decrypt(material.secretCiphertext);
    const reservation = await this.repository.reserveEffect({
      intent: effectIntent,
      requestFingerprint,
      priceCeilingCents: effectIntent.priceCeilingCents,
      eventId: randomUUID(),
      now: this.now(),
    });
    if (reservation.kind === "conflict") {
      throw new CredentialVaultError(
        "CONFLICT",
        "Effect reference was already used for a different request.",
      );
    }
    if (reservation.kind === "unavailable") {
      throw new CredentialVaultError(
        "SPEND_NOT_AUTHORIZED",
        "Credential or spend authority is unavailable.",
      );
    }
    if (reservation.kind === "reconciliation_required") {
      throw new CredentialVaultError(
        "CONFLICT",
        `Effect ${effectIntent.effectRef} is ${reservation.status} and requires reconciliation before retry.`,
      );
    }
    if (reservation.kind === "completed") {
      return {
        effectRef: effectIntent.effectRef,
        profileId: reservation.target.profileId,
        versionId: reservation.target.versionId,
        version: reservation.target.version,
        spendGrantId: reservation.target.spendGrantId,
        replayed: true,
        result: reservation.safeResult,
      };
    }
    let result: unknown;
    try {
      result = await adapter.execute({
        operation: effectIntent.providerOperation,
        intent: input.providerIntent,
        credential: { secret },
        idempotencyKey: effectIntent.effectRef,
      });
    } catch (error) {
      const providerError =
        error instanceof CredentialProviderEffectError ? error : null;
      let persisted: boolean;
      if (providerError?.outcome === "not_started") {
        persisted = await this.repository.failEffectBeforeStart({
          workspaceId: effectIntent.workspaceId,
          effectRef: effectIntent.effectRef,
          requestFingerprint,
          failureCode: providerError.failureCode,
          now: this.now(),
        });
      } else {
        persisted = await this.repository.markEffectUnknown({
          workspaceId: effectIntent.workspaceId,
          effectRef: effectIntent.effectRef,
          requestFingerprint,
          failureCode: providerError?.failureCode ?? "PROVIDER_OUTCOME_UNKNOWN",
          now: this.now(),
        });
      }
      if (!persisted) {
        throw new CredentialVaultError(
          "CONFLICT",
          "Provider effect outcome could not be durably audited and requires operator reconciliation.",
        );
      }
      throw error;
    }
    const serialized = JSON.stringify(result);
    if (
      !serialized ||
      result === null ||
      Buffer.byteLength(serialized, "utf8") > 65_536 ||
      serialized.includes(secret) ||
      /"[^"]*(?:secret|token|password|ciphertext)[^"]*"\s*:/i.test(serialized)
    ) {
      const persisted = await this.repository.markEffectUnknown({
        workspaceId: effectIntent.workspaceId,
        effectRef: effectIntent.effectRef,
        requestFingerprint,
        failureCode: "UNSAFE_PROVIDER_RESULT",
        now: this.now(),
      });
      if (!persisted) {
        throw new CredentialVaultError(
          "CONFLICT",
          "Unsafe provider outcome could not be durably audited and requires operator reconciliation.",
        );
      }
      throw new CredentialVaultError(
        "CREDENTIAL_UNAVAILABLE",
        "Provider adapter returned forbidden Credential material.",
      );
    }
    const safeResult = JSON.parse(serialized) as CredentialSafeEffectResult;
    if (
      !(await this.repository.completeEffect({
        workspaceId: effectIntent.workspaceId,
        effectRef: effectIntent.effectRef,
        requestFingerprint,
        safeResult,
        now: this.now(),
      }))
    ) {
      await this.repository.markEffectUnknown({
        workspaceId: effectIntent.workspaceId,
        effectRef: effectIntent.effectRef,
        requestFingerprint,
        failureCode: "RECEIPT_COMPLETION_FAILED",
        now: this.now(),
      });
      throw new CredentialVaultError(
        "CONFLICT",
        "Provider effect completed but its receipt requires reconciliation.",
      );
    }
    return {
      effectRef: effectIntent.effectRef,
      profileId: reservation.target.profileId,
      versionId: reservation.target.versionId,
      version: reservation.target.version,
      spendGrantId: reservation.target.spendGrantId,
      replayed: false,
      result: safeResult,
    };
  }
}
