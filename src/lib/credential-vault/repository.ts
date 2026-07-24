import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  agentPrincipals,
  agentSecurityEvents,
  credentialEffectAuditEvents,
  credentialHumanMutationReceipts,
  credentialProfiles,
  credentialProfileVersions,
  credentialSecurityEvents,
  credentialSlots,
  credentialSpendEvents,
  credentialSpendGrants,
  projects,
  workspaceMembers,
} from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { parseWorkflowCredentialSlots } from "@/types";
import type {
  CredentialEffectIntent,
  CredentialSpendGrant,
  SafeCredentialProfile,
} from "@/types/credentials";
import type {
  CredentialSafeEffectResult,
  CredentialHumanMutationReceipt,
  CredentialHumanMutationResult,
  CredentialVaultRepository,
} from "./types";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type EffectReceipt = typeof credentialSpendEvents.$inferSelect;

async function appendEffectAuditEvents(
  tx: Tx,
  receipt: EffectReceipt,
  events: Array<{
    eventType: import("./types").CredentialEffectAuditEventType;
    failureCode?: string | null;
    reconciliationReference?: string | null;
  }>,
  now: Date,
): Promise<void> {
  if (events.length === 0) return;
  const latest = await tx
    .select({ sequence: credentialEffectAuditEvents.effectSequence })
    .from(credentialEffectAuditEvents)
    .where(
      and(
        eq(credentialEffectAuditEvents.workspaceId, receipt.workspaceId),
        eq(credentialEffectAuditEvents.effectRef, receipt.effectRef),
      ),
    )
    .orderBy(desc(credentialEffectAuditEvents.effectSequence))
    .limit(1);
  const firstSequence = (latest[0]?.sequence ?? 0) + 1;
  await tx.insert(credentialEffectAuditEvents).values(
    events.map((event, index) => ({
      id: randomUUID(),
      workspaceId: receipt.workspaceId,
      principalId: receipt.principalId,
      profileId: receipt.profileId,
      versionId: receipt.versionId,
      spendGrantId: receipt.spendGrantId,
      effectRef: receipt.effectRef,
      effectSequence: firstSequence + index,
      eventType: event.eventType,
      requestFingerprint: receipt.requestFingerprint,
      failureCode: event.failureCode ?? null,
      reconciliationReference: event.reconciliationReference ?? null,
      createdAt: new Date(now.getTime() + index),
    })),
  );
}

async function manager(
  tx: Tx,
  workspaceId: string,
  actorUserId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, actorUserId),
        inArray(workspaceMembers.role, ["owner", "admin"]),
      ),
    )
    .limit(1)
    .for("update");
  return Boolean(rows[0]);
}

function safeProfile(row: {
  profile: typeof credentialProfiles.$inferSelect;
  slot: typeof credentialSlots.$inferSelect | null;
  version: typeof credentialProfileVersions.$inferSelect | null;
}): SafeCredentialProfile {
  const usableVersion =
    row.version?.status === "active" && row.version.revokedAt === null
      ? row.version
      : null;
  return {
    id: row.profile.id,
    workspaceId: row.profile.workspaceId,
    name: row.profile.name,
    provider: row.profile.provider,
    slotId: row.slot?.id ?? null,
    slotName: row.slot?.name ?? null,
    status: row.profile.status as SafeCredentialProfile["status"],
    activeVersion: usableVersion ? row.profile.activeVersion : null,
    secretHint: usableVersion?.secretHint ?? null,
    rotatedAt: usableVersion?.createdAt ?? null,
    reprovisionable:
      row.profile.status === "disabled" && !usableVersion,
  };
}

type ReceiptScope = {
  workspaceId: string;
  actorUserId: string;
  receipt: CredentialHumanMutationReceipt;
};

async function readHumanMutationReceipt<Value>(
  tx: Tx,
  input: ReceiptScope,
  decode: (value: unknown) => Value,
): Promise<CredentialHumanMutationResult<Value> | null> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.actorUserId}:${input.receipt.capabilityIdentity}:${input.receipt.idempotencyKey}`}, 0))`,
  );
  const rows = await tx
    .select({
      requestFingerprint:
        credentialHumanMutationReceipts.requestFingerprint,
      safeResult: credentialHumanMutationReceipts.safeResult,
    })
    .from(credentialHumanMutationReceipts)
    .where(
      and(
        eq(
          credentialHumanMutationReceipts.workspaceId,
          input.workspaceId,
        ),
        eq(
          credentialHumanMutationReceipts.actorUserId,
          input.actorUserId,
        ),
        eq(
          credentialHumanMutationReceipts.capabilityIdentity,
          input.receipt.capabilityIdentity,
        ),
        eq(
          credentialHumanMutationReceipts.idempotencyKey,
          input.receipt.idempotencyKey,
        ),
      ),
    )
    .limit(1);
  const receipt = rows[0];
  if (!receipt) return null;
  if (receipt.requestFingerprint !== input.receipt.requestFingerprint) {
    return { kind: "conflict" };
  }
  return { kind: "completed", value: decode(receipt.safeResult), replayed: true };
}

async function storeHumanMutationReceipt(
  tx: Tx,
  input: ReceiptScope,
  safeResult: unknown,
  completedAt: Date,
): Promise<void> {
  await tx.insert(credentialHumanMutationReceipts).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    capabilityIdentity: input.receipt.capabilityIdentity,
    idempotencyKey: input.receipt.idempotencyKey,
    requestFingerprint: input.receipt.requestFingerprint,
    safeResult,
    completedAt,
  });
}

function profileReceiptValue(profile: SafeCredentialProfile) {
  return {
    ...profile,
    rotatedAt: profile.rotatedAt?.toISOString() ?? null,
  };
}

function profileFromReceipt(value: unknown): SafeCredentialProfile {
  const profile = value as Omit<SafeCredentialProfile, "rotatedAt"> & {
    rotatedAt: string | null;
  };
  return {
    ...profile,
    rotatedAt: profile.rotatedAt ? new Date(profile.rotatedAt) : null,
  };
}

function grantReceiptValue(grant: CredentialSpendGrant) {
  return {
    ...grant,
    createdAt: grant.createdAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
  };
}

function grantFromReceipt(value: unknown): CredentialSpendGrant {
  const grant = value as Omit<
    CredentialSpendGrant,
    "createdAt" | "revokedAt"
  > & { createdAt: string; revokedAt: string | null };
  return {
    ...grant,
    createdAt: new Date(grant.createdAt),
    revokedAt: grant.revokedAt ? new Date(grant.revokedAt) : null,
  };
}

