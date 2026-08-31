export type AgentPrincipalStatus = "active" | "suspended" | "revoked";
export type PairingRateLimitAction = "challenge_create" | "challenge_redeem";

export interface AgentSecurityContext {
  principalId: string;
  workspaceId: string;
  keyId: string;
}

export interface PairingChallengeRecord {
  id: string;
  lookupPrefix: string;
  secretHash: string;
  pepperVersion: number;
  agentName: string;
  keyName: string;
  requestedAccess: string[];
  expiresAt: Date;
  approvedWorkspaceId: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface AgentPrincipalRecord {
  id: string;
  workspaceId: string;
  sponsorUserId: string | null;
  name: string;
  requestedAccess: string[];
  status: AgentPrincipalStatus;
  suspendedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentKeyRecord {
  id: string;
  principalId: string;
  name: string;
  lookupPrefix: string;
  secretHash: string;
  pepperVersion: number;
  authorizationScopes: import("./agentAuthorization").AgentKeyAuthorizationScope[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface AgentAuthenticationRecord {
  key: AgentKeyRecord;
  principal: AgentPrincipalRecord;
  sponsorIsWorkspaceAdmin: boolean;
  workspaceIsActive: boolean;
}

export interface AgentPrincipalSummary extends AgentPrincipalRecord {
  keys: Array<Omit<AgentKeyRecord, "secretHash">>;
}

export type PairingCompletionResult =
  | {
      type: "created";
      principal: AgentPrincipalRecord;
      key: AgentKeyRecord;
    }
  | { type: "challenge_unavailable" }
  | { type: "sponsor_forbidden" };

export type PairingApprovalResult =
  | { type: "approved"; challenge: PairingChallengeRecord }
  | { type: "challenge_unavailable" }
  | { type: "sponsor_forbidden" };

export interface AgentAuthRepository {
  consumePairingRateLimit(input: {
    requesterFingerprint: string;
    action: PairingRateLimitAction;
    now: Date;
    windowMs: number;
    limit: number;
  }): Promise<{ allowed: boolean; retryAfterMs: number }>;
  cleanupPairingSecurityState(now: Date): Promise<void>;
  createPairingChallenge(challenge: PairingChallengeRecord): Promise<void>;
  findPairingChallengeByPrefix(
    lookupPrefix: string,
  ): Promise<PairingChallengeRecord | null>;
  approvePairing(input: {
    challengeId: string;
    workspaceId: string;
    sponsorUserId: string;
    now: Date;
  }): Promise<PairingApprovalResult>;
  completePairing(input: {
    challengeId: string;
    principal: AgentPrincipalRecord;
    key: AgentKeyRecord;
    now: Date;
  }): Promise<PairingCompletionResult>;
  findAuthenticationRecordByPrefix(
    lookupPrefix: string,
  ): Promise<AgentAuthenticationRecord | null>;
  recordKeyUsed(keyId: string, usedAt: Date): Promise<void>;
  listPrincipals(
    workspaceId: string,
    actorUserId: string,
  ): Promise<AgentPrincipalSummary[] | null>;
  findPrincipalForActor(
    principalId: string,
    workspaceId: string,
    actorUserId: string,
  ): Promise<AgentPrincipalRecord | null>;
  createKey(key: AgentKeyRecord): Promise<void>;
  revokeKey(input: {
    keyId: string;
    workspaceId: string;
    actorUserId: string;
    revokedAt: Date;
  }): Promise<boolean>;
  updatePrincipalStatus(input: {
    principalId: string;
    workspaceId: string;
    actorUserId: string;
    status: AgentPrincipalStatus;
    updatedAt: Date;
  }): Promise<AgentPrincipalRecord | null>;
}
