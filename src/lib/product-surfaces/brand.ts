import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { brandProfiles, onboardingCommandReceipts, onboardingSessions } from "@/lib/db/schema";
import { brandProfileCorrectionSchema, brandProfileV1Schema, type BrandProfileCorrection } from "@/lib/onboarding/schemas";

export class BrandRevisionConflictError extends Error {}

export async function createBrandRevision(input: { workspaceId: string; userId: string; expectedActiveRevision: number; correction: BrandProfileCorrection; idempotencyKey: string; now?: Date }) {
  const correction = brandProfileCorrectionSchema.parse(input.correction);
  const digest = canonicalDigest({ action: "create_revision", expectedActiveRevision: input.expectedActiveRevision, correction });
  const now = input.now ?? new Date();
  return getDb().transaction(async (tx) => {
    const [receipt] = await tx.select().from(onboardingCommandReceipts).where(and(eq(onboardingCommandReceipts.userId, input.userId), eq(onboardingCommandReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
    if (receipt) {
      if (receipt.requestFingerprint !== digest) throw new BrandRevisionConflictError("Idempotency key was already used.");
      return receipt.result as { profileId: string; revision: number };
    }
    const [[session], [active], [latest]] = await Promise.all([
      tx.select().from(onboardingSessions).where(and(eq(onboardingSessions.userId, input.userId), eq(onboardingSessions.workspaceId, input.workspaceId))).limit(1),
      tx.select().from(brandProfiles).where(and(eq(brandProfiles.workspaceId, input.workspaceId), eq(brandProfiles.status, "active"))).limit(1),
      tx.select({ revision: brandProfiles.revision }).from(brandProfiles).where(eq(brandProfiles.workspaceId, input.workspaceId)).orderBy(desc(brandProfiles.revision)).limit(1),
    ]);
    if (!session || !active) throw new Error("Active Brand Profile is unavailable.");
    if (active.revision !== input.expectedActiveRevision) throw new BrandRevisionConflictError("Brand Profile changed. Refresh before editing.");
    await tx.update(brandProfiles).set({ status: "superseded" }).where(and(eq(brandProfiles.workspaceId, input.workspaceId), eq(brandProfiles.status, "draft")));
    const current = brandProfileV1Schema.parse(active.profile);
    const revision = (latest?.revision ?? active.revision) + 1;
    const profileId = randomUUID();
    await tx.insert(brandProfiles).values({
      id: profileId, workspaceId: input.workspaceId, revision, status: "draft", schemaVersion: 1,
      profile: brandProfileV1Schema.parse({ ...current, identity: { ...current.identity, coreIdentity: correction.coreIdentity }, offering: correction.offering, benefits: correction.benefits, differentiators: correction.differentiators, mission: correction.mission, positioning: correction.positioning, ownedSpace: correction.ownedSpace, voice: correction.voice, prohibitedClaims: correction.prohibitedClaims, prohibitedTopics: correction.prohibitedTopics, contentAngles: correction.contentAngles, uncertainties: correction.uncertainties }),
      generatedFromRunId: null, sourceProfileId: active.id, acceptedByUserId: null, acceptedAt: null, createdAt: now,
    });
    const result = { profileId, revision };
    await tx.insert(onboardingCommandReceipts).values({ userId: input.userId, idempotencyKey: input.idempotencyKey, commandType: "brand_profile.create_revision", requestFingerprint: digest, sessionRevision: Math.max(session.revision, 1), result, createdAt: now });
    return result;
  });
}

export async function activateBrandRevision(input: { workspaceId: string; userId: string; profileId: string; expectedRevision: number; idempotencyKey: string; now?: Date }) {
  const digest = canonicalDigest({ action: "activate_revision", profileId: input.profileId, expectedRevision: input.expectedRevision });
  const now = input.now ?? new Date();
  return getDb().transaction(async (tx) => {
    const [receipt] = await tx.select().from(onboardingCommandReceipts).where(and(eq(onboardingCommandReceipts.userId, input.userId), eq(onboardingCommandReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
    if (receipt) {
      if (receipt.requestFingerprint !== digest) throw new BrandRevisionConflictError("Idempotency key was already used.");
      return receipt.result as { profileId: string; revision: number };
    }
    const [[session], [draft]] = await Promise.all([
      tx.select().from(onboardingSessions).where(and(eq(onboardingSessions.userId, input.userId), eq(onboardingSessions.workspaceId, input.workspaceId))).limit(1),
      tx.select().from(brandProfiles).where(and(eq(brandProfiles.workspaceId, input.workspaceId), eq(brandProfiles.id, input.profileId), eq(brandProfiles.status, "draft"), eq(brandProfiles.revision, input.expectedRevision))).limit(1),
    ]);
    if (!session || !draft) throw new BrandRevisionConflictError("Draft Brand Profile is no longer current.");
    await tx.update(brandProfiles).set({ status: "superseded" }).where(and(eq(brandProfiles.workspaceId, input.workspaceId), eq(brandProfiles.status, "active")));
    const [activated] = await tx.update(brandProfiles).set({ status: "active", acceptedByUserId: input.userId, acceptedAt: now }).where(and(eq(brandProfiles.workspaceId, input.workspaceId), eq(brandProfiles.id, input.profileId), eq(brandProfiles.status, "draft"))).returning({ profileId: brandProfiles.id, revision: brandProfiles.revision });
    if (!activated) throw new BrandRevisionConflictError("Draft Brand Profile is no longer current.");
    await tx.insert(onboardingCommandReceipts).values({ userId: input.userId, idempotencyKey: input.idempotencyKey, commandType: "brand_profile.activate_revision", requestFingerprint: digest, sessionRevision: Math.max(session.revision, 1), result: activated, createdAt: now });
    return activated;
  });
}