export class DrizzleCredentialVaultRepository
  implements CredentialVaultRepository
{
  constructor(private readonly getDatabase: () => Db) {}

  async createProfile(
    input: Parameters<CredentialVaultRepository["createProfile"]>[0],
  ): Promise<CredentialHumanMutationResult<SafeCredentialProfile>> {
    return this.getDatabase().transaction(async (tx) => {
      if (!(await manager(tx, input.workspaceId, input.actorUserId))) {
        return { kind: "unavailable" };
      }
      const receipt = await readHumanMutationReceipt(
        tx,
        input,
        profileFromReceipt,
      );
      if (receipt) return receipt;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:credential-profile:${input.name}`}, 0))`,
      );
      const activeNamesake = await tx
        .select({ id: credentialProfiles.id })
        .from(credentialProfiles)
        .where(
          and(
            eq(credentialProfiles.workspaceId, input.workspaceId),
            eq(credentialProfiles.name, input.name),
            eq(credentialProfiles.status, "active"),
            isNull(credentialProfiles.deletedAt),
          ),
        )
        .limit(1);
      if (activeNamesake[0]) return { kind: "unavailable" };
      await tx.insert(credentialProfiles).values({
        id: input.id,
        workspaceId: input.workspaceId,
        name: input.name,
        provider: input.provider,
        status: "active",
        activeVersion: 1,
        enabled: true,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      });
      await tx.insert(credentialProfileVersions).values({
        id: input.versionId,
        workspaceId: input.workspaceId,
        profileId: input.id,
        version: 1,
        secretCiphertext: input.secretCiphertext,
        secretHint: input.secretHint,
        status: "active",
        createdByUserId: input.actorUserId,
        createdAt: input.now,
        usableUntil: null,
        revokedAt: null,
      });
      await tx.insert(credentialSlots).values({
        id: input.slotId,
        workspaceId: input.workspaceId,
        profileId: input.id,
        name: input.slotName,
        provider: input.provider,
        createdByUserId: input.actorUserId,
        createdAt: input.now,
      });
      await tx.insert(credentialSecurityEvents).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        eventType: "profile.created",
        actorUserId: input.actorUserId,
        profileId: input.id,
        versionId: input.versionId,
        details: {
          provider: input.provider,
          version: 1,
          idempotencyKey: input.receipt.idempotencyKey,
          requestFingerprint: input.receipt.requestFingerprint,
        },
        createdAt: input.now,
      });
      const profile: SafeCredentialProfile = {
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
      };
      await storeHumanMutationReceipt(
        tx,
        input,
        profileReceiptValue(profile),
        input.now,
      );
      return { kind: "completed", value: profile, replayed: false };
    });
  }

  async reprovisionProfile(
    input: Parameters<CredentialVaultRepository["reprovisionProfile"]>[0],
  ): Promise<CredentialHumanMutationResult<SafeCredentialProfile>> {
    return this.getDatabase().transaction(async (tx) => {
      if (!(await manager(tx, input.workspaceId, input.actorUserId))) {
        return { kind: "unavailable" };
      }
      const receipt = await readHumanMutationReceipt(
        tx,
        input,
        profileFromReceipt,
      );
      if (receipt) return receipt;
      const profiles = await tx
        .select()
        .from(credentialProfiles)
        .where(
          and(
            eq(credentialProfiles.workspaceId, input.workspaceId),
            eq(credentialProfiles.id, input.profileId),
            eq(credentialProfiles.status, "disabled"),
            isNull(credentialProfiles.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      const profile = profiles[0];
      if (!profile) return { kind: "unavailable" };
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:credential-profile:${profile.name}`}, 0))`,
      );
      const activeNamesake = await tx
        .select({ id: credentialProfiles.id })
        .from(credentialProfiles)
        .where(
          and(
            eq(credentialProfiles.workspaceId, input.workspaceId),
            eq(credentialProfiles.name, profile.name),
            eq(credentialProfiles.status, "active"),
            isNull(credentialProfiles.deletedAt),
          ),
        )
        .limit(1);
      if (activeNamesake[0] && activeNamesake[0].id !== profile.id) {
        return { kind: "unavailable" };
      }
      const versions = await tx
        .select({
          id: credentialProfileVersions.id,
          version: credentialProfileVersions.version,
          status: credentialProfileVersions.status,
          revokedAt: credentialProfileVersions.revokedAt,
        })
        .from(credentialProfileVersions)
        .where(
          and(
            eq(credentialProfileVersions.workspaceId, input.workspaceId),
            eq(credentialProfileVersions.profileId, input.profileId),
          ),
        )
        .orderBy(desc(credentialProfileVersions.version))
        .for("update");
      const slots = await tx
        .select({ id: credentialSlots.id })
        .from(credentialSlots)
        .where(
          and(
            eq(credentialSlots.workspaceId, input.workspaceId),
            eq(credentialSlots.profileId, input.profileId),
          ),
        )
        .limit(1)
        .for("update");
      if (
        versions.some(
          (version) =>
            version.status === "active" && version.revokedAt === null,
        )
      ) {
        return { kind: "unavailable" };
      }
      const nextVersion = (versions[0]?.version ?? 0) + 1;
      await tx
        .update(credentialProfiles)
        .set({
          provider: input.provider,
          status: "active",
          activeVersion: nextVersion,
          enabled: true,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(credentialProfiles.workspaceId, input.workspaceId),
            eq(credentialProfiles.id, input.profileId),
          ),
        );
      await tx.insert(credentialProfileVersions).values({
        id: input.versionId,
        workspaceId: input.workspaceId,
        profileId: input.profileId,
        version: nextVersion,
        secretCiphertext: input.secretCiphertext,
        secretHint: input.secretHint,
        status: "active",
        createdByUserId: input.actorUserId,
        createdAt: input.now,
        usableUntil: null,
        revokedAt: null,
      });
      if (slots[0]) {
        await tx
          .update(credentialSlots)
          .set({
            name: input.slotName,
            provider: input.provider,
          })
          .where(
            and(
              eq(credentialSlots.workspaceId, input.workspaceId),
              eq(credentialSlots.id, slots[0].id),
            ),
          );
      } else {
        await tx.insert(credentialSlots).values({
          id: input.slotId,
          workspaceId: input.workspaceId,
          profileId: input.profileId,
          name: input.slotName,
          provider: input.provider,
          createdByUserId: input.actorUserId,
          createdAt: input.now,
        });
      }
      await tx.insert(credentialSecurityEvents).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        eventType: "profile.reprovisioned",
        actorUserId: input.actorUserId,
        profileId: input.profileId,
        versionId: input.versionId,
        details: {
          provider: input.provider,
          version: nextVersion,
          idempotencyKey: input.receipt.idempotencyKey,
          requestFingerprint: input.receipt.requestFingerprint,
        },
        createdAt: input.now,
      });
      const safe = await this.safeProfileWith(
        tx,
        input.workspaceId,
        input.profileId,
      );
      if (!safe) return { kind: "unavailable" };
      await storeHumanMutationReceipt(
        tx,
        input,
        profileReceiptValue(safe),
        input.now,
      );
      return { kind: "completed", value: safe, replayed: false };
    });
  }

  async rotateProfile(
    input: Parameters<CredentialVaultRepository["rotateProfile"]>[0],
  ): Promise<CredentialHumanMutationResult<SafeCredentialProfile>> {
    return this.getDatabase().transaction(async (tx) => {
      if (!(await manager(tx, input.workspaceId, input.actorUserId))) {
        return { kind: "unavailable" };
      }
      const receipt = await readHumanMutationReceipt(
        tx,
        input,
        profileFromReceipt,
      );
      if (receipt) return receipt;
      const rows = await tx
        .select()
        .from(credentialProfiles)
        .where(
          and(
            eq(credentialProfiles.id, input.profileId),
            eq(credentialProfiles.workspaceId, input.workspaceId),
            eq(credentialProfiles.status, "active"),
            eq(credentialProfiles.activeVersion, input.expectedActiveVersion),
            isNull(credentialProfiles.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      const profile = rows[0];
      if (!profile) return { kind: "unavailable" };
      const nextVersion = profile.activeVersion + 1;
      const oldVersion = await tx
        .update(credentialProfileVersions)
        .set({
          status: "superseded",
          usableUntil: input.overlapUntil,
        })
        .where(
          and(
            eq(credentialProfileVersions.workspaceId, input.workspaceId),
            eq(credentialProfileVersions.profileId, profile.id),
            eq(credentialProfileVersions.version, profile.activeVersion),
            eq(credentialProfileVersions.status, "active"),
          ),
        )
        .returning({ id: credentialProfileVersions.id });
      if (!oldVersion[0]) return { kind: "unavailable" };
      await tx.insert(credentialProfileVersions).values({
        id: input.versionId,
        workspaceId: input.workspaceId,
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
      await tx
        .update(credentialProfiles)
        .set({ activeVersion: nextVersion, updatedAt: input.now })
        .where(
          and(
            eq(credentialProfiles.workspaceId, input.workspaceId),
            eq(credentialProfiles.id, profile.id),
          ),
        );
      await tx.insert(credentialSecurityEvents).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        eventType: "profile.rotated",
        actorUserId: input.actorUserId,
        profileId: profile.id,
        versionId: input.versionId,
        details: {
          previousVersion: profile.activeVersion,
          version: nextVersion,
          idempotencyKey: input.receipt.idempotencyKey,
          requestFingerprint: input.receipt.requestFingerprint,
        },
        createdAt: input.now,
      });
      const safe = await this.safeProfileWith(tx, input.workspaceId, profile.id);
      if (!safe) return { kind: "unavailable" };
      await storeHumanMutationReceipt(
        tx,
        input,
        profileReceiptValue(safe),
        input.now,
      );
      return { kind: "completed", value: safe, replayed: false };
    });
  }

  async revokeVersion(
    input: Parameters<CredentialVaultRepository["revokeVersion"]>[0],
  ): Promise<boolean> {
    return this.getDatabase().transaction(async (tx) => {
      if (!(await manager(tx, input.workspaceId, input.actorUserId))) {
        return false;
      }
      const rows = await tx
        .select({
          profile: credentialProfiles,
          version: credentialProfileVersions,
        })
        .from(credentialProfiles)
        .innerJoin(
          credentialProfileVersions,
          and(
            eq(
              credentialProfileVersions.workspaceId,
              credentialProfiles.workspaceId,
            ),
            eq(credentialProfileVersions.profileId, credentialProfiles.id),
          ),
        )
        .where(
          and(
            eq(credentialProfiles.workspaceId, input.workspaceId),
            eq(credentialProfiles.id, input.profileId),
            eq(credentialProfileVersions.version, input.version),
            isNull(credentialProfiles.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      const row = rows[0];
      if (!row) return false;
      if (row.version.status === "revoked") return true;
      await tx
        .update(credentialProfileVersions)
        .set({
          status: "revoked",
          usableUntil: null,
          revokedAt: input.now,
        })
        .where(
          and(
            eq(credentialProfileVersions.workspaceId, input.workspaceId),
            eq(credentialProfileVersions.id, row.version.id),
          ),
        );
      if (row.profile.activeVersion === row.version.version) {
        await tx
          .update(credentialProfiles)
          .set({
            status: "disabled",
            enabled: false,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(credentialProfiles.workspaceId, input.workspaceId),
              eq(credentialProfiles.id, input.profileId),
            ),
          );
      }
      await tx.insert(credentialSecurityEvents).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        eventType: "version.revoked",
        actorUserId: input.actorUserId,
        profileId: input.profileId,
        versionId: row.version.id,
        details: { version: row.version.version },
        createdAt: input.now,
      });
      return true;
    });
  }

  async setProfileStatus(
    input: Parameters<CredentialVaultRepository["setProfileStatus"]>[0],
  ): ReturnType<CredentialVaultRepository["setProfileStatus"]> {
    return this.getDatabase().transaction(async (tx) => {
      if (!(await manager(tx, input.workspaceId, input.actorUserId))) {
        return { kind: "unavailable" as const };
      }
      const profiles = await tx
        .select()
        .from(credentialProfiles)
        .where(
          and(
            eq(credentialProfiles.id, input.profileId),
            eq(credentialProfiles.workspaceId, input.workspaceId),
            isNull(credentialProfiles.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      const profile = profiles[0];
      if (!profile) return { kind: "unavailable" as const };
      let versionId: string | undefined;
      if (input.status === "active") {
        const slots = await tx
          .select({
            id: credentialSlots.id,
            provider: credentialSlots.provider,
          })
          .from(credentialSlots)
          .where(
            and(
              eq(credentialSlots.workspaceId, input.workspaceId),
              eq(credentialSlots.profileId, input.profileId),
            ),
          )
          .limit(1)
          .for("update");
        const versions = await tx
          .select({ id: credentialProfileVersions.id })
          .from(credentialProfileVersions)
          .where(
            and(
              eq(credentialProfileVersions.workspaceId, input.workspaceId),
              eq(credentialProfileVersions.profileId, input.profileId),
              eq(
                credentialProfileVersions.version,
                profile.activeVersion,
              ),
              eq(credentialProfileVersions.status, "active"),
              isNull(credentialProfileVersions.revokedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!slots[0] || slots[0].provider !== profile.provider || !versions[0]) {
          return { kind: "conflict" as const };
        }
        versionId = versions[0].id;
      }
      const updated = await tx
        .update(credentialProfiles)
        .set({
          status: input.status,
          enabled: input.status === "active",
          updatedAt: input.now,
        })
        .where(
          and(
            eq(credentialProfiles.id, input.profileId),
            eq(credentialProfiles.workspaceId, input.workspaceId),
            isNull(credentialProfiles.deletedAt),
          ),
        )
        .returning({
          id: credentialProfiles.id,
          activeVersion: credentialProfiles.activeVersion,
        });
      if (!updated[0]) return { kind: "unavailable" as const };
      if (!versionId) {
        const version = await tx
          .select({ id: credentialProfileVersions.id })
          .from(credentialProfileVersions)
          .where(
            and(
              eq(credentialProfileVersions.workspaceId, input.workspaceId),
              eq(credentialProfileVersions.profileId, input.profileId),
              eq(
                credentialProfileVersions.version,
                updated[0].activeVersion,
              ),
            ),
          )
          .limit(1);
        versionId = version[0]?.id;
      }
      await tx.insert(credentialSecurityEvents).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        eventType: "profile.status_changed",
        actorUserId: input.actorUserId,
        profileId: input.profileId,
        versionId,
        details: { status: input.status },
        createdAt: input.now,
      });
      const safe = await this.safeProfileWith(
        tx,
        input.workspaceId,
        input.profileId,
      );
      return safe
        ? { kind: "completed" as const, value: safe }
        : { kind: "unavailable" as const };
    });
  }

  getSafeProfile(
    input: Parameters<CredentialVaultRepository["getSafeProfile"]>[0],
  ) {
    return this.safeProfileWith(
      this.getDatabase(),
      input.workspaceId,
      input.profileId,
    );
  }

  async listSafeProfiles(workspaceId: string): Promise<SafeCredentialProfile[]> {
    const rows = await this.getDatabase()
      .select({
        profile: credentialProfiles,
        slot: credentialSlots,
        version: credentialProfileVersions,
      })
      .from(credentialProfiles)
      .leftJoin(
        credentialSlots,
        and(
          eq(credentialSlots.profileId, credentialProfiles.id),
          eq(credentialSlots.workspaceId, credentialProfiles.workspaceId),
        ),
      )
      .leftJoin(
        credentialProfileVersions,
        and(
          eq(
            credentialProfileVersions.workspaceId,
            credentialProfiles.workspaceId,
          ),
          eq(credentialProfileVersions.profileId, credentialProfiles.id),
          eq(
            credentialProfileVersions.version,
            credentialProfiles.activeVersion,
          ),
        ),
      )
      .where(
        and(
          eq(credentialProfiles.workspaceId, workspaceId),
          isNull(credentialProfiles.deletedAt),
        ),
      );
    return rows.map(safeProfile);
  }

  async listSpendGrants(workspaceId: string): Promise<CredentialSpendGrant[]> {
    const database = this.getDatabase();
    const [grants, usageRows] = await Promise.all([
      database
        .select()
        .from(credentialSpendGrants)
        .where(eq(credentialSpendGrants.workspaceId, workspaceId)),
      database
        .select({
          grantId: credentialSpendEvents.spendGrantId,
          total: sql<number>`coalesce(sum(${credentialSpendEvents.priceCeilingCents}), 0)::int`,
        })
        .from(credentialSpendEvents)
        .where(
          and(
            eq(credentialSpendEvents.workspaceId, workspaceId),
            inArray(credentialSpendEvents.status, [
              "pending",
              "completed",
              "unknown",
            ]),
          ),
        )
        .groupBy(credentialSpendEvents.spendGrantId),
    ]);
    const usageByGrant = new Map(
      usageRows.map((usage) => [usage.grantId, Number(usage.total)]),
    );
    return grants.map((grant) => ({
      ...grant,
      mode: grant.mode as CredentialSpendGrant["mode"],
      status: grant.status as CredentialSpendGrant["status"],
      spentCents: usageByGrant.get(grant.id) ?? 0,
    }));
  }

  async listAuditEvents(
    input: Parameters<CredentialVaultRepository["listAuditEvents"]>[0],
  ): Promise<import("@/types").CredentialAuditEvent[]> {
    const database = this.getDatabase();
    const before = <Table extends { createdAt: unknown; id: unknown }>(
      table: Table,
    ) =>
      input.cursor
        ? or(
            lt(
              table.createdAt as Parameters<typeof lt>[0],
              input.cursor.createdAt,
            ),
            and(
              eq(
                table.createdAt as Parameters<typeof eq>[0],
                input.cursor.createdAt,
              ),
              lt(table.id as Parameters<typeof lt>[0], input.cursor.id),
            ),
          )
        : undefined;
    const [credentialRows, agentRows, effectRows] = await Promise.all([
      database
        .select()
        .from(credentialSecurityEvents)
        .where(
          and(
            eq(credentialSecurityEvents.workspaceId, input.workspaceId),
            ne(credentialSecurityEvents.eventType, "effect.reserved"),
            ne(credentialSecurityEvents.eventType, "effect.replayed"),
            before(credentialSecurityEvents),
          ),
        )
        .orderBy(
          desc(credentialSecurityEvents.createdAt),
          desc(credentialSecurityEvents.id),
        )
        .limit(input.limit),
      database
        .select()
        .from(agentSecurityEvents)
        .where(
          and(
            eq(agentSecurityEvents.workspaceId, input.workspaceId),
            before(agentSecurityEvents),
          ),
        )
        .orderBy(
          desc(agentSecurityEvents.createdAt),
          desc(agentSecurityEvents.id),
        )
        .limit(input.limit),
      database
        .select()
        .from(credentialEffectAuditEvents)
        .where(
          and(
            eq(credentialEffectAuditEvents.workspaceId, input.workspaceId),
            before(credentialEffectAuditEvents),
          ),
        )
        .orderBy(
          desc(credentialEffectAuditEvents.createdAt),
          desc(credentialEffectAuditEvents.id),
        )
        .limit(input.limit),
    ]);
    return [
      ...credentialRows.map((event) => ({
        id: event.id,
        workspaceId: event.workspaceId,
        source: "credential" as const,
        eventType: event.eventType,
        outcome: "succeeded" as const,
        reason:
          typeof event.details.reason === "string"
            ? event.details.reason
            : null,
        actorUserId: event.actorUserId,
        principalId: event.principalId,
        profileId: event.profileId,
        correlationRef:
          typeof event.details.correlationRef === "string"
            ? event.details.correlationRef
            : typeof event.details.requestFingerprint === "string"
              ? event.details.requestFingerprint
              : null,
        idempotencyKey:
          typeof event.details.idempotencyKey === "string"
            ? event.details.idempotencyKey
            : event.effectRef,
        effectRef: event.effectRef,
        effectSequence: null,
        createdAt: event.createdAt,
      })),
      ...agentRows.map((event) => ({
        id: event.id,
        workspaceId: event.workspaceId,
        source: "agent" as const,
        eventType: event.eventType,
        outcome:
          event.eventType === "authorization.denied"
            ? ("denied" as const)
            : ("succeeded" as const),
        reason: event.reason,
        actorUserId: event.actorUserId,
        principalId: event.principalId,
        profileId: null,
        correlationRef: event.changeRef,
        idempotencyKey: null,
        effectRef: null,
        effectSequence: null,
        createdAt: event.createdAt,
      })),
      ...effectRows.map((event) => ({
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
      })),
    ]
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
    return this.getDatabase().transaction(async (tx) => {
      if (!(await manager(tx, input.workspaceId, input.actorUserId))) {
        return { kind: "unavailable" };
      }
      const receipt = await readHumanMutationReceipt(
        tx,
        input,
        grantFromReceipt,
      );
      if (receipt) return receipt;
      const principalAndProfile = await tx
        .select({ principalId: agentPrincipals.id })
        .from(agentPrincipals)
        .innerJoin(
          credentialProfiles,
          eq(credentialProfiles.id, input.profileId),
        )
        .innerJoin(
          credentialSlots,
          and(
            eq(credentialSlots.workspaceId, credentialProfiles.workspaceId),
            eq(credentialSlots.profileId, credentialProfiles.id),
            eq(credentialSlots.provider, credentialProfiles.provider),
          ),
        )
        .innerJoin(
          credentialProfileVersions,
          and(
            eq(
              credentialProfileVersions.workspaceId,
              credentialProfiles.workspaceId,
            ),
            eq(
              credentialProfileVersions.profileId,
              credentialProfiles.id,
            ),
            eq(
              credentialProfileVersions.version,
              credentialProfiles.activeVersion,
            ),
          ),
        )
        .where(
          and(
            eq(agentPrincipals.id, input.principalId),
            eq(agentPrincipals.workspaceId, input.workspaceId),
            eq(agentPrincipals.status, "active"),
            eq(credentialProfiles.workspaceId, input.workspaceId),
            eq(credentialProfiles.status, "active"),
            eq(credentialProfiles.enabled, true),
            eq(credentialProfileVersions.status, "active"),
            isNull(credentialProfileVersions.revokedAt),
            isNull(agentPrincipals.revokedAt),
            isNull(credentialProfiles.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!principalAndProfile[0]) return { kind: "unavailable" };
      const existing = await tx
        .select({ id: credentialSpendGrants.id })
        .from(credentialSpendGrants)
        .where(
          and(
            eq(credentialSpendGrants.workspaceId, input.workspaceId),
            eq(credentialSpendGrants.principalId, input.principalId),
            eq(credentialSpendGrants.profileId, input.profileId),
            eq(credentialSpendGrants.status, "active"),
          ),
        )
        .limit(1)
        .for("update");
      if (existing[0]) return { kind: "unavailable" };
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
      await tx.insert(credentialSpendGrants).values({
        id: grant.id,
        workspaceId: grant.workspaceId,
        principalId: grant.principalId,
        profileId: grant.profileId,
        mode: grant.mode,
        limitCents: grant.limitCents,
        status: grant.status,
        createdByUserId: grant.createdByUserId,
        createdAt: grant.createdAt,
        revokedAt: grant.revokedAt,
      });
      await tx.insert(credentialSecurityEvents).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        eventType: "spend_grant.created",
        actorUserId: input.actorUserId,
        principalId: input.principalId,
        profileId: input.profileId,
        spendGrantId: input.id,
        details: {
          mode: input.mode,
          limitCents: input.limitCents,
          idempotencyKey: input.receipt.idempotencyKey,
          requestFingerprint: input.receipt.requestFingerprint,
        },
        createdAt: input.now,
      });
      await storeHumanMutationReceipt(
        tx,
        input,
        grantReceiptValue(grant),
        input.now,
      );
      return { kind: "completed", value: grant, replayed: false };
    });
  }

  async revokeSpendGrant(
    input: Parameters<CredentialVaultRepository["revokeSpendGrant"]>[0],
  ): Promise<boolean> {
    return this.getDatabase().transaction(async (tx) => {
      if (!(await manager(tx, input.workspaceId, input.actorUserId))) {
        return false;
      }
      const existing = await tx
        .select({
          id: credentialSpendGrants.id,
          status: credentialSpendGrants.status,
        })
        .from(credentialSpendGrants)
        .where(
          and(
            eq(credentialSpendGrants.id, input.grantId),
            eq(credentialSpendGrants.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
        .for("update");
      if (!existing[0]) return false;
      if (existing[0].status === "revoked") return true;
      const rows = await tx
        .update(credentialSpendGrants)
        .set({ status: "revoked", revokedAt: input.now })
        .where(
          and(
            eq(credentialSpendGrants.id, input.grantId),
            eq(credentialSpendGrants.workspaceId, input.workspaceId),
            eq(credentialSpendGrants.status, "active"),
          ),
        )
        .returning({
          id: credentialSpendGrants.id,
          principalId: credentialSpendGrants.principalId,
          profileId: credentialSpendGrants.profileId,
        });
      if (!rows[0]) return false;
      await tx.insert(credentialSecurityEvents).values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        eventType: "spend_grant.revoked",
        actorUserId: input.actorUserId,
        principalId: rows[0].principalId,
        profileId: rows[0].profileId,
        spendGrantId: rows[0].id,
        details: {},
        createdAt: input.now,
      });
      return true;
    });
  }

  async snapshotEffectTarget(
    input: Parameters<CredentialVaultRepository["snapshotEffectTarget"]>[0],
  ) {
    const rows = await this.getDatabase()
      .select({
        profile: credentialProfiles,
        version: credentialProfileVersions,
        grant: credentialSpendGrants,
      })
      .from(credentialSlots)
      .innerJoin(
        credentialProfiles,
        and(
          eq(credentialProfiles.workspaceId, credentialSlots.workspaceId),
          eq(credentialProfiles.id, credentialSlots.profileId),
        ),
      )
      .innerJoin(
        credentialProfileVersions,
        and(
          eq(
            credentialProfileVersions.workspaceId,
            credentialProfiles.workspaceId,
          ),
          eq(credentialProfileVersions.profileId, credentialProfiles.id),
          eq(
            credentialProfileVersions.version,
            credentialProfiles.activeVersion,
          ),
        ),
      )
      .innerJoin(
        credentialSpendGrants,
        and(
          eq(
            credentialSpendGrants.workspaceId,
            credentialProfiles.workspaceId,
          ),
          eq(credentialSpendGrants.profileId, credentialProfiles.id),
          eq(credentialSpendGrants.principalId, input.principalId),
        ),
      )
      .innerJoin(
        agentPrincipals,
        and(
          eq(agentPrincipals.workspaceId, credentialSlots.workspaceId),
          eq(agentPrincipals.id, input.principalId),
        ),
      )
      .where(
        and(
          eq(credentialSlots.workspaceId, input.workspaceId),
          eq(credentialSlots.id, input.slotId),
          eq(credentialProfiles.status, "active"),
          eq(credentialProfiles.enabled, true),
          isNull(credentialProfiles.deletedAt),
          eq(credentialProfileVersions.status, "active"),
          isNull(credentialProfileVersions.revokedAt),
          eq(credentialSpendGrants.status, "active"),
          isNull(credentialSpendGrants.revokedAt),
          eq(agentPrincipals.status, "active"),
          isNull(agentPrincipals.revokedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row
      ? {
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          slotId: input.slotId,
          profileId: row.profile.id,
          versionId: row.version.id,
          version: row.version.version,
          provider: row.profile.provider,
          spendGrantId: row.grant.id,
        }
      : null;
  }

  async resolveWorkflowStepBinding(
    input: Parameters<
      CredentialVaultRepository["resolveWorkflowStepBinding"]
    >[0],
  ) {
    const rows = await this.getDatabase()
      .select({
        id: projects.id,
        workflowJson: projects.workflowJson,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.step.workflowId),
          eq(projects.workspaceId, input.workspaceId),
          eq(projects.status, "active"),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    const project = rows[0];
    if (
      !project ||
      input.step.workflowRevision !==
        canonicalDigest({
          workflowId: project.id,
          workflow: project.workflowJson,
        })
    ) {
      return null;
    }
    const bindings = parseWorkflowCredentialSlots(
      project.workflowJson?.credentialSlots,
      project.workflowJson?.nodes,
    );
    return (
      bindings.find(
        (binding) =>
          binding.nodeId === input.step.nodeId &&
          binding.operationIdentity === input.step.operationIdentity,
      ) ?? null
    );
  }

  async loadEffectMaterial(input: {
    intent: CredentialEffectIntent;
    now: Date;
  }) {
    const { intent } = input;
    const rows = await this.getDatabase()
      .select({ version: credentialProfileVersions })
      .from(credentialSlots)
      .innerJoin(
        credentialProfiles,
        and(
          eq(credentialProfiles.workspaceId, credentialSlots.workspaceId),
          eq(credentialProfiles.id, credentialSlots.profileId),
        ),
      )
      .innerJoin(
        credentialProfileVersions,
        and(
          eq(
            credentialProfileVersions.workspaceId,
            credentialProfiles.workspaceId,
          ),
          eq(credentialProfileVersions.profileId, credentialProfiles.id),
        ),
      )
      .innerJoin(
        credentialSpendGrants,
        and(
          eq(
            credentialSpendGrants.workspaceId,
            credentialProfiles.workspaceId,
          ),
          eq(credentialSpendGrants.profileId, credentialProfiles.id),
        ),
      )
      .innerJoin(
        agentPrincipals,
        and(
          eq(agentPrincipals.workspaceId, credentialProfiles.workspaceId),
          eq(agentPrincipals.id, intent.principalId),
        ),
      )
      .where(
        and(
          eq(credentialSlots.workspaceId, intent.workspaceId),
          eq(credentialSlots.id, intent.slotId),
          eq(credentialProfiles.id, intent.profileId),
          eq(credentialProfiles.provider, intent.provider),
          eq(credentialProfiles.status, "active"),
          eq(credentialProfiles.enabled, true),
          isNull(credentialProfiles.deletedAt),
          eq(credentialProfileVersions.id, intent.versionId),
          eq(credentialProfileVersions.version, intent.version),
          isNull(credentialProfileVersions.revokedAt),
          or(
            eq(credentialProfileVersions.status, "active"),
            and(
              eq(credentialProfileVersions.status, "superseded"),
              gte(credentialProfileVersions.usableUntil, input.now),
            ),
          ),
          eq(credentialSpendGrants.id, intent.spendGrantId),
          eq(credentialSpendGrants.principalId, intent.principalId),
          eq(credentialSpendGrants.status, "active"),
          isNull(credentialSpendGrants.revokedAt),
          eq(agentPrincipals.status, "active"),
          isNull(agentPrincipals.revokedAt),
        ),
      )
      .limit(1);
    return rows[0]
      ? {
          workspaceId: intent.workspaceId,
          principalId: intent.principalId,
          slotId: intent.slotId,
          profileId: intent.profileId,
          versionId: intent.versionId,
          version: intent.version,
          provider: intent.provider,
          spendGrantId: intent.spendGrantId,
          secretCiphertext: rows[0].version.secretCiphertext,
        }
      : null;
  }

  async readEffectReceipt(
    input: Parameters<CredentialVaultRepository["readEffectReceipt"]>[0],
  ) {
    return this.getDatabase().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.effectRef}`}, 0))`,
      );
      const rows = await tx
        .select()
        .from(credentialSpendEvents)
        .where(
          and(
            eq(credentialSpendEvents.workspaceId, input.workspaceId),
            eq(credentialSpendEvents.effectRef, input.effectRef),
          ),
        )
        .limit(1)
        .for("update");
      const receipt = rows[0];
      if (!receipt) return { kind: "absent" as const };
      if (receipt.requestFingerprint !== input.requestFingerprint) {
        return { kind: "conflict" as const };
      }
      if (receipt.status === "pending" || receipt.status === "unknown") {
        return {
          kind: "reconciliation_required" as const,
          status: receipt.status as "pending" | "unknown",
        };
      }
      if (receipt.status !== "completed" || receipt.safeResult === null) {
        return { kind: "unavailable" as const };
      }
      await appendEffectAuditEvents(
        tx,
        receipt,
        [{ eventType: "effect.replayed" }],
        input.now,
      );
      return {
        kind: "completed" as const,
        target: {
          workspaceId: receipt.workspaceId,
          principalId: receipt.principalId,
          slotId: receipt.slotId,
          profileId: receipt.profileId,
          versionId: receipt.versionId,
          version: receipt.resolvedVersion,
          provider: receipt.resolvedProvider,
          spendGrantId: receipt.spendGrantId,
        },
        safeResult: receipt.safeResult as CredentialSafeEffectResult,
      };
    });
  }

  async reserveEffect(
    input: Parameters<CredentialVaultRepository["reserveEffect"]>[0],
  ) {
    if (
      !Number.isInteger(input.priceCeilingCents) ||
      input.priceCeilingCents < 0 ||
      input.priceCeilingCents > 2_147_483_647
    ) {
      return { kind: "unavailable" as const };
    }
    const { intent } = input;
    return this.getDatabase().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${intent.workspaceId}:${intent.effectRef}`}, 0))`,
      );
      const receipts = await tx
        .select()
        .from(credentialSpendEvents)
        .where(
          and(
            eq(credentialSpendEvents.workspaceId, intent.workspaceId),
            eq(credentialSpendEvents.effectRef, intent.effectRef),
          ),
        )
        .limit(1)
        .for("update");
      const receipt = receipts[0];
      if (receipt) {
        if (receipt.requestFingerprint !== input.requestFingerprint) {
          return { kind: "conflict" as const };
        }
        if (receipt.status === "pending" || receipt.status === "unknown") {
          return {
            kind: "reconciliation_required" as const,
            status: receipt.status as "pending" | "unknown",
          };
        }
        if (receipt.status !== "completed" || receipt.safeResult === null) {
          return { kind: "unavailable" as const };
        }
        const target = {
          workspaceId: receipt.workspaceId,
          principalId: receipt.principalId,
          slotId: receipt.slotId,
          profileId: receipt.profileId,
          versionId: receipt.versionId,
          version: receipt.resolvedVersion,
          provider: receipt.resolvedProvider,
          spendGrantId: receipt.spendGrantId,
        };
        await appendEffectAuditEvents(
          tx,
          receipt,
          [{ eventType: "effect.replayed" }],
          input.now,
        );
        return {
          kind: "completed" as const,
          target,
          safeResult: receipt.safeResult as CredentialSafeEffectResult,
        };
      }
      const rows = await tx
        .select({
          profile: credentialProfiles,
          version: credentialProfileVersions,
          grant: credentialSpendGrants,
        })
        .from(credentialSlots)
        .innerJoin(
          credentialProfiles,
          and(
            eq(credentialProfiles.workspaceId, credentialSlots.workspaceId),
            eq(credentialProfiles.id, credentialSlots.profileId),
          ),
        )
        .innerJoin(
          credentialProfileVersions,
          and(
            eq(
              credentialProfileVersions.workspaceId,
              credentialProfiles.workspaceId,
            ),
            eq(credentialProfileVersions.profileId, credentialProfiles.id),
          ),
        )
        .innerJoin(
          credentialSpendGrants,
          and(
            eq(
              credentialSpendGrants.workspaceId,
              credentialProfiles.workspaceId,
            ),
            eq(credentialSpendGrants.profileId, credentialProfiles.id),
          ),
        )
        .innerJoin(
          agentPrincipals,
          and(
            eq(agentPrincipals.workspaceId, credentialProfiles.workspaceId),
            eq(agentPrincipals.id, intent.principalId),
          ),
        )
        .where(
          and(
            eq(credentialSlots.workspaceId, intent.workspaceId),
            eq(credentialSlots.id, intent.slotId),
            eq(credentialProfiles.id, intent.profileId),
            eq(credentialProfiles.provider, intent.provider),
            eq(credentialProfiles.status, "active"),
            eq(credentialProfiles.enabled, true),
            isNull(credentialProfiles.deletedAt),
            eq(credentialProfileVersions.id, intent.versionId),
            eq(credentialProfileVersions.version, intent.version),
            isNull(credentialProfileVersions.revokedAt),
            or(
              eq(credentialProfileVersions.status, "active"),
              and(
                eq(credentialProfileVersions.status, "superseded"),
                gte(credentialProfileVersions.usableUntil, input.now),
              ),
            ),
            eq(credentialSpendGrants.id, intent.spendGrantId),
            eq(credentialSpendGrants.principalId, intent.principalId),
            eq(credentialSpendGrants.status, "active"),
            isNull(credentialSpendGrants.revokedAt),
            eq(agentPrincipals.status, "active"),
            isNull(agentPrincipals.revokedAt),
          ),
        )
        .limit(1)
        .for("update");
      const row = rows[0];
      if (!row) return { kind: "unavailable" as const };
      const mode = row.grant.mode as CredentialSpendGrant["mode"];
      const usage = await tx
        .select({
          total: sql<number>`coalesce(sum(${credentialSpendEvents.priceCeilingCents}), 0)::int`,
        })
        .from(credentialSpendEvents)
        .where(
          and(
            eq(credentialSpendEvents.workspaceId, intent.workspaceId),
            eq(credentialSpendEvents.spendGrantId, row.grant.id),
            inArray(credentialSpendEvents.status, [
              "pending",
              "completed",
              "unknown",
            ]),
          ),
        );
      const nextSpend =
        Number(usage[0]?.total ?? 0) + input.priceCeilingCents;
      if (
        nextSpend > 2_147_483_647 ||
        (mode === "bounded" &&
          (row.grant.limitCents === null ||
            nextSpend > row.grant.limitCents))
      ) {
        return { kind: "unavailable" as const };
      }
      const inserted = await tx.insert(credentialSpendEvents).values({
        id: input.eventId,
        workspaceId: intent.workspaceId,
        principalId: intent.principalId,
        slotId: intent.slotId,
        profileId: intent.profileId,
        versionId: intent.versionId,
        spendGrantId: intent.spendGrantId,
        priceCeilingCents: input.priceCeilingCents,
        mode,
        effectRef: intent.effectRef,
        requestFingerprint: input.requestFingerprint,
        resolvedVersion: intent.version,
        resolvedProvider: intent.provider,
        status: "pending",
        updatedAt: input.now,
        createdAt: input.now,
      }).returning();
      const insertedReceipt = inserted[0];
      if (!insertedReceipt) return { kind: "unavailable" as const };
      await appendEffectAuditEvents(
        tx,
        insertedReceipt,
        [{ eventType: "effect.reserved" }],
        input.now,
      );
      return {
        kind: "reserved" as const,
        target: {
          workspaceId: intent.workspaceId,
          principalId: intent.principalId,
          slotId: intent.slotId,
          profileId: intent.profileId,
          versionId: intent.versionId,
          version: intent.version,
          provider: intent.provider,
          spendGrantId: intent.spendGrantId,
        },
      };
    });
  }

  async completeEffect(
    input: Parameters<CredentialVaultRepository["completeEffect"]>[0],
  ): Promise<boolean> {
    if (input.safeResult === null) return false;
    return this.getDatabase().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.effectRef}`}, 0))`,
      );
      const receipts = await tx
        .select()
        .from(credentialSpendEvents)
        .where(
          and(
            eq(credentialSpendEvents.workspaceId, input.workspaceId),
            eq(credentialSpendEvents.effectRef, input.effectRef),
          ),
        )
        .limit(1)
        .for("update");
      const receipt = receipts[0];
      if (!receipt || receipt.requestFingerprint !== input.requestFingerprint) {
        return false;
      }
      if (receipt.status === "completed") return true;
      if (receipt.status !== "pending") return false;
      const updated = await tx
        .update(credentialSpendEvents)
        .set({
          status: "completed",
          safeResult: input.safeResult,
          completedAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(credentialSpendEvents.id, receipt.id),
            eq(credentialSpendEvents.status, "pending"),
          ),
        )
        .returning({ id: credentialSpendEvents.id });
      if (!updated[0]) return false;
      await appendEffectAuditEvents(
        tx,
        receipt,
        [{ eventType: "effect.completed" }],
        input.now,
      );
      return true;
    });
  }

  async failEffectBeforeStart(
    input: Parameters<CredentialVaultRepository["failEffectBeforeStart"]>[0],
  ): Promise<boolean> {
    return this.transitionPendingEffect({
      ...input,
      status: "failed",
    });
  }

  async markEffectUnknown(
    input: Parameters<CredentialVaultRepository["markEffectUnknown"]>[0],
  ): Promise<boolean> {
    return this.transitionPendingEffect({
      ...input,
      status: "unknown",
    });
  }

  private async transitionPendingEffect(input: {
    workspaceId: string;
    effectRef: string;
    requestFingerprint: string;
    failureCode: string;
    status: "failed" | "unknown";
    now: Date;
  }): Promise<boolean> {
    if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(input.failureCode)) return false;
    return this.getDatabase().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.effectRef}`}, 0))`,
      );
      const receipts = await tx
        .select()
        .from(credentialSpendEvents)
        .where(
          and(
            eq(credentialSpendEvents.workspaceId, input.workspaceId),
            eq(credentialSpendEvents.effectRef, input.effectRef),
          ),
        )
        .limit(1)
        .for("update");
      const receipt = receipts[0];
      if (!receipt || receipt.requestFingerprint !== input.requestFingerprint) {
        return false;
      }
      if (
        receipt.status === input.status &&
        receipt.failureCode === input.failureCode
      ) {
        return true;
      }
      if (receipt.status !== "pending") return false;
      const updated = await tx
        .update(credentialSpendEvents)
        .set({
          status: input.status,
          failureCode: input.failureCode,
          failedAt: input.status === "failed" ? input.now : null,
          unknownAt: input.status === "unknown" ? input.now : null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(credentialSpendEvents.id, receipt.id),
            eq(credentialSpendEvents.status, "pending"),
          ),
        )
        .returning({ id: credentialSpendEvents.id });
      if (!updated[0]) return false;
      await appendEffectAuditEvents(
        tx,
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
    });
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
    return this.getDatabase().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.workspaceId}:${input.effectRef}`}, 0))`,
      );
      const receipts = await tx
        .select()
        .from(credentialSpendEvents)
        .where(
          and(
            eq(credentialSpendEvents.workspaceId, input.workspaceId),
            eq(credentialSpendEvents.effectRef, input.effectRef),
          ),
        )
        .limit(1)
        .for("update");
      const receipt = receipts[0];
      if (!receipt || receipt.requestFingerprint !== input.requestFingerprint) {
        return false;
      }
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
      const completed = input.resolution.kind === "completed";
      const updated = await tx
        .update(credentialSpendEvents)
        .set({
          status: completed ? "completed" : "failed",
          safeResult:
            input.resolution.kind === "completed"
              ? input.resolution.safeResult
              : null,
          failureCode:
            input.resolution.kind === "failed"
              ? input.resolution.failureCode
              : null,
          completedAt: completed ? input.now : null,
          failedAt: completed ? null : input.now,
          unknownAt: null,
          reconciliationReference: input.reconciliationReference,
          reconciledAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(credentialSpendEvents.id, receipt.id))
        .returning({ id: credentialSpendEvents.id });
      if (!updated[0]) return false;
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
      await appendEffectAuditEvents(
        tx,
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
    });
  }

  private async safeProfileWith(
    database: Db | Tx,
    workspaceId: string,
    profileId: string,
  ): Promise<SafeCredentialProfile | null> {
    const rows = await database
      .select({
        profile: credentialProfiles,
        slot: credentialSlots,
        version: credentialProfileVersions,
      })
      .from(credentialProfiles)
      .innerJoin(
        credentialSlots,
        and(
          eq(credentialSlots.profileId, credentialProfiles.id),
          eq(credentialSlots.workspaceId, credentialProfiles.workspaceId),
        ),
      )
      .innerJoin(
        credentialProfileVersions,
        and(
          eq(
            credentialProfileVersions.workspaceId,
            credentialProfiles.workspaceId,
          ),
          eq(credentialProfileVersions.profileId, credentialProfiles.id),
          eq(
            credentialProfileVersions.version,
            credentialProfiles.activeVersion,
          ),
        ),
      )
      .where(
        and(
          eq(credentialProfiles.id, profileId),
          eq(credentialProfiles.workspaceId, workspaceId),
          isNull(credentialProfiles.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? safeProfile(rows[0]) : null;
  }
}
