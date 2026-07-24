import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
} from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  agentKeys,
  agentPairingChallenges,
  agentPrincipals,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
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

type Db = ReturnType<typeof getDb>;

function principalFromRow(
  row: typeof agentPrincipals.$inferSelect,
): AgentPrincipalRecord {
  return {
    ...row,
    requestedAccess: row.requestedAccess ?? [],
  };
}

function keyFromRow(row: typeof agentKeys.$inferSelect): AgentKeyRecord {
  return row;
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
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, actorUserId),
          inArray(workspaceMembers.role, ["owner", "admin"]),
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
      .where(
        and(
          eq(agentPrincipals.id, principalId),
          inArray(workspaceMembers.role, ["owner", "admin"]),
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
    actorUserId: string;
    revokedAt: Date;
  }): Promise<boolean> {
    const allowed = await this.getDatabase()
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
      .where(
        and(
          eq(agentKeys.id, input.keyId),
          inArray(workspaceMembers.role, ["owner", "admin"]),
        ),
      )
      .limit(1);
    if (!allowed[0]) return false;
    await this.getDatabase()
      .update(agentKeys)
      .set({ revokedAt: input.revokedAt })
      .where(and(eq(agentKeys.id, input.keyId), isNull(agentKeys.revokedAt)));
    return true;
  }

  async updatePrincipalStatus(input: {
    principalId: string;
    actorUserId: string;
    status: AgentPrincipalStatus;
    updatedAt: Date;
  }): Promise<AgentPrincipalRecord | null> {
    const principal = await this.findPrincipalForActor(
      input.principalId,
      input.actorUserId,
    );
    if (!principal) return null;
    const rows = await this.getDatabase()
      .update(agentPrincipals)
      .set({
        status: input.status,
        suspendedAt:
          input.status === "suspended" ? input.updatedAt : principal.suspendedAt,
        revokedAt:
          input.status === "revoked" ? input.updatedAt : principal.revokedAt,
        updatedAt: input.updatedAt,
      })
      .where(eq(agentPrincipals.id, input.principalId))
      .returning();
    return rows[0] ? principalFromRow(rows[0]) : null;
  }
}
