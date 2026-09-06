import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  account,
  identityErasureReceipts,
  invitation,
  marketingAttributionConsents,
  marketingAttributionEvents,
  member,
  onboardingAnalyticsEvents,
  onboardingCommandReceipts,
  onboardingSessions,
  session,
  socialEventReads,
  socialNotificationPreferences,
  user,
  userPreferences,
  verification,
  workspaceGovernanceResources,
  workspaceInterfaceLocalePreferences,
  workspaceMembers,
  workspaceNotificationPreferences,
  workspaceNotificationRecipients,
  workspaces,
} from "@/lib/db/schema";
import {
  projectIdentityErasurePreflight,
  type IdentityErasureOwnedWorkspace,
  type IdentityErasurePreflight,
} from "./identity-erasure-contract";

const TERMINAL_CLOSURE_STATUSES = ["closed", "closed_retained"] as const;
const ACTIVE_MEMBERSHIP_PROJECTION_STATUSES = [
  "queued",
  "retry_pending",
  "processing",
] as const;

export type IdentityErasureErrorCode =
  | "IDENTITY_NOT_FOUND"
  | "IDENTITY_ALREADY_ERASED"
  | "ACTIVE_OWNED_WORKSPACE";

export class IdentityErasureError extends Error {
  constructor(
    readonly code: IdentityErasureErrorCode,
    readonly status: 404 | 409 | 410,
  ) {
    super(code);
    this.name = "IdentityErasureError";
  }
}

interface ErasureCounts extends Record<string, number> {
  accounts: number;
  sessions: number;
  memberships: number;
  preferences: number;
  onboardingRecords: number;
  notificationRecords: number;
  invitations: number;
  analyticsPseudonymized: number;
  attributionEventsScrubbed: number;
  attributionConsentsRevoked: number;
  governanceInvitationsScrubbed: number;
  governanceAssignmentsRevoked: number;
  governanceProjectionsCancelled: number;
}

export interface IdentityErasureResult {
  schema: "identity-erasure-result/v1";
  receiptId: string;
  completedAt: string;
  counts: ErasureCounts;
}

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function receiptId(): string {
  return `ier_${randomUUID().replaceAll("-", "")}`;
}

