import { randomUUID } from "node:crypto";
import { isProductionLikeRuntime } from "@/lib/auth/features";
import { getDb } from "@/lib/db";
import {
  createOpaqueCredential,
  deriveOpaqueCredential,
  hashCredentialSecret,
  parseOpaqueCredential,
  verifyCredentialSecret,
} from "./crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { DrizzleAgentAuthRepository } from "./repository";
import { DrizzleAgentAuthorizationRepository } from "@/lib/agent-authorization/repository";
import type { AgentAuthorizationRepository } from "@/types/agentAuthorization";
import type {
  AgentAuthRepository,
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentPrincipalStatus,
  AgentPrincipalSummary,
  AgentSecurityContext,
  PairingChallengeRecord,
  PairingRateLimitAction,
} from "./types";
import type {
  AgentCapabilityGrant,
  AgentKeyAuthorizationScope,
  AgentResourceConstraints,
} from "@/types/agentAuthorization";

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_KEY_LIFETIME_MS = 366 * 24 * 60 * 60 * 1000;
const PAIRING_RATE_LIMITS: Record<
  PairingRateLimitAction,
  { limit: number; windowMs: number }
> = {
  challenge_create: { limit: 6, windowMs: 10 * 60 * 1000 },
  challenge_redeem: { limit: 20, windowMs: 10 * 60 * 1000 },
};

export type AgentAuthErrorCode =
  | "AGENT_AUTHENTICATION_FAILED"
  | "AGENT_PRINCIPAL_SUSPENDED"
  | "AGENT_PRINCIPAL_REVOKED"
  | "AGENT_SPONSOR_LOST"
  | "AGENT_WORKSPACE_UNAVAILABLE"
  | "PAIRING_CHALLENGE_INVALID"
  | "PAIRING_CHALLENGE_EXPIRED"
  | "PAIRING_CHALLENGE_REPLAYED"
  | "PAIRING_CHALLENGE_NOT_APPROVED"
  | "PAIRING_RATE_LIMITED"
  | "PAIRING_SPONSOR_FORBIDDEN"
  | "AGENT_PRINCIPAL_NOT_FOUND"
  | "AGENT_KEY_NOT_FOUND"
  | "AGENT_AUTHORITY_CONFLICT";

export class AgentAuthError extends Error {
  constructor(
    readonly code: AgentAuthErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AgentAuthError";
  }
}

export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentValidationError";
  }
}

export interface AgentAuthClock {
  now(): Date;
}

const systemClock: AgentAuthClock = { now: () => new Date() };

export interface AgentKeyPepperConfig {
  peppers: Readonly<Record<number, string>>;
  activeVersion: number;
}

const MAX_POSTGRES_INTEGER = 2_147_483_647;

