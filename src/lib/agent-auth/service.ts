import { randomUUID } from "node:crypto";
import { isProductionLikeRuntime } from "@/lib/auth/features";
import { getDb } from "@/lib/db";
import {
  createOpaqueCredential,
  hashCredentialSecret,
  parseOpaqueCredential,
  verifyCredentialSecret,
} from "./crypto";
import { DrizzleAgentAuthRepository } from "./repository";
import type {
  AgentAuthRepository,
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentPrincipalStatus,
  AgentPrincipalSummary,
  AgentSecurityContext,
  PairingChallengeRecord,
} from "./types";

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_KEY_LIFETIME_MS = 366 * 24 * 60 * 60 * 1000;

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
  | "PAIRING_SPONSOR_FORBIDDEN"
  | "AGENT_PRINCIPAL_NOT_FOUND"
  | "AGENT_KEY_NOT_FOUND";

export class AgentAuthError extends Error {
  constructor(
    readonly code: AgentAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentAuthError";
  }
}

export interface AgentAuthClock {
  now(): Date;
}

const systemClock: AgentAuthClock = { now: () => new Date() };

function getAgentKeyPepper(): string {
  const configured = process.env.AGENT_KEY_PEPPER?.trim();
  if (configured) return configured;
  if (isProductionLikeRuntime() || process.env.VERCEL_ENV === "production") {
    throw new Error("AGENT_KEY_PEPPER must be set in production.");
  }
  return "node-banana-local-agent-pepper-change-before-production";
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
    throw new TypeError(`${label} must be between 1 and 120 characters.`);
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
    throw new TypeError("requestedAccess must contain 1 to 32 access names.");
  }
  return unique;
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
    throw new TypeError(
      "Key expiry must be in the future and no more than 366 days away.",
    );
  }
  return expiresAt;
}

export class AgentAuthService {
  constructor(
    readonly repository: AgentAuthRepository,
    private readonly clock: AgentAuthClock = systemClock,
    private readonly peppers: Readonly<Record<number, string>> = {
      1: getAgentKeyPepper(),
    },
    private readonly currentPepperVersion = 1,
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
    ttlMs?: number;
  }): Promise<{ challenge: string; expiresAt: string }> {
    const now = this.clock.now();
    const ttlMs = input.ttlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    if (
      !Number.isInteger(ttlMs) ||
      ttlMs < 30_000 ||
      ttlMs > MAX_CHALLENGE_TTL_MS
    ) {
      throw new TypeError("Pairing challenge TTL must be 30 seconds to 10 minutes.");
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
    return {
      challenge: credential.plaintext,
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

  /**
   * The local Agent redeems an approved challenge. The repository consumes it
   * and writes Principal + key in one transaction. If the response is lost,
   * replay is refused and the operator must pair again.
   */
  async redeemPairing(input: {
    challenge: string;
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
    await this.repository.recordKeyUsed(record.key.id, now);
    return {
      principalId: record.principal.id,
      workspaceId: record.principal.workspaceId,
      sponsorUserId: record.principal.sponsorUserId,
      keyId: record.key.id,
      access: [...record.principal.requestedAccess],
    };
  }

  async rotateKey(input: {
    principalId: string;
    workspaceId: string;
    actorUserId: string;
    name: string;
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
      expiresAt: cleanExpiry(input.expiresAt, now),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    };
    await this.repository.createKey(key);
    const { secretHash: _secretHash, ...safeKey } = key;
    return { agentKey: credential.plaintext, key: safeKey };
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

export const AGENT_AUTH_SERVICE = new AgentAuthService(
  new DrizzleAgentAuthRepository(getDb),
);
