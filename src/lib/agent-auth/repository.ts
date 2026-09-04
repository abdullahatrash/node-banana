import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  agentSecurityEvents,
  agentKeys,
  agentPairingChallenges,
  agentPairingRateLimits,
  agentPrincipals,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import { randomUUID } from "node:crypto";
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
  PairingRateLimitAction,
} from "./types";

type Db = ReturnType<typeof getDb>;
const EXPIRED_CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1000;

function principalFromRow(
  row: typeof agentPrincipals.$inferSelect,
): AgentPrincipalRecord {
  return {
    ...row,
    requestedAccess: row.requestedAccess ?? [],
  };
}

function keyFromRow(row: typeof agentKeys.$inferSelect): AgentKeyRecord {
  return {
    ...row,
    authorizationScopes: (row.authorizationScopes ?? []).map((scope) => ({
      ...scope,
      resources: {
        ...scope.resources,
        studioAssetIds: scope.resources.studioAssetIds ?? [],
        artifactIds: scope.resources.artifactIds ?? [],
      },
    })),
  };
}

function challengeFromRow(
  row: typeof agentPairingChallenges.$inferSelect,
): PairingChallengeRecord {
  return {
    ...row,
    requestedAccess: row.requestedAccess ?? [],
  };
}

export class DrizzleAgentAuthRepository implements AgentAuthRepository {
  constructor(private readonly getDatabase: () => Db) {}

  async consumePairingRateLimit(input: {
    requesterFingerprint: string;
    action: PairingRateLimitAction;
    now: Date;
    windowMs: number;
    limit: number;
  }): Promise<{ allowed: boolean; retryAfterMs: number }> {
    return this.getDatabase().transaction(async (tx) => {
      const expiresAt = new Date(input.now.getTime() + input.windowMs * 2);
      const inserted = await tx
        .insert(agentPairingRateLimits)
        .values({
          requesterFingerprint: input.requesterFingerprint,
          action: input.action,
          windowStartedAt: input.now,
          requestCount: 1,
          expiresAt,
          updatedAt: input.now,
        })
        .onConflictDoNothing()
        .returning({
          requestCount: agentPairingRateLimits.requestCount,
          windowStartedAt: agentPairingRateLimits.windowStartedAt,
        });
      if (inserted[0]) return { allowed: true, retryAfterMs: 0 };

      const windowCutoff = new Date(input.now.getTime() - input.windowMs);
      const rows = await tx
        .update(agentPairingRateLimits)
        .set({
          requestCount: sql<number>`case when ${agentPairingRateLimits.windowStartedAt} <= ${windowCutoff} then 1 else ${agentPairingRateLimits.requestCount} + 1 end`,
          windowStartedAt: sql<Date>`case when ${agentPairingRateLimits.windowStartedAt} <= ${windowCutoff} then ${input.now} else ${agentPairingRateLimits.windowStartedAt} end`,
          expiresAt,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(
              agentPairingRateLimits.requesterFingerprint,
              input.requesterFingerprint,
            ),
            eq(agentPairingRateLimits.action, input.action),
          ),
        )
        .returning({
          requestCount: agentPairingRateLimits.requestCount,
          windowStartedAt: agentPairingRateLimits.windowStartedAt,
        });
      const row = rows[0];
      if (!row) return { allowed: false, retryAfterMs: input.windowMs };
      const allowed = row.requestCount <= input.limit;
      return {
        allowed,
        retryAfterMs: allowed
          ? 0
          : Math.max(
              1,
              row.windowStartedAt.getTime() +
                input.windowMs -
                input.now.getTime(),
            ),
      };
    });
  }

  async cleanupPairingSecurityState(now: Date): Promise<void> {
    const challengeCutoff = new Date(
      now.getTime() - EXPIRED_CHALLENGE_RETENTION_MS,
    );
    await this.getDatabase().transaction(async (tx) => {
      await tx
        .delete(agentPairingChallenges)
        .where(lte(agentPairingChallenges.expiresAt, challengeCutoff));
      await tx
        .delete(agentPairingRateLimits)
        .where(lte(agentPairingRateLimits.expiresAt, now));
    });
  }

  async createPairingChallenge(
    challenge: PairingChallengeRecord,
  ): Promise<void> {
    await this.getDatabase().insert(agentPairingChallenges).values(challenge);
  }

  async findPairingChallengeByPrefix(
    lookupPrefix: string,
  ): Promise<PairingChallengeRecord | null> {
    const rows = await this.getDatabase()
      .select()
      .from(agentPairingChallenges)
      .where(eq(agentPairingChallenges.lookupPrefix, lookupPrefix))
      .limit(1);
    return rows[0] ? challengeFromRow(rows[0]) : null;
  }