function parseAgentPepperVersion(
  value: string,
  variableName: string,
): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${variableName} must be a positive PostgreSQL integer.`);
  }
  const version = Number(value);
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > MAX_POSTGRES_INTEGER
  ) {
    throw new Error(`${variableName} must be a positive PostgreSQL integer.`);
  }
  return version;
}

export function loadAgentKeyPepperConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  productionLike =
    isProductionLikeRuntime() || env.VERCEL_ENV === "production",
): AgentKeyPepperConfig {
  const serializedKeyring = env.AGENT_KEY_PEPPERS?.trim();
  const serializedActiveVersion =
    env.AGENT_KEY_PEPPER_ACTIVE_VERSION?.trim();
  const legacyPepper = env.AGENT_KEY_PEPPER?.trim();

  if (serializedKeyring) {
    if (!serializedActiveVersion) {
      throw new Error(
        "AGENT_KEY_PEPPER_ACTIVE_VERSION is required with AGENT_KEY_PEPPERS.",
      );
    }
    const activeVersion = parseAgentPepperVersion(
      serializedActiveVersion,
      "AGENT_KEY_PEPPER_ACTIVE_VERSION",
    );
    const peppers: Record<number, string> = {};
    const seen = new Set<number>();
    for (const rawEntry of serializedKeyring.split(",")) {
      const entry = rawEntry.trim();
      const separator = entry.indexOf("=");
      if (separator <= 0 || separator === entry.length - 1) {
        throw new Error(
          "AGENT_KEY_PEPPERS must use version=base64url entries.",
        );
      }
      const versionText = entry.slice(0, separator).trim();
      const pepper = entry.slice(separator + 1).trim();
      if (!/^[A-Za-z0-9_-]{32,}$/.test(pepper)) {
        throw new Error(
          "AGENT_KEY_PEPPERS contains an invalid version or pepper.",
        );
      }
      const version = parseAgentPepperVersion(
        versionText,
        "AGENT_KEY_PEPPERS version",
      );
      if (seen.has(version)) {
        throw new Error("AGENT_KEY_PEPPERS contains a duplicate version.");
      }
      seen.add(version);
      peppers[version] = pepper;
    }
    if (!peppers[activeVersion]) {
      throw new Error(
        "AGENT_KEY_PEPPER_ACTIVE_VERSION is missing from AGENT_KEY_PEPPERS.",
      );
    }
    return { peppers, activeVersion };
  }

  if (serializedActiveVersion) {
    throw new Error(
      "AGENT_KEY_PEPPERS is required with AGENT_KEY_PEPPER_ACTIVE_VERSION.",
    );
  }
  if (legacyPepper) {
    return { peppers: { 1: legacyPepper }, activeVersion: 1 };
  }
  if (productionLike) {
    throw new Error(
      "AGENT_KEY_PEPPER or AGENT_KEY_PEPPERS must be set in production.",
    );
  }
  return {
    peppers: {
      1: "node-banana-local-agent-pepper-change-before-production",
    },
    activeVersion: 1,
  };
}

function authenticationFailed(): AgentAuthError {
  return new AgentAuthError(
    "AGENT_AUTHENTICATION_FAILED",
    "Agent authentication failed.",
  );
}

function cleanName(value: string, label: string): string {
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new AgentValidationError(
      `${label} must be between 1 and 120 characters.`,
    );
  }
  return name;
}

function cleanAccess(values: string[]): string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (
    unique.length === 0 ||
    unique.length > 32 ||
    unique.some((value) => value.length > 120)
  ) {
    throw new AgentValidationError(
      "requestedAccess must contain 1 to 32 access names.",
    );
  }
  return unique;
}

function cleanResourceConstraints(
  resources: AgentResourceConstraints,
): AgentResourceConstraints {
  const clean = (values: string[]) => {
    const normalized = [...new Set(values.map((value) => value.trim()))];
    if (
      normalized.length > 256 ||
      normalized.some((value) => !value || value.length > 200)
    ) {
      throw new AgentValidationError("Key resource constraints are invalid.");
    }
    return normalized.sort();
  };
  return {
    channelIds: clean(resources.channelIds),
    credentialProfileIds: clean(resources.credentialProfileIds),
    workflowIds: clean(resources.workflowIds),
    automationIds: clean(resources.automationIds),
    artifactIds: clean(resources.artifactIds ?? []),
  };
}

function cleanKeyScopes(
  values: AgentKeyAuthorizationScope[],
): AgentKeyAuthorizationScope[] {
  const seen = new Set<string>();
  return values.map((scope) => {
    const capability = scope.capability.trim();
    const authorizationContractDigest =
      scope.authorizationContractDigest.trim();
    if (
      seen.has(capability) ||
      !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+@[1-9][0-9]*$/.test(
        capability,
      ) ||
      !/^sha256:[a-f0-9]{64}$/.test(authorizationContractDigest)
    ) {
      throw new AgentValidationError(
        "Key scopes must use unique exact capability identities.",
      );
    }
    seen.add(capability);
    return {
      capability,
      authorizationContractDigest,
      resources: cleanResourceConstraints(scope.resources),
    };
  });
}

function cleanExpiry(
  expiresAt: Date | null | undefined,
  now: Date,
): Date | null {
  if (!expiresAt) return null;
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= now.getTime() ||
    expiresAt.getTime() - now.getTime() > MAX_KEY_LIFETIME_MS
  ) {
    throw new AgentValidationError(
      "Key expiry must be in the future and no more than 366 days away.",
    );
  }
  return expiresAt;
}

export class AgentAuthService {
  constructor(
    readonly repository: AgentAuthRepository,
    private readonly clock: AgentAuthClock = systemClock,
    private readonly peppers: Readonly<Record<number, string>> =
      loadAgentKeyPepperConfig().peppers,
    private readonly currentPepperVersion =
      loadAgentKeyPepperConfig().activeVersion,
    private readonly authorizationRepository?: Pick<
      AgentAuthorizationRepository,
      "issueAttenuatedKey" | "provisionAuthority"
    >,
  ) {}

  private get currentPepper(): string {
    const pepper = this.peppers[this.currentPepperVersion];
    if (!pepper) {
      throw new Error(
        `Agent credential pepper version ${this.currentPepperVersion} is unavailable.`,
      );
    }
    return pepper;
  }

  async createPairingChallenge(input: {
    agentName: string;
    keyName?: string;
    requestedAccess: string[];
    clientRateLimitKey?: string;
    ttlMs?: number;
  }): Promise<{
    challenge: string;
    confirmationId: string;
    expiresAt: string;
  }> {
    await this.enforcePairingRateLimit(
      "challenge_create",
      input.clientRateLimitKey ?? "shared-service-client",
    );
    const now = this.clock.now();
    const ttlMs = input.ttlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    if (
      !Number.isInteger(ttlMs) ||
      ttlMs < 30_000 ||
      ttlMs > MAX_CHALLENGE_TTL_MS
    ) {
      throw new AgentValidationError(
        "Pairing challenge TTL must be 30 seconds to 10 minutes.",
      );
    }
    const credential = createOpaqueCredential("challenge");
    const challenge: PairingChallengeRecord = {
      id: randomUUID(),
      lookupPrefix: credential.lookupPrefix,
      secretHash: hashCredentialSecret(credential.secret, this.currentPepper),
      pepperVersion: this.currentPepperVersion,
      agentName: cleanName(input.agentName, "Agent name"),
      keyName: cleanName(input.keyName ?? "Initial key", "Key name"),
      requestedAccess: cleanAccess(input.requestedAccess),
      expiresAt: new Date(now.getTime() + ttlMs),
      approvedWorkspaceId: null,
      approvedByUserId: null,
      approvedAt: null,
      consumedAt: null,
      createdAt: now,
    };
    await this.repository.createPairingChallenge(challenge);
    await this.repository.cleanupPairingSecurityState(now);
    return {
      challenge: credential.plaintext,
      confirmationId: credential.lookupPrefix,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async inspectPairingChallenge(plaintext: string): Promise<{
    agentName: string;
    keyName: string;
    requestedAccess: string[];
    expiresAt: string;
  }> {
    const challenge = await this.resolveUsableChallenge(plaintext);
    return {
      agentName: challenge.agentName,
      keyName: challenge.keyName,
      requestedAccess: [...challenge.requestedAccess],
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async inspectPairingConfirmation(confirmationId: string): Promise<{
    agentName: string;
    keyName: string;
    requestedAccess: string[];
    expiresAt: string;
  }> {
    const challenge =
      await this.resolveUsableConfirmationId(confirmationId);
    return {
      agentName: challenge.agentName,
      keyName: challenge.keyName,
      requestedAccess: [...challenge.requestedAccess],
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async approvePairing(input: {
    challenge: string;
    workspaceId: string;
    sponsorUserId: string;
  }): Promise<{
    approved: true;
    workspaceId: string;
    agentName: string;
    requestedAccess: string[];
  }> {
    const challenge = await this.resolveUsableChallenge(input.challenge);
    const result = await this.repository.approvePairing({
      challengeId: challenge.id,
      workspaceId: input.workspaceId,
      sponsorUserId: input.sponsorUserId,
      now: this.clock.now(),
    });
    if (result.type === "sponsor_forbidden") {
      throw new AgentAuthError(
        "PAIRING_SPONSOR_FORBIDDEN",
        "Only a Workspace owner or admin can sponsor an Agent.",
      );
    }
    if (result.type === "challenge_unavailable") {
      const latest = await this.repository.findPairingChallengeByPrefix(
        challenge.lookupPrefix,
      );
      throw this.challengeUnavailableError(latest);
    }
    return {
      approved: true,
      workspaceId: input.workspaceId,
      agentName: challenge.agentName,
      requestedAccess: [...challenge.requestedAccess],
    };
  }

  async approvePairingConfirmation(input: {
    confirmationId: string;
    workspaceId: string;
    sponsorUserId: string;
  }): Promise<{
    approved: true;
    workspaceId: string;
    agentName: string;
    requestedAccess: string[];
  }> {
    const challenge = await this.resolveUsableConfirmationId(
      input.confirmationId,
    );
    const result = await this.repository.approvePairing({
      challengeId: challenge.id,
      workspaceId: input.workspaceId,
      sponsorUserId: input.sponsorUserId,
      now: this.clock.now(),
    });
    if (result.type === "sponsor_forbidden") {
      throw new AgentAuthError(
        "PAIRING_SPONSOR_FORBIDDEN",
        "Only a Workspace owner or admin can sponsor an Agent.",
      );
    }
    if (result.type === "challenge_unavailable") {
      const latest = await this.repository.findPairingChallengeByPrefix(
        challenge.lookupPrefix,
      );
      throw this.challengeUnavailableError(latest);
    }
    return {
      approved: true,
      workspaceId: input.workspaceId,
      agentName: challenge.agentName,
      requestedAccess: [...challenge.requestedAccess],
    };
  }

  /**
   * The local Agent redeems an approved challenge. The repository consumes it
   * and writes Principal + key in one transaction. If the response is lost,
   * replay is refused and the operator must pair again.
   */
  async redeemPairing(input: {
    challenge: string;
    clientRateLimitKey?: string;
    keyExpiresAt?: Date | null;
  }): Promise<{
    agentKey: string;
    principal: {
      id: string;
      workspaceId: string;
      sponsorUserId: string;
      name: string;
      status: "active";
    };
    key: {
      id: string;
      name: string;
      lookupPrefix: string;
      expiresAt: string | null;
    };
  }> {
    await this.enforcePairingRateLimit(
      "challenge_redeem",
      input.clientRateLimitKey ?? "shared-service-client",
    );
    const now = this.clock.now();
    const challenge = await this.resolveUsableChallenge(input.challenge);
    if (
      !challenge.approvedAt ||
      !challenge.approvedWorkspaceId ||
      !challenge.approvedByUserId
    ) {
      throw new AgentAuthError(
        "PAIRING_CHALLENGE_NOT_APPROVED",
        "A signed-in Workspace owner or admin must approve this pairing.",
      );
    }
    const keyCredential = createOpaqueCredential("key");
    const principal: AgentPrincipalRecord = {
      id: randomUUID(),
      workspaceId: challenge.approvedWorkspaceId,
      sponsorUserId: challenge.approvedByUserId,
      name: challenge.agentName,
      requestedAccess: [...challenge.requestedAccess],
      status: "active",
      suspendedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const key: AgentKeyRecord = {
      id: randomUUID(),
      principalId: principal.id,
      name: challenge.keyName,
      lookupPrefix: keyCredential.lookupPrefix,
      secretHash: hashCredentialSecret(keyCredential.secret, this.currentPepper),
      pepperVersion: this.currentPepperVersion,
      authorizationScopes: [],
      expiresAt: cleanExpiry(input.keyExpiresAt, now),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    };
    const result = await this.repository.completePairing({
      challengeId: challenge.id,
      principal,
      key,
      now,
    });
    if (result.type === "sponsor_forbidden") {
      throw new AgentAuthError(
        "PAIRING_SPONSOR_FORBIDDEN",
        "The approving sponsor must still be a Workspace owner or admin.",
      );
    }
    if (result.type === "challenge_unavailable") {
      const latest = await this.repository.findPairingChallengeByPrefix(
        challenge.lookupPrefix,
      );
      throw this.challengeUnavailableError(latest);
    }
    return {
      agentKey: keyCredential.plaintext,
      principal: {
        id: principal.id,
        workspaceId: principal.workspaceId,
        sponsorUserId: challenge.approvedByUserId,
        name: principal.name,
        status: "active",
      },
      key: {
        id: key.id,
        name: key.name,
        lookupPrefix: key.lookupPrefix,
        expiresAt: key.expiresAt?.toISOString() ?? null,
      },
    };
  }

  async authenticateAgentKey(
    plaintext: string | null | undefined,
  ): Promise<AgentSecurityContext> {
    const { context, record } =
      await this.resolveAgentKeyRecordForAdmission(plaintext);
    const now = this.clock.now();
    if (
      record.key.revokedAt ||
      (record.key.expiresAt &&
        record.key.expiresAt.getTime() <= now.getTime())
    ) {
      throw authenticationFailed();
    }
    if (record.principal.status === "suspended") {
      throw new AgentAuthError(
        "AGENT_PRINCIPAL_SUSPENDED",
        "The Agent Principal is suspended.",
      );
    }
    if (record.principal.status === "revoked" || record.principal.revokedAt) {
      throw new AgentAuthError(
        "AGENT_PRINCIPAL_REVOKED",
        "The Agent Principal is revoked.",
      );
    }
    await this.repository.recordKeyUsed(record.key.id, now);
    return context;
  }

  async resolveAgentKeyForAdmission(
    plaintext: string | null | undefined,
  ): Promise<AgentSecurityContext> {
    const { context, record } =
      await this.resolveAgentKeyRecordForAdmission(plaintext);
    const now = this.clock.now();
    if (
      !record.key.revokedAt &&
      (!record.key.expiresAt || record.key.expiresAt.getTime() > now.getTime()) &&
      record.principal.status === "active" &&
      !record.principal.revokedAt
    ) {
      await this.repository.recordKeyUsed(record.key.id, now);
    }
    return context;
  }

  private async resolveAgentKeyRecordForAdmission(
    plaintext: string | null | undefined,
  ) {
    const parsed = plaintext
      ? parseOpaqueCredential(plaintext, "key")
      : null;
    if (!parsed) throw authenticationFailed();

    const record =
      await this.repository.findAuthenticationRecordByPrefix(
        parsed.lookupPrefix,
      );
    if (
      !record ||
      !verifyCredentialSecret(
        parsed.secret,
        record.key.secretHash,
        this.peppers[record.key.pepperVersion] ?? "",
      )
    ) {
      throw authenticationFailed();
    }
    if (
      !record.principal.sponsorUserId ||
      !record.sponsorIsWorkspaceAdmin
    ) {
      throw new AgentAuthError(
        "AGENT_SPONSOR_LOST",
        "The Agent Principal no longer has an owner/admin Workspace sponsor.",
      );
    }
    if (!record.workspaceIsActive) {
      throw new AgentAuthError(
        "AGENT_WORKSPACE_UNAVAILABLE",
        "The Agent Principal's Workspace is unavailable.",
      );
    }
    return {
      context: {
        principalId: record.principal.id,
        workspaceId: record.principal.workspaceId,
        keyId: record.key.id,
      },
      record,
    };
  }

  async rotateKey(input: {
    principalId: string;
    workspaceId: string;
    actorUserId: string;
    name: string;
    authorizationScopes?: AgentKeyAuthorizationScope[];
    expiresAt?: Date | null;
  }): Promise<{ agentKey: string; key: Omit<AgentKeyRecord, "secretHash"> }> {
    const principal = await this.repository.findPrincipalForActor(
      input.principalId,
      input.workspaceId,
      input.actorUserId,
    );
    if (!principal) {
      throw new AgentAuthError(
        "AGENT_PRINCIPAL_NOT_FOUND",
        "Agent Principal was not found in an accessible Workspace.",
      );
    }
    if (principal.status === "revoked") {
      throw new AgentAuthError(
        "AGENT_PRINCIPAL_REVOKED",
        "A revoked Agent Principal cannot receive new keys.",
      );
    }
    const now = this.clock.now();
    const credential = createOpaqueCredential("key");
    const key: AgentKeyRecord = {
      id: randomUUID(),
      principalId: principal.id,
      name: cleanName(input.name, "Key name"),
      lookupPrefix: credential.lookupPrefix,
      secretHash: hashCredentialSecret(credential.secret, this.currentPepper),
      pepperVersion: this.currentPepperVersion,
      authorizationScopes: cleanKeyScopes(input.authorizationScopes ?? []),
      expiresAt: cleanExpiry(input.expiresAt, now),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    };
    const issued = await this.authorizationRepository?.issueAttenuatedKey({
      workspaceId: input.workspaceId,
      principalId: principal.id,
      actorUserId: input.actorUserId,
      key,
      now,
    });
    if (!issued) {
      throw new AgentValidationError(
        "Requested key authority exceeds the Principal's active Grant Set, Workspace policy, or live resources.",
      );
    }
    const { secretHash: _secretHash, ...safeKey } = key;
    return { agentKey: credential.plaintext, key: safeKey };
  }

  async provisionAuthority(input: {
    workspaceId: string;
    principalId: string;
    actorUserId: string;
    requestId: string;
    grantSetId?: string;
    grantSetName: string;
    expectedGrantRevision?: number;
    expectedPolicyRevision: number;
    grants: AgentCapabilityGrant[];
    policyGrants: AgentCapabilityGrant[];
    key: {
      name: string;
      authorizationScopes: AgentKeyAuthorizationScope[];
      expiresAt?: Date | null;
    };
  }): Promise<{
    agentKey: string;
    key: Omit<AgentKeyRecord, "secretHash">;
    grantSetId: string;
    grantRevisionId: string;
    grantRevision: number;
    policyRevisionId: string;
    policyRevision: number;
  }> {
    if (!this.authorizationRepository) {
      throw new AgentValidationError("Agent authority provisioning is unavailable.");
    }
    const now = this.clock.now();
    const expiresAt = cleanExpiry(input.key.expiresAt, now);
    const authorizationScopes = cleanKeyScopes(input.key.authorizationScopes);
    const requestFingerprint = canonicalDigest({
      principalId: input.principalId,
      grantSetId: input.grantSetId ?? null,
      grantSetName: input.grantSetName.trim(),
      expectedGrantRevision: input.expectedGrantRevision ?? null,
      expectedPolicyRevision: input.expectedPolicyRevision,
      grants: input.grants,
      policyGrants: input.policyGrants,
      key: {
        name: input.key.name.trim(),
        authorizationScopes,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });
    const derivationMaterial =
      `${input.workspaceId}:${input.actorUserId}:${input.requestId}:${requestFingerprint}`;
    const credential = deriveOpaqueCredential(
      "key",
      derivationMaterial,
      this.currentPepper,
    );
    const key: AgentKeyRecord = {
      id: randomUUID(),
      principalId: input.principalId,
      name: cleanName(input.key.name, "Key name"),
      lookupPrefix: credential.lookupPrefix,
      secretHash: hashCredentialSecret(credential.secret, this.currentPepper),
      pepperVersion: this.currentPepperVersion,
      authorizationScopes,
      expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    };
    const result = await this.authorizationRepository.provisionAuthority({
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      requestFingerprint,
      grantSetId: input.grantSetId,
      grantSetName: cleanName(input.grantSetName, "Grant Set name"),
      expectedGrantRevision: input.expectedGrantRevision,
      expectedPolicyRevision: input.expectedPolicyRevision,
      grants: input.grants,
      policyGrants: input.policyGrants,
      key,
      now,
    });
    if (result.type !== "created" && result.type !== "replayed") {
      if (result.type === "conflict") {
        throw new AgentAuthError(
          "AGENT_AUTHORITY_CONFLICT",
          "Authority revisions changed or the request ID was reused with different content; reload and retry.",
        );
      }
      throw new AgentValidationError(
        result.type === "forbidden"
            ? "Workspace owner or admin authority is required."
            : "Requested authority is invalid or exceeds live Workspace resources.",
      );
    }
    const resultPepper = this.peppers[result.key.pepperVersion];
    if (!resultPepper) {
      throw new AgentValidationError(
        "The provisioning result requires an unavailable credential pepper version.",
      );
    }
    const responseCredential = deriveOpaqueCredential(
      "key",
      derivationMaterial,
      resultPepper,
    );
    if (
      !verifyCredentialSecret(
        responseCredential.secret,
        result.key.secretHash,
        resultPepper,
      )
    ) {
      throw new AgentValidationError(
        "The provisioning result failed credential integrity verification.",
      );
    }
    const { secretHash: _secretHash, ...safeKey } = result.key;
    const { type: _type, key: _storedKey, ...provisioned } = result;
    return {
      agentKey: responseCredential.plaintext,
      key: safeKey,
      ...provisioned,
    };
  }

  async revokeKey(input: {
    keyId: string;
    workspaceId: string;
    actorUserId: string;
  }): Promise<void> {
    const revoked = await this.repository.revokeKey({
      ...input,
      revokedAt: this.clock.now(),
    });
    if (!revoked) {
      throw new AgentAuthError(
        "AGENT_KEY_NOT_FOUND",
        "Agent Key was not found in an accessible Workspace.",
      );
    }
  }

  async setPrincipalStatus(input: {
    principalId: string;
    workspaceId: string;
    actorUserId: string;
    status: AgentPrincipalStatus;
  }): Promise<AgentPrincipalRecord> {
    const current = await this.repository.findPrincipalForActor(
      input.principalId,
      input.workspaceId,
      input.actorUserId,
    );
    if (!current) {
      throw new AgentAuthError(
        "AGENT_PRINCIPAL_NOT_FOUND",
        "Agent Principal was not found in an accessible Workspace.",
      );
    }
    if (current.status === "revoked" && input.status !== "revoked") {
      throw new AgentAuthError(
        "AGENT_PRINCIPAL_REVOKED",
        "A revoked Agent Principal cannot be reactivated.",
      );
    }
    const principal = await this.repository.updatePrincipalStatus({
      ...input,
      updatedAt: this.clock.now(),
    });
    if (!principal) {
      const latest = await this.repository.findPrincipalForActor(
        input.principalId,
        input.workspaceId,
        input.actorUserId,
      );
      if (latest?.status === "revoked") {
        throw new AgentAuthError(
          "AGENT_PRINCIPAL_REVOKED",
          "A revoked Agent Principal cannot be reactivated.",
        );
      }
      throw new AgentAuthError(
        "AGENT_PRINCIPAL_NOT_FOUND",
        "Agent Principal was not found in an accessible Workspace.",
      );
    }
    return principal;
  }

  async listPrincipals(
    workspaceId: string,
    actorUserId: string,
  ): Promise<AgentPrincipalSummary[]> {
    const principals = await this.repository.listPrincipals(
      workspaceId,
      actorUserId,
    );
    if (!principals) {
      throw new AgentAuthError(
        "PAIRING_SPONSOR_FORBIDDEN",
        "The signed-in user cannot manage Agents in this Workspace.",
      );
    }
    return principals;
  }

  private async resolveUsableChallenge(
    plaintext: string,
  ): Promise<PairingChallengeRecord> {
    const parsed = parseOpaqueCredential(plaintext, "challenge");
    if (!parsed) {
      throw new AgentAuthError(
        "PAIRING_CHALLENGE_INVALID",
        "The pairing challenge is invalid.",
      );
    }
    const challenge = await this.repository.findPairingChallengeByPrefix(
      parsed.lookupPrefix,
    );
    await this.repository.cleanupPairingSecurityState(this.clock.now());
    if (
      !challenge ||
      !verifyCredentialSecret(
        parsed.secret,
        challenge.secretHash,
        this.peppers[challenge.pepperVersion] ?? "",
      )
    ) {
      throw new AgentAuthError(
        "PAIRING_CHALLENGE_INVALID",
        "The pairing challenge is invalid.",
      );
    }
    if (challenge.consumedAt) {
      throw new AgentAuthError(
        "PAIRING_CHALLENGE_REPLAYED",
        "This pairing challenge was already used.",
      );
    }
    if (challenge.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new AgentAuthError(
        "PAIRING_CHALLENGE_EXPIRED",
        "This pairing challenge has expired.",
      );
    }
    return challenge;
  }

  private async enforcePairingRateLimit(
    action: PairingRateLimitAction,
    clientRateLimitKey: string,
  ): Promise<void> {
    const normalizedClientKey =
      clientRateLimitKey.trim().slice(0, 512) || "shared-unattributed-client";
    const requesterFingerprint = hashCredentialSecret(
      `pairing-rate-limit:${normalizedClientKey}`,
      this.currentPepper,
    );
    const policy = PAIRING_RATE_LIMITS[action];
    const result = await this.repository.consumePairingRateLimit({
      requesterFingerprint,
      action,
      now: this.clock.now(),
      windowMs: policy.windowMs,
      limit: policy.limit,
    });
    if (!result.allowed) {
      throw new AgentAuthError(
        "PAIRING_RATE_LIMITED",
        "Too many pairing attempts. Try again later.",
        result.retryAfterMs,
      );
    }
  }

  private async resolveUsableConfirmationId(
    confirmationId: string,
  ): Promise<PairingChallengeRecord> {
    const normalized = confirmationId.trim();
    if (!/^[A-Za-z0-9_-]{12}$/.test(normalized)) {
      throw new AgentAuthError(
        "PAIRING_CHALLENGE_INVALID",
        "The pairing confirmation is invalid.",
      );
    }
    const challenge =
      await this.repository.findPairingChallengeByPrefix(normalized);
    if (!challenge) {
      throw new AgentAuthError(
        "PAIRING_CHALLENGE_INVALID",
        "The pairing confirmation is invalid.",
      );
    }
    if (challenge.consumedAt) {
      throw new AgentAuthError(
        "PAIRING_CHALLENGE_REPLAYED",
        "This pairing challenge was already used.",
      );
    }
    if (challenge.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new AgentAuthError(
        "PAIRING_CHALLENGE_EXPIRED",
        "This pairing challenge has expired.",
      );
    }
    return challenge;
  }

  private challengeUnavailableError(
    challenge: PairingChallengeRecord | null,
  ): AgentAuthError {
    if (challenge?.consumedAt) {
      return new AgentAuthError(
        "PAIRING_CHALLENGE_REPLAYED",
        "This pairing challenge was already used.",
      );
    }
    if (
      challenge &&
      challenge.expiresAt.getTime() > this.clock.now().getTime()
    ) {
      return new AgentAuthError(
        "PAIRING_CHALLENGE_REPLAYED",
        "This pairing challenge was already approved.",
      );
    }
    return new AgentAuthError(
      "PAIRING_CHALLENGE_EXPIRED",
      "This pairing challenge has expired.",
    );
  }
}

const productionPepperConfig = loadAgentKeyPepperConfig();

export const AGENT_AUTH_SERVICE = new AgentAuthService(
  new DrizzleAgentAuthRepository(getDb),
  systemClock,
  productionPepperConfig.peppers,
  productionPepperConfig.activeVersion,
  new DrizzleAgentAuthorizationRepository(getDb),
);
