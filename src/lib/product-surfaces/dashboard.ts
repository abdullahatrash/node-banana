import "server-only";

import { and, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  assets,
  brandProfiles,
  generationJobs,
  runtimePublishingApprovalDecisions,
  runtimePublishingApprovalRequests,
  socialAccounts,
  socialPosts,
  workspaceProductRecords,
} from "@/lib/db/schema";
import type { ProductRecordKind } from "./definitions";
import {
  buildDashboardSourceEnvelopes,
  dashboardReviewHref,
  isDashboardReviewKind,
  projectDashboardContentPiece,
  type DashboardContentPiece,
  type DashboardReviewKind,
  type DashboardSourceEnvelope,
} from "./dashboard-projection";
import { chooseDashboardNextAction } from "./dashboard-policy";

export interface DashboardReadModel {
  activation: { brand: boolean; media: boolean; channel: boolean; content: boolean; scheduled: boolean };
  counts: { media: number; channels: number; reauth: number; content: number; queuedBlitz: number; scheduled: number; failedPublishing: number; failedGeneration: number };
  recentAssets: Array<{ id: string; type: "image" | "video" | "audio" | "model3d" | "workflow"; createdAt: Date }>;
  upcomingPosts: Array<{ id: string; content: string | null; scheduledAt: Date | null; status: string; updatedAt: Date }>;
  sourceEnvelopes: DashboardSourceEnvelope[];
  pendingApprovals: Array<{ id: string; planId: string; targetCount: number; createdAt: Date; expiresAt: Date }>;
  pendingReviews: Array<{ id: string; title: string; kind: DashboardReviewKind; state: string; updatedAt: Date; href: string }>;
  recentContentPieces: DashboardContentPiece[];
  nextAction: ReturnType<typeof chooseDashboardNextAction>;
  generatedAt: Date;
}