  async completePairing(input: {
    challengeId: string;
    principal: AgentPrincipalRecord;
    key: AgentKeyRecord;
    now: Date;
  }): Promise<PairingCompletionResult> {
    return this.getDatabase().transaction(async (tx) => {
      const memberships = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.principal.workspaceId),
            eq(workspaceMembers.userId, input.principal.sponsorUserId!),
            isNull(workspaces.deletedAt),
          ),
        )
        .limit(1);
      if (
        !memberships[0] ||
        !["owner", "admin"].includes(memberships[0].role)
      ) {
        return { type: "sponsor_forbidden" };
      }

      const consumed = await tx
        .update(agentPairingChallenges)
        .set({ consumedAt: input.now })
        .where(
          and(
            eq(agentPairingChallenges.id, input.challengeId),
            isNull(agentPairingChallenges.consumedAt),
            gt(agentPairingChallenges.expiresAt, input.now),
            eq(
              agentPairingChallenges.approvedWorkspaceId,
              input.principal.workspaceId,
            ),
            eq(
              agentPairingChallenges.approvedByUserId,
              input.principal.sponsorUserId!,
            ),
          ),
        )
        .returning({ id: agentPairingChallenges.id });
      if (!consumed[0]) return { type: "challenge_unavailable" };

      await tx.insert(agentPrincipals).values(input.principal);
      await tx.insert(agentKeys).values(input.key);
      return {
        type: "created",
        principal: input.principal,
        key: input.key,
      };
    });
  }

  async approvePairing(input: {
    challengeId: string;
    workspaceId: string;
    sponsorUserId: string;
    now: Date;
  }): Promise<PairingApprovalResult> {
    return this.getDatabase().transaction(async (tx) => {
      const memberships = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.sponsorUserId),
            isNull(workspaces.deletedAt),
          ),
        )
        .limit(1);
      if (
        !memberships[0] ||
        !["owner", "admin"].includes(memberships[0].role)
      ) {
        return { type: "sponsor_forbidden" };
      }
      const rows = await tx
        .update(agentPairingChallenges)
        .set({
          approvedWorkspaceId: input.workspaceId,
          approvedByUserId: input.sponsorUserId,
          approvedAt: input.now,
        })
        .where(
          and(
            eq(agentPairingChallenges.id, input.challengeId),
            isNull(agentPairingChallenges.approvedAt),
            isNull(agentPairingChallenges.consumedAt),
            gt(agentPairingChallenges.expiresAt, input.now),
          ),
        )
        .returning();
      return rows[0]
        ? { type: "approved", challenge: challengeFromRow(rows[0]) }
        : { type: "challenge_unavailable" };
    });
  }

  async findAuthenticationRecordByPrefix(
    lookupPrefix: string,
  ): Promise<AgentAuthenticationRecord | null> {
    const rows = await this.getDatabase()
      .select({
        key: agentKeys,
        principal: agentPrincipals,
        sponsorMembershipRole: workspaceMembers.role,
        workspaceDeletedAt: workspaces.deletedAt,
      })
      .from(agentKeys)
      .innerJoin(
        agentPrincipals,
        eq(agentKeys.principalId, agentPrincipals.id),
      )
      .innerJoin(workspaces, eq(agentPrincipals.workspaceId, workspaces.id))
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, agentPrincipals.workspaceId),
          eq(workspaceMembers.userId, agentPrincipals.sponsorUserId),
        ),
      )
      .where(eq(agentKeys.lookupPrefix, lookupPrefix))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      key: keyFromRow(row.key),
      principal: principalFromRow(row.principal),
      sponsorIsWorkspaceAdmin:
        row.sponsorMembershipRole === "owner" ||
        row.sponsorMembershipRole === "admin",
      workspaceIsActive: row.workspaceDeletedAt === null,
    };
  }

  async recordKeyUsed(keyId: string, usedAt: Date): Promise<void> {
    await this.getDatabase()
      .update(agentKeys)
      .set({ lastUsedAt: usedAt })
      .where(
        and(
          eq(agentKeys.id, keyId),
          or(isNull(agentKeys.lastUsedAt), lt(agentKeys.lastUsedAt, usedAt)),
        ),
      );
  }

  async listPrincipals(
    workspaceId: string,
    actorUserId: string,
  ): Promise<AgentPrincipalSummary[] | null> {
    const membership = await this.getDatabase()
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, actorUserId),
          inArray(workspaceMembers.role, ["owner", "admin"]),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    if (!membership[0]) return null;

    const rows = await this.getDatabase()
      .select({ principal: agentPrincipals, key: agentKeys })
      .from(agentPrincipals)
      .leftJoin(agentKeys, eq(agentKeys.principalId, agentPrincipals.id))
      .where(eq(agentPrincipals.workspaceId, workspaceId))
      .orderBy(asc(agentPrincipals.createdAt), asc(agentKeys.createdAt));
    const byId = new Map<string, AgentPrincipalSummary>();
    for (const row of rows) {
      const principal =
        byId.get(row.principal.id) ?? {
          ...principalFromRow(row.principal),
          keys: [],
        };
      if (row.key) {
        const { secretHash: _secretHash, ...safeKey } = keyFromRow(row.key);
        principal.keys.push(safeKey);
      }
      byId.set(principal.id, principal);
    }
    return [...byId.values()];
  }

  async findPrincipalForActor(
    principalId: string,
    workspaceId: string,
    actorUserId: string,
  ): Promise<AgentPrincipalRecord | null> {
    const rows = await this.getDatabase()
      .select({ principal: agentPrincipals })
      .from(agentPrincipals)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, agentPrincipals.workspaceId),
          eq(workspaceMembers.userId, actorUserId),
        ),
      )
      .innerJoin(workspaces, eq(agentPrincipals.workspaceId, workspaces.id))
      .where(
        and(
          eq(agentPrincipals.id, principalId),
          eq(agentPrincipals.workspaceId, workspaceId),
          inArray(workspaceMembers.role, ["owner", "admin"]),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? principalFromRow(rows[0].principal) : null;
  }

  async createKey(key: AgentKeyRecord): Promise<void> {
    await this.getDatabase().insert(agentKeys).values(key);
  }

  async revokeKey(input: {
    keyId: string;
    workspaceId: string;
    actorUserId: string;
    revokedAt: Date;
  }): Promise<boolean> {
    return this.getDatabase().transaction(async (tx) => {
    const allowed = await tx
      .select({ id: agentKeys.id })
      .from(agentKeys)
      .innerJoin(
        agentPrincipals,
        eq(agentKeys.principalId, agentPrincipals.id),
      )
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, agentPrincipals.workspaceId),
          eq(workspaceMembers.userId, input.actorUserId),
        ),
      )
      .innerJoin(workspaces, eq(agentPrincipals.workspaceId, workspaces.id))
      .where(
        and(
          eq(agentKeys.id, input.keyId),
          eq(agentPrincipals.workspaceId, input.workspaceId),
          inArray(workspaceMembers.role, ["owner", "admin"]),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    if (!allowed[0]) return false;
    const updated = await tx
      .update(agentKeys)
      .set({ revokedAt: input.revokedAt })
      .where(and(eq(agentKeys.id, input.keyId), isNull(agentKeys.revokedAt)))
      .returning({ principalId: agentKeys.principalId });
    if (updated[0]) {
      await tx.insert(agentSecurityEvents).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        principalId: updated[0].principalId,
        keyId: input.keyId,
        actorUserId: input.actorUserId,
        eventType: "key.revoked",
        capabilityName: "agents.keys.revoke",
        capabilityVersion: 1,
        reason: "allowed",
        resourceKinds: [],
        changeRef: input.keyId,
        revision: null,
        principalStatus: null,
        createdAt: input.revokedAt,
      });
    }
    return true;
    });
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
    const principalPredicate =
      input.status === "revoked"
        ? and(
            eq(agentPrincipals.id, input.principalId),
            eq(agentPrincipals.workspaceId, input.workspaceId),
          )
        : and(
            eq(agentPrincipals.id, input.principalId),
            eq(agentPrincipals.workspaceId, input.workspaceId),
            ne(agentPrincipals.status, "revoked"),
          );
    const rows = await this.getDatabase().transaction(async (tx) => {
      const updated = await tx
        .update(agentPrincipals)
        .set({
          status: input.status,
          suspendedAt:
            input.status === "suspended"
              ? input.updatedAt
              : principal.suspendedAt,
          revokedAt:
            input.status === "revoked"
              ? input.updatedAt
              : principal.revokedAt,
          updatedAt: input.updatedAt,
        })
        .where(principalPredicate)
        .returning();
      if (!updated[0]) return updated;
      await tx.insert(agentSecurityEvents).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        keyId: null,
        actorUserId: input.actorUserId,
        eventType: "principal.status_changed",
        capabilityName: "agents.principals.status",
        capabilityVersion: 1,
        reason: "allowed",
        resourceKinds: [],
        changeRef: input.principalId,
        revision: null,
        principalStatus: input.status,
        createdAt: input.updatedAt,
      });
      return updated;
    });
    return rows[0] ? principalFromRow(rows[0]) : null;
  }
}
