import type {
  AgentAuthRepository,
  AgentAuthenticationRecord,
  AgentKeyRecord,
  AgentPrincipalRecord,
  AgentPrincipalStatus,
  AgentPrincipalSummary,
  PairingApprovalResult,
  PairingChallengeRecord,
  PairingCompletionResult,
} from "./types";

/**
 * Deterministic persistence adapter for capability/transport tests. It models
 * the same atomic consume operation as the Postgres repository.
 */
export class InMemoryAgentAuthRepository implements AgentAuthRepository {
  readonly challenges = new Map<string, PairingChallengeRecord>();
  readonly principals = new Map<string, AgentPrincipalRecord>();
  readonly keys = new Map<string, AgentKeyRecord>();
  readonly memberships = new Set<string>();
  readonly administrators = new Set<string>();
  readonly inactiveWorkspaces = new Set<string>();

  addMembership(
    workspaceId: string,
    userId: string,
    role: "owner" | "admin" | "member" = "owner",
  ): void {
    const key = `${workspaceId}:${userId}`;
    this.memberships.add(key);
    if (role === "owner" || role === "admin") {
      this.administrators.add(key);
    } else {
      this.administrators.delete(key);
    }
  }

  removeMembership(workspaceId: string, userId: string): void {
    this.memberships.delete(`${workspaceId}:${userId}`);
    this.administrators.delete(`${workspaceId}:${userId}`);
  }

  async createPairingChallenge(
    challenge: PairingChallengeRecord,
  ): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async findPairingChallengeByPrefix(
    lookupPrefix: string,
  ): Promise<PairingChallengeRecord | null> {
    return (
      [...this.challenges.values()].find(
        (challenge) => challenge.lookupPrefix === lookupPrefix,
      ) ?? null
    );
  }

  async completePairing(input: {
    challengeId: string;
    principal: AgentPrincipalRecord;
    key: AgentKeyRecord;
    now: Date;
  }): Promise<PairingCompletionResult> {
    if (
      !input.principal.sponsorUserId ||
      !this.administrators.has(
        `${input.principal.workspaceId}:${input.principal.sponsorUserId}`,
      ) ||
      this.inactiveWorkspaces.has(input.principal.workspaceId)
    ) {
      return { type: "sponsor_forbidden" };
    }
    const challenge = this.challenges.get(input.challengeId);
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.approvedWorkspaceId !== input.principal.workspaceId ||
      challenge.approvedByUserId !== input.principal.sponsorUserId ||
      challenge.expiresAt.getTime() <= input.now.getTime()
    ) {
      return { type: "challenge_unavailable" };
    }
    // This synchronous mutation is the in-memory equivalent of UPDATE ...
    // WHERE used_at IS NULL RETURNING inside the production transaction.
    challenge.consumedAt = input.now;
    this.principals.set(input.principal.id, input.principal);
    this.keys.set(input.key.id, input.key);
    return {
      type: "created",
      principal: input.principal,
      key: input.key,
    };
  }

  async approvePairing(input: {
    challengeId: string;
    workspaceId: string;
    sponsorUserId: string;
    now: Date;
  }): Promise<PairingApprovalResult> {
    if (
      !this.administrators.has(`${input.workspaceId}:${input.sponsorUserId}`) ||
      this.inactiveWorkspaces.has(input.workspaceId)
    ) {
      return { type: "sponsor_forbidden" };
    }
    const challenge = this.challenges.get(input.challengeId);
    if (
      !challenge ||
      challenge.approvedAt ||
      challenge.consumedAt ||
      challenge.expiresAt.getTime() <= input.now.getTime()
    ) {
      return { type: "challenge_unavailable" };
    }
    challenge.approvedWorkspaceId = input.workspaceId;
    challenge.approvedByUserId = input.sponsorUserId;
    challenge.approvedAt = input.now;
    return { type: "approved", challenge };
  }

  async findAuthenticationRecordByPrefix(
    lookupPrefix: string,
  ): Promise<AgentAuthenticationRecord | null> {
    const key = [...this.keys.values()].find(
      (candidate) => candidate.lookupPrefix === lookupPrefix,
    );
    if (!key) return null;
    const principal = this.principals.get(key.principalId);
    if (!principal) return null;
    return {
      key,
      principal,
      sponsorIsWorkspaceAdmin: Boolean(
        principal.sponsorUserId &&
          this.administrators.has(
            `${principal.workspaceId}:${principal.sponsorUserId}`,
          ),
      ),
      workspaceIsActive: !this.inactiveWorkspaces.has(principal.workspaceId),
    };
  }

  async recordKeyUsed(keyId: string, usedAt: Date): Promise<void> {
    const key = this.keys.get(keyId);
    if (
      key &&
      (!key.lastUsedAt || key.lastUsedAt.getTime() < usedAt.getTime())
    ) {
      key.lastUsedAt = usedAt;
    }
  }

  async listPrincipals(
    workspaceId: string,
    actorUserId: string,
  ): Promise<AgentPrincipalSummary[] | null> {
    if (
      !this.administrators.has(`${workspaceId}:${actorUserId}`) ||
      this.inactiveWorkspaces.has(workspaceId)
    ) {
      return null;
    }
    return [...this.principals.values()]
      .filter((principal) => principal.workspaceId === workspaceId)
      .map((principal) => ({
        ...principal,
        keys: [...this.keys.values()]
          .filter((key) => key.principalId === principal.id)
          .map(({ secretHash: _secretHash, ...key }) => key),
      }));
  }

  async findPrincipalForActor(
    principalId: string,
    workspaceId: string,
    actorUserId: string,
  ): Promise<AgentPrincipalRecord | null> {
    const principal = this.principals.get(principalId);
    if (
      !principal ||
      principal.workspaceId !== workspaceId ||
      this.inactiveWorkspaces.has(workspaceId) ||
      !this.administrators.has(`${workspaceId}:${actorUserId}`)
    ) {
      return null;
    }
    return principal;
  }

  async createKey(key: AgentKeyRecord): Promise<void> {
    this.keys.set(key.id, key);
  }

  async revokeKey(input: {
    keyId: string;
    workspaceId: string;
    actorUserId: string;
    revokedAt: Date;
  }): Promise<boolean> {
    const key = this.keys.get(input.keyId);
    const principal = key ? this.principals.get(key.principalId) : null;
    if (
      !key ||
      !principal ||
      principal.workspaceId !== input.workspaceId ||
      this.inactiveWorkspaces.has(input.workspaceId) ||
      !this.administrators.has(
        `${input.workspaceId}:${input.actorUserId}`,
      )
    ) {
      return false;
    }
    key.revokedAt ??= input.revokedAt;
    return true;
  }

  async updatePrincipalStatus(input: {
    principalId: string;
    workspaceId: string;
    actorUserId: string;
    status: AgentPrincipalStatus;
    updatedAt: Date;
  }): Promise<AgentPrincipalRecord | null> {
    const principal = await this.findPrincipalForActor(
      input.principalId,
      input.workspaceId,
      input.actorUserId,
    );
    if (!principal) return null;
    if (principal.status === "revoked" && input.status !== "revoked") {
      return null;
    }
    principal.status = input.status;
    principal.updatedAt = input.updatedAt;
    if (input.status === "suspended") principal.suspendedAt = input.updatedAt;
    if (input.status === "revoked") principal.revokedAt = input.updatedAt;
    return principal;
  }
}
