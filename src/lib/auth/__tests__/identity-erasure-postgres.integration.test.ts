import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  account,
  identityErasureReceipts,
  marketingAttributionConsents,
  marketingAttributionEvents,
  onboardingAnalyticsEvents,
  session,
  user,
  userPreferences,
  workspaceGovernanceResources,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import {
  eraseIdentity,
  getIdentityErasurePreflight,
} from "../identity-erasure";

const run = process.env.RUN_POSTGRES_INTEGRATION === "true" ? describe : describe.skip;

run("identity erasure Postgres integration", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const userId = `erasure_test_${suffix}`;
  const workspaceId = `erasure_ws_${suffix}`;
  const originalEmail = `${suffix}@identity-erasure.test`;
  const now = new Date();
  const conversionId = `mac_${createHash("sha256").update(suffix).digest("hex")}`;
  const attributionEventId = `mae_${suffix.slice(0, 32)}`;

  beforeAll(async () => {
    const database = getDb();
    await database.insert(user).values({
      id: userId,
      name: "Disposable Person",
      email: originalEmail,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(account).values({
      id: `account_${suffix}`,
      accountId: userId,
      providerId: "credential",
      userId,
      password: "not-a-real-password-hash",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(session).values({
      id: `session_${suffix}`,
      token: `token_${suffix}`,
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(workspaces).values({
      id: workspaceId,
      name: "Disposable Workspace",
      slug: `erasure-${suffix}`,
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(workspaceMembers).values({
      workspaceId,
      userId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(userPreferences).values({
      userId,
      interfaceLocale: "ar",
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(onboardingAnalyticsEvents).values({
      id: `analytics_${suffix}`,
      eventName: "signup_submitted",
      userId,
      workspaceId,
      sessionId: `session_${suffix}`,
      occurredAt: now,
    });
    await database.insert(marketingAttributionConsents).values({
      workspaceId,
      userId,
      provider: "x_ads",
      revision: 1,
      purpose: "advertising_attribution",
      status: "active",
      noticeVersion: "test-notice-v1",
      regionReviewVersion: "test-region-v1",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    await database.insert(marketingAttributionEvents).values({
      workspaceId,
      id: attributionEventId,
      userId,
      provider: "x_ads",
      eventName: "sign_up",
      conversionId,
      consentRevision: 1,
      payload: { hashed_email: "must-be-scrubbed" },
      state: "queued",
      attempt: 0,
      maxAttempts: 6,
      nextAttemptAt: now,
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    await database.insert(workspaceGovernanceResources).values([
      {
        workspaceId,
        kind: "invitation_binding",
        id: `invite_${suffix}`,
        version: 1,
        status: "pending",
        body: { email: originalEmail, tokenDigest: "test-digest", revokedAt: null },
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId,
        kind: "membership_projection",
        id: `projection_${suffix}`,
        version: 1,
        status: "queued",
        body: { operation: "upsert", userId, role: "member", attempts: 0, requestedAt: now.toISOString() },
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterAll(async () => {
    const database = getDb();
    await database.delete(marketingAttributionEvents).where(eq(marketingAttributionEvents.workspaceId, workspaceId));
    await database.delete(marketingAttributionConsents).where(eq(marketingAttributionConsents.workspaceId, workspaceId));
    await database.delete(onboardingAnalyticsEvents).where(eq(onboardingAnalyticsEvents.workspaceId, workspaceId));
    await database.delete(workspaceGovernanceResources).where(eq(workspaceGovernanceResources.workspaceId, workspaceId));
    await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await database.delete(identityErasureReceipts).where(eq(identityErasureReceipts.userId, userId));
    await database.delete(user).where(eq(user.id, userId));
  });

  it("blocks an active owner, then erases authentication while preserving the closed Workspace owner tombstone", async () => {
    await expect(getIdentityErasurePreflight(userId)).resolves.toMatchObject({
      canErase: false,
      hasCredential: true,
      membershipCount: 1,
      blockers: [{ workspaceId }],
    });
    await expect(eraseIdentity({ userId })).rejects.toMatchObject({
      code: "ACTIVE_OWNED_WORKSPACE",
      status: 409,
    });

    await getDb().insert(workspaceGovernanceResources).values({
      workspaceId,
      kind: "workspace_closure",
      id: `closure_${suffix}`,
      version: 1,
      status: "closed_retained",
      body: { completionEvidence: { fullyErased: false, holds: ["legal-retention"] } },
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });

    const result = await eraseIdentity({ userId, requestedAt: now });
    expect(result).toMatchObject({
      schema: "identity-erasure-result/v1",
      receiptId: expect.stringMatching(/^ier_[a-f0-9]{32}$/),
      counts: {
        accounts: 1,
        sessions: 1,
        memberships: 1,
        preferences: 1,
        analyticsPseudonymized: 1,
        attributionEventsScrubbed: 1,
        attributionConsentsRevoked: 1,
        governanceInvitationsScrubbed: 1,
        governanceAssignmentsRevoked: 1,
        governanceProjectionsCancelled: 1,
      },
    });

    const database = getDb();
    const [identity] = await database.select().from(user).where(eq(user.id, userId));
    expect(identity).toMatchObject({
      id: userId,
      name: "Erased identity",
      emailVerified: false,
      image: null,
    });
    expect(identity?.email).toMatch(/^erased\+[a-f0-9]{32}@deleted\.invalid$/);
    expect(identity?.email).not.toBe(originalEmail);
    await expect(database.select().from(account).where(eq(account.userId, userId))).resolves.toHaveLength(0);
    await expect(database.select().from(session).where(eq(session.userId, userId))).resolves.toHaveLength(0);
    await expect(database.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId))).resolves.toHaveLength(0);
    await expect(database.select().from(identityErasureReceipts).where(eq(identityErasureReceipts.userId, userId))).resolves.toHaveLength(1);
    await expect(database.select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, workspaceId))).resolves.toEqual([{ ownerUserId: userId }]);
    await expect(database.select({ userId: onboardingAnalyticsEvents.userId, sessionId: onboardingAnalyticsEvents.sessionId }).from(onboardingAnalyticsEvents).where(eq(onboardingAnalyticsEvents.id, `analytics_${suffix}`))).resolves.toEqual([{ userId: null, sessionId: null }]);
    await expect(database.select({ state: marketingAttributionEvents.state, payload: marketingAttributionEvents.payload }).from(marketingAttributionEvents).where(and(eq(marketingAttributionEvents.workspaceId, workspaceId), eq(marketingAttributionEvents.id, attributionEventId)))).resolves.toEqual([{ state: "cancelled", payload: {} }]);
    const latestConsent = await database.select({ status: marketingAttributionConsents.status, revision: marketingAttributionConsents.revision }).from(marketingAttributionConsents).where(and(eq(marketingAttributionConsents.workspaceId, workspaceId), eq(marketingAttributionConsents.userId, userId))).orderBy(desc(marketingAttributionConsents.revision)).limit(1);
    expect(latestConsent).toEqual([{ status: "revoked", revision: 2 }]);
    const governanceRows = await database.select({ kind: workspaceGovernanceResources.kind, status: workspaceGovernanceResources.status, body: workspaceGovernanceResources.body }).from(workspaceGovernanceResources).where(eq(workspaceGovernanceResources.workspaceId, workspaceId));
    expect(governanceRows.find((row) => row.kind === "membership_projection")).toMatchObject({ status: "dead_letter", body: { lastErrorCode: "IDENTITY_ERASED", lease: null } });
    expect(governanceRows.find((row) => row.kind === "member_role_assignment")).toMatchObject({ status: "revoked", body: { revocationReason: "identity_erasure", revokedAt: expect.any(String) } });
    expect(governanceRows.find((row) => row.kind === "invitation_binding")).toMatchObject({ status: "revoked", body: { revokedAt: expect.any(String) } });
    expect((governanceRows.find((row) => row.kind === "invitation_binding")?.body as { email?: string }).email).toMatch(/^erased\+/);

    await expect(database.insert(account).values({
      id: `restored_account_${suffix}`,
      accountId: userId,
      providerId: "credential",
      userId,
      password: "must-not-be-restored",
      createdAt: now,
      updatedAt: now,
    })).rejects.toMatchObject({
      cause: { message: expect.stringContaining("access state cannot be created for an erased identity") },
    });
    await expect(database.insert(session).values({
      id: `restored_session_${suffix}`,
      token: `restored_token_${suffix}`,
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    })).rejects.toMatchObject({
      cause: { message: expect.stringContaining("access state cannot be created for an erased identity") },
    });
    await expect(database.insert(workspaceMembers).values({
      workspaceId,
      userId,
      role: "member",
      createdAt: now,
      updatedAt: now,
    })).rejects.toMatchObject({
      cause: { message: expect.stringContaining("access state cannot be created for an erased identity") },
    });
    await expect(database.update(identityErasureReceipts)
      .set({ result: { tampered: 1 } })
      .where(eq(identityErasureReceipts.userId, userId)))
      .rejects.toMatchObject({
        cause: { message: expect.stringContaining("identity erasure receipts are immutable") },
      });
  });
});
