import "server-only";

import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, generationJobs, socialAccounts, socialPosts, workspaceProductRecords } from "@/lib/db/schema";
import { chooseDashboardNextAction } from "./dashboard-policy";

export interface DashboardReadModel {
  activation: { brand: boolean; media: boolean; channel: boolean; content: boolean; scheduled: boolean };
  counts: { media: number; channels: number; reauth: number; content: number; queuedBlitz: number; scheduled: number; failedPublishing: number; failedGeneration: number };
  recentAssets: Array<{ id: string; type: "image" | "video" | "copy"; createdAt: Date }>;
  upcomingPosts: Array<{ id: string; content: string | null; scheduledAt: Date | null; status: string }>;
  nextAction: ReturnType<typeof chooseDashboardNextAction>;
  generatedAt: Date;
}

export async function getDashboardReadModel(workspaceId: string, hasActiveBrand: boolean): Promise<DashboardReadModel> {
  const db = getDb();
  const [mediaCountRows, channelRows, contentRows, blitzRows, postStatusRows, failedGenerationRows, recentAssets, upcomingPosts] = await Promise.all([
    db.select({ value: count() }).from(assets).where(and(eq(assets.workspaceId, workspaceId), isNull(assets.deletedAt))),
    db.select({ requiresReauth: socialAccounts.requiresReauth }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, workspaceId), eq(socialAccounts.disabled, false))),
    db.select({ value: count() }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.kind, "content_piece"), isNull(workspaceProductRecords.archivedAt))),
    db.select({ value: count() }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.kind, "blitz_item"), eq(workspaceProductRecords.state, "queued"), isNull(workspaceProductRecords.archivedAt))),
    db.select({ status: socialPosts.status, value: count() }).from(socialPosts).where(eq(socialPosts.workspaceId, workspaceId)).groupBy(socialPosts.status),
    db.select({ value: count() }).from(generationJobs).where(and(eq(generationJobs.workspaceId, workspaceId), eq(generationJobs.status, "failed"))),
    db.select({ id: assets.id, type: assets.type, createdAt: assets.createdAt }).from(assets).where(and(eq(assets.workspaceId, workspaceId), isNull(assets.deletedAt))).orderBy(desc(assets.createdAt)).limit(6),
    db.select({ id: socialPosts.id, content: socialPosts.content, scheduledAt: socialPosts.scheduledAt, status: socialPosts.status }).from(socialPosts).where(and(eq(socialPosts.workspaceId, workspaceId), sql`${socialPosts.status} in ('queued','publishing')`)).orderBy(socialPosts.scheduledAt).limit(6),
  ]);
  const byStatus = Object.fromEntries(postStatusRows.map((row) => [row.status, row.value]));
  const counts = { media: mediaCountRows[0]?.value ?? 0, channels: channelRows.length, reauth: channelRows.filter((row) => row.requiresReauth).length, content: contentRows[0]?.value ?? 0, queuedBlitz: blitzRows[0]?.value ?? 0, scheduled: (byStatus.queued ?? 0) + (byStatus.publishing ?? 0), failedPublishing: byStatus.failed ?? 0, failedGeneration: failedGenerationRows[0]?.value ?? 0 };
  return { activation: { brand: hasActiveBrand, media: counts.media > 0, channel: counts.channels > 0, content: counts.content > 0, scheduled: counts.scheduled > 0 }, counts, recentAssets, upcomingPosts, nextAction: chooseDashboardNextAction({ brand: hasActiveBrand, media: counts.media, channels: counts.channels, failedPublishing: counts.failedPublishing, content: counts.content, scheduled: counts.scheduled }), generatedAt: new Date() };
}