function requestDigest(userId: string, requestedAt: Date): string {
  const canonical = JSON.stringify({
    schema: "identity-erasure-request/v1",
    userId,
    requestedAt: requestedAt.toISOString(),
    confirmation: "ERASE",
    accessLossAcknowledged: true,
    membershipRemovalAcknowledged: true,
    exportHandled: true,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

async function ownedWorkspaceRows(
  database: Database | Transaction,
  userId: string,
): Promise<IdentityErasureOwnedWorkspace[]> {
  const rows = await database
    .select({
      id: workspaces.id,
      name: workspaces.name,
      closureStatus: workspaceGovernanceResources.status,
    })
    .from(workspaces)
    .leftJoin(
      workspaceGovernanceResources,
      and(
        eq(workspaceGovernanceResources.workspaceId, workspaces.id),
        eq(workspaceGovernanceResources.kind, "workspace_closure"),
        inArray(workspaceGovernanceResources.status, TERMINAL_CLOSURE_STATUSES),
      ),
    )
    .where(and(eq(workspaces.ownerUserId, userId), isNull(workspaces.deletedAt)));

  const byWorkspace = new Map<string, IdentityErasureOwnedWorkspace>();
  for (const row of rows) {
    const current = byWorkspace.get(row.id);
    const closed = TERMINAL_CLOSURE_STATUSES.includes(
      row.closureStatus as (typeof TERMINAL_CLOSURE_STATUSES)[number],
    );
    byWorkspace.set(row.id, {
      id: row.id,
      name: row.name,
      lifecycle: closed || current?.lifecycle === "closed" ? "closed" : "active",
    });
  }
  return [...byWorkspace.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function getIdentityErasurePreflight(
  userId: string,
): Promise<IdentityErasurePreflight> {
  const database = getDb();
  const [identity, receipt, providerRows, membershipRows, ownedWorkspaces] =
    await Promise.all([
      database.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1),
      database
        .select({ receiptId: identityErasureReceipts.receiptId })
        .from(identityErasureReceipts)
        .where(eq(identityErasureReceipts.userId, userId))
        .limit(1),
      database
        .select({ providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, userId)),
      database
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, userId)),
      ownedWorkspaceRows(database, userId),
    ]);

  if (!identity[0]) throw new IdentityErasureError("IDENTITY_NOT_FOUND", 404);
  if (receipt[0]) throw new IdentityErasureError("IDENTITY_ALREADY_ERASED", 410);

  return projectIdentityErasurePreflight({
    accountProviders: providerRows.map((row) => row.providerId),
    membershipCount: membershipRows.length,
    ownedWorkspaces,
  });
}

async function cancelAttribution(
  tx: Transaction,
  userId: string,
  at: Date,
): Promise<{ events: number; consents: number }> {
  const workspaceRows = await tx
    .select({ workspaceId: marketingAttributionConsents.workspaceId })
    .from(marketingAttributionConsents)
    .where(eq(marketingAttributionConsents.userId, userId));
  const workspaceIds = [...new Set(workspaceRows.map((row) => row.workspaceId))].sort();

  for (const workspaceId of workspaceIds) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`marketing-consent:${workspaceId}:${userId}:x_ads`}, 0))`,
    );
  }

  const consentRows = await tx
    .select()
    .from(marketingAttributionConsents)
    .where(eq(marketingAttributionConsents.userId, userId))
    .orderBy(
      marketingAttributionConsents.workspaceId,
      sql`${marketingAttributionConsents.revision} desc`,
    );
  const latestByWorkspace = new Map<
    string,
    (typeof consentRows)[number]
  >();
  for (const row of consentRows) {
    if (!latestByWorkspace.has(row.workspaceId)) latestByWorkspace.set(row.workspaceId, row);
  }

  let consents = 0;
  for (const latest of latestByWorkspace.values()) {
    if (latest.status !== "active") continue;
    const expiresAt = new Date(Math.max(latest.expiresAt.getTime(), at.getTime() + 1));
    await tx.insert(marketingAttributionConsents).values({
      workspaceId: latest.workspaceId,
      userId,
      provider: latest.provider,
      revision: latest.revision + 1,
      purpose: latest.purpose,
      status: "revoked",
      noticeVersion: latest.noticeVersion,
      regionReviewVersion: latest.regionReviewVersion,
      issuedAt: at,
      expiresAt,
    });
    consents += 1;
  }

  const eventRows = await tx
    .select({ workspaceId: marketingAttributionEvents.workspaceId, id: marketingAttributionEvents.id })
    .from(marketingAttributionEvents)
    .where(eq(marketingAttributionEvents.userId, userId));

  await tx
    .update(marketingAttributionEvents)
    .set({
      state: "cancelled",
      failureCode: "IDENTITY_ERASED",
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: at,
      updatedAt: at,
    })
    .where(
      and(
        eq(marketingAttributionEvents.userId, userId),
        inArray(marketingAttributionEvents.state, ["queued", "failed_known"]),
      ),
    );
  await tx
    .update(marketingAttributionEvents)
    .set({
      state: "outcome_unknown",
      failureCode: "IDENTITY_ERASED_DURING_DELIVERY",
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: at,
      updatedAt: at,
    })
    .where(
      and(
        eq(marketingAttributionEvents.userId, userId),
        eq(marketingAttributionEvents.state, "delivering"),
      ),
    );
  await tx
    .update(marketingAttributionEvents)
    .set({ payload: {}, updatedAt: at })
    .where(eq(marketingAttributionEvents.userId, userId));

  return { events: eventRows.length, consents };
}

export async function eraseIdentity(input: {
  userId: string;
  requestedAt?: Date;
}): Promise<IdentityErasureResult> {
  const database = getDb();
  const requestedAt = input.requestedAt ?? new Date();
  const newReceiptId = receiptId();
  const tombstoneEmail = `erased+${newReceiptId.slice(4)}@deleted.invalid`;

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`identity-erasure:${input.userId}`}, 0))`,
    );
    const [identity] = await tx
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update")
      .limit(1);
    if (!identity) throw new IdentityErasureError("IDENTITY_NOT_FOUND", 404);

    const [existing] = await tx
      .select({ receiptId: identityErasureReceipts.receiptId })
      .from(identityErasureReceipts)
      .where(eq(identityErasureReceipts.userId, input.userId))
      .limit(1);
    if (existing) throw new IdentityErasureError("IDENTITY_ALREADY_ERASED", 410);

    const ownedWorkspaces = await ownedWorkspaceRows(tx, input.userId);
    if (ownedWorkspaces.some((workspace) => workspace.lifecycle === "active")) {
      throw new IdentityErasureError("ACTIVE_OWNED_WORKSPACE", 409);
    }

    const completedAt = new Date(Math.max(Date.now(), requestedAt.getTime()));
    const analytics = await tx
      .update(onboardingAnalyticsEvents)
      .set({ userId: null, sessionId: null })
      .where(eq(onboardingAnalyticsEvents.userId, input.userId))
      .returning({ id: onboardingAnalyticsEvents.id });
    const attribution = await cancelAttribution(tx, input.userId, completedAt);

    const cancelledProjections = await tx
      .update(workspaceGovernanceResources)
      .set({
        version: sql`${workspaceGovernanceResources.version} + 1`,
        status: "dead_letter",
        body: sql`jsonb_set(jsonb_set(${workspaceGovernanceResources.body}, '{lease}', 'null'::jsonb, true), '{lastErrorCode}', to_jsonb('IDENTITY_ERASED'::text), true)`,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(workspaceGovernanceResources.kind, "membership_projection"),
          inArray(workspaceGovernanceResources.status, ACTIVE_MEMBERSHIP_PROJECTION_STATUSES),
          or(
            sql`${workspaceGovernanceResources.body}->>'userId' = ${input.userId}`,
            sql`${workspaceGovernanceResources.body}->>'currentOwnerUserId' = ${input.userId}`,
            sql`${workspaceGovernanceResources.body}->>'newOwnerUserId' = ${input.userId}`,
          ),
        ),
      )
      .returning({ id: workspaceGovernanceResources.id });

    const scrubbedGovernanceInvitations = await tx
      .update(workspaceGovernanceResources)
      .set({
        version: sql`${workspaceGovernanceResources.version} + 1`,
        status: "revoked",
        body: sql`jsonb_set(jsonb_set(${workspaceGovernanceResources.body}, '{email}', to_jsonb(${tombstoneEmail}::text), true), '{revokedAt}', to_jsonb(${completedAt.toISOString()}::text), true)`,
        updatedAt: completedAt,
      })
      .where(
        and(
          inArray(workspaceGovernanceResources.kind, [
            "invitation_binding",
            "review_guest_grant",
          ]),
          sql`lower(${workspaceGovernanceResources.body}->>'email') = lower(${identity.email})`,
        ),
      )
      .returning({ id: workspaceGovernanceResources.id });

    const revokedGovernanceAssignments = await tx
      .update(workspaceGovernanceResources)
      .set({
        version: sql`${workspaceGovernanceResources.version} + 1`,
        status: "revoked",
        body: sql`jsonb_set(jsonb_set(${workspaceGovernanceResources.body}, '{revokedAt}', to_jsonb(${completedAt.toISOString()}::text), true), '{revocationReason}', to_jsonb('identity_erasure'::text), true)`,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(workspaceGovernanceResources.kind, "member_role_assignment"),
          eq(workspaceGovernanceResources.id, input.userId),
          eq(workspaceGovernanceResources.status, "active"),
        ),
      )
      .returning({ id: workspaceGovernanceResources.id });

    const notificationRecipients = await tx
      .delete(workspaceNotificationRecipients)
      .where(eq(workspaceNotificationRecipients.userId, input.userId))
      .returning({ eventId: workspaceNotificationRecipients.eventId });
    const notificationPreferences = await tx
      .delete(workspaceNotificationPreferences)
      .where(eq(workspaceNotificationPreferences.userId, input.userId))
      .returning({ workspaceId: workspaceNotificationPreferences.workspaceId });
    const localePreferences = await tx
      .delete(workspaceInterfaceLocalePreferences)
      .where(eq(workspaceInterfaceLocalePreferences.userId, input.userId))
      .returning({ workspaceId: workspaceInterfaceLocalePreferences.workspaceId });
    const socialReads = await tx
      .delete(socialEventReads)
      .where(eq(socialEventReads.userId, input.userId))
      .returning({ eventId: socialEventReads.eventId });
    const socialPreferences = await tx
      .delete(socialNotificationPreferences)
      .where(eq(socialNotificationPreferences.userId, input.userId))
      .returning({ workspaceId: socialNotificationPreferences.workspaceId });

    const legacyPreferences = await tx
      .delete(userPreferences)
      .where(eq(userPreferences.userId, input.userId))
      .returning({ userId: userPreferences.userId });
    const onboardingReceipts = await tx
      .delete(onboardingCommandReceipts)
      .where(eq(onboardingCommandReceipts.userId, input.userId))
      .returning({ idempotencyKey: onboardingCommandReceipts.idempotencyKey });
    const onboardingState = await tx
      .delete(onboardingSessions)
      .where(eq(onboardingSessions.userId, input.userId))
      .returning({ id: onboardingSessions.id });
    const invitations = await tx
      .delete(invitation)
      .where(sql`lower(${invitation.email}) = lower(${identity.email})`)
      .returning({ id: invitation.id });
    await tx
      .delete(verification)
      .where(sql`lower(${verification.identifier}) = lower(${identity.email})`);

    const authMembers = await tx
      .delete(member)
      .where(eq(member.userId, input.userId))
      .returning({ id: member.id });
    const canonicalMembers = await tx
      .delete(workspaceMembers)
      .where(eq(workspaceMembers.userId, input.userId))
      .returning({ workspaceId: workspaceMembers.workspaceId });
    const accounts = await tx
      .delete(account)
      .where(eq(account.userId, input.userId))
      .returning({ id: account.id });
    const sessions = await tx
      .delete(session)
      .where(eq(session.userId, input.userId))
      .returning({ id: session.id });

    await tx
      .update(user)
      .set({
        name: "Erased identity",
        email: tombstoneEmail,
        emailVerified: false,
        image: null,
        updatedAt: completedAt,
      })
      .where(eq(user.id, input.userId));

    const counts: ErasureCounts = {
      accounts: accounts.length,
      sessions: sessions.length,
      memberships: authMembers.length + canonicalMembers.length,
      preferences: legacyPreferences.length + localePreferences.length,
      onboardingRecords: onboardingReceipts.length + onboardingState.length,
      notificationRecords:
        notificationRecipients.length +
        notificationPreferences.length +
        socialReads.length +
        socialPreferences.length,
      invitations: invitations.length,
      analyticsPseudonymized: analytics.length,
      attributionEventsScrubbed: attribution.events,
      attributionConsentsRevoked: attribution.consents,
      governanceInvitationsScrubbed: scrubbedGovernanceInvitations.length,
      governanceAssignmentsRevoked: revokedGovernanceAssignments.length,
      governanceProjectionsCancelled: cancelledProjections.length,
    };

    await tx.insert(identityErasureReceipts).values({
      userId: input.userId,
      receiptId: newReceiptId,
      requestDigest: requestDigest(input.userId, requestedAt),
      result: counts,
      requestedAt,
      completedAt,
    });

    return {
      schema: "identity-erasure-result/v1",
      receiptId: newReceiptId,
      completedAt: completedAt.toISOString(),
      counts,
    };
  });
}