export async function getDashboardReadModel(workspaceId: string): Promise<DashboardReadModel> {
  const db = getDb();
  const now = new Date();
  const [brandRows, mediaCountRows, channelRows, contentRows, blitzRows, postStatusRows, failedGenerationRows, recentAssets, upcomingPosts, pendingApprovalRows, pendingReviewRows, recentContentRows] = await Promise.all([
    db.select({ createdAt: brandProfiles.createdAt }).from(brandProfiles).where(and(eq(brandProfiles.workspaceId, workspaceId), eq(brandProfiles.status, "active"))).limit(1),
    db.select({ value: count() }).from(assets).where(and(eq(assets.workspaceId, workspaceId), isNull(assets.deletedAt))),
    db.select({ requiresReauth: socialAccounts.requiresReauth, updatedAt: socialAccounts.updatedAt }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, workspaceId), eq(socialAccounts.disabled, false))),
    db.select({ value: count() }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.kind, "content_piece"), isNull(workspaceProductRecords.archivedAt))),
    db.select({ value: count() }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.kind, "blitz_item"), eq(workspaceProductRecords.state, "queued"), isNull(workspaceProductRecords.archivedAt))),
    db.select({ status: socialPosts.status, value: count() }).from(socialPosts).where(eq(socialPosts.workspaceId, workspaceId)).groupBy(socialPosts.status),
    db.select({ value: count() }).from(generationJobs).where(and(eq(generationJobs.workspaceId, workspaceId), eq(generationJobs.status, "failed"))),
    db.select({ id: assets.id, type: assets.type, createdAt: assets.createdAt }).from(assets).where(and(eq(assets.workspaceId, workspaceId), isNull(assets.deletedAt))).orderBy(desc(assets.createdAt)).limit(6),
    db.select({ id: socialPosts.id, content: socialPosts.content, scheduledAt: socialPosts.scheduledAt, status: socialPosts.status, updatedAt: socialPosts.updatedAt }).from(socialPosts).where(and(eq(socialPosts.workspaceId, workspaceId), sql`${socialPosts.status} in ('queued','publishing')`)).orderBy(socialPosts.scheduledAt).limit(6),
    db.select({ id: runtimePublishingApprovalRequests.id, planId: runtimePublishingApprovalRequests.planId, targetIds: runtimePublishingApprovalRequests.targetIds, createdAt: runtimePublishingApprovalRequests.createdAt, expiresAt: runtimePublishingApprovalRequests.decisionPolicyExpiresAt })
      .from(runtimePublishingApprovalRequests)
      .leftJoin(runtimePublishingApprovalDecisions, and(eq(runtimePublishingApprovalDecisions.workspaceId, runtimePublishingApprovalRequests.workspaceId), eq(runtimePublishingApprovalDecisions.requestId, runtimePublishingApprovalRequests.id)))
      .where(and(eq(runtimePublishingApprovalRequests.workspaceId, workspaceId), isNull(runtimePublishingApprovalDecisions.id), gt(runtimePublishingApprovalRequests.decisionPolicyExpiresAt, now)))
      .orderBy(desc(runtimePublishingApprovalRequests.createdAt)).limit(6),
    db.select({ id: workspaceProductRecords.id, title: workspaceProductRecords.title, kind: workspaceProductRecords.kind, state: workspaceProductRecords.state, updatedAt: workspaceProductRecords.updatedAt })
      .from(workspaceProductRecords)
      .where(and(eq(workspaceProductRecords.workspaceId, workspaceId), isNull(workspaceProductRecords.archivedAt), inArray(workspaceProductRecords.kind, ["blitz_item", "campaign_automation", "creator_persona", "channel_onboarding_order"]), inArray(workspaceProductRecords.state, ["queued", "editing", "validating", "consent_review", "review", "submitted", "in_review"])))
      .orderBy(desc(workspaceProductRecords.updatedAt)).limit(6),
    db.select({ id: workspaceProductRecords.id, title: workspaceProductRecords.title, revision: workspaceProductRecords.revision, payload: workspaceProductRecords.payload, updatedAt: workspaceProductRecords.updatedAt })
      .from(workspaceProductRecords)
      .where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.kind, "content_piece"), isNull(workspaceProductRecords.archivedAt)))
      .orderBy(desc(workspaceProductRecords.updatedAt)).limit(6),
  ]);
  const byStatus = Object.fromEntries(postStatusRows.map((row) => [row.status, row.value]));
  const counts = { media: mediaCountRows[0]?.value ?? 0, channels: channelRows.length, reauth: channelRows.filter((row) => row.requiresReauth).length, content: contentRows[0]?.value ?? 0, queuedBlitz: blitzRows[0]?.value ?? 0, scheduled: (byStatus.queued ?? 0) + (byStatus.publishing ?? 0), failedPublishing: byStatus.failed ?? 0, failedGeneration: failedGenerationRows[0]?.value ?? 0 };
  const hasActiveBrand = brandRows.length > 0;
  const recentContentPieces = recentContentRows.map(projectDashboardContentPiece).filter((item): item is DashboardContentPiece => item !== null);
  const pendingReviews = pendingReviewRows
    .filter((row): row is typeof row & { kind: DashboardReviewKind } => isDashboardReviewKind(row.kind as ProductRecordKind))
    .map((row) => ({ ...row, href: dashboardReviewHref(row.kind, row.id) }));
  const pendingApprovals = pendingApprovalRows.map((row) => ({ id: row.id, planId: row.planId, targetCount: row.targetIds.length, createdAt: row.createdAt, expiresAt: row.expiresAt }));
  const sourceEnvelopes = buildDashboardSourceEnvelopes({
    brand: { active: hasActiveBrand, updatedAt: brandRows[0]?.createdAt ?? null },
    media: { count: counts.media, updatedAt: recentAssets[0]?.createdAt ?? null },
    channels: { count: counts.channels, reauth: counts.reauth, updatedAt: channelRows.reduce<Date | null>((latest, row) => !latest || row.updatedAt > latest ? row.updatedAt : latest, null) },
    content: { count: counts.content, updatedAt: recentContentPieces[0]?.updatedAt ?? null },
    publishing: { scheduled: counts.scheduled, failures: counts.failedPublishing, updatedAt: upcomingPosts.reduce<Date | null>((latest, row) => !latest || row.updatedAt > latest ? row.updatedAt : latest, null) },
  });
  return { activation: { brand: hasActiveBrand, media: counts.media > 0, channel: counts.channels > 0, content: counts.content > 0, scheduled: counts.scheduled > 0 }, counts, recentAssets, upcomingPosts, sourceEnvelopes, pendingApprovals, pendingReviews, recentContentPieces, nextAction: chooseDashboardNextAction({ brand: hasActiveBrand, media: counts.media, channels: counts.channels, failedPublishing: counts.failedPublishing, content: counts.content, scheduled: counts.scheduled }), generatedAt: now };
}
