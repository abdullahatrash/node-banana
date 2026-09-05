import "server-only";

import { and, desc, eq, gt } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { brandProfiles, youtubeTrendDiscoveryEntries, youtubeTrendDiscoverySources } from "@/lib/db/schema";
import type { ArabicVariety, ContentLanguage } from "@/lib/model-routing/types";
import { createProductRecordInTransaction } from "./repository";
import type { ContentFormat } from "./definitions";
import { compileBrandAwareMetadataBrief } from "./remix-brief";

export class YoutubeMetadataRemixError extends Error {
  constructor(readonly code: string) { super(code); }
}

function safeCounter(value: string | null) {
  if (value === null) return null;
  try { return Number(BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : BigInt(value)); }
  catch { return null; }
}

/**
 * Queues an original topic adaptation while keeping all YouTube media outside
 * Workspace storage and provider input. The immutable evidence binds only the
 * public chart metadata the user selected.
 */
export async function queueYoutubeMetadataRemix(input: {
  workspaceId: string;
  userId: string;
  sourceId: string;
  videoId: string;
  contentLanguage: Exclude<ContentLanguage, "mixed">;
  arabicVariety: ArabicVariety | null;
  format: ContentFormat;
  idempotencyKey: string;
  at?: Date;
}) {
  const at = input.at ?? new Date();
  if (input.contentLanguage === "ar" && !input.arabicVariety) throw new YoutubeMetadataRemixError("YOUTUBE_REMIX_ARABIC_VARIETY_REQUIRED");
  if (input.contentLanguage === "en" && input.arabicVariety) throw new YoutubeMetadataRemixError("YOUTUBE_REMIX_LANGUAGE_INVALID");

  return getDb().transaction(async (tx) => {
    const [[row], [brand]] = await Promise.all([
      tx.select({ entry: youtubeTrendDiscoveryEntries, source: youtubeTrendDiscoverySources })
        .from(youtubeTrendDiscoveryEntries)
        .innerJoin(youtubeTrendDiscoverySources, and(eq(youtubeTrendDiscoverySources.workspaceId, youtubeTrendDiscoveryEntries.workspaceId), eq(youtubeTrendDiscoverySources.id, youtubeTrendDiscoveryEntries.sourceId)))
        .where(and(eq(youtubeTrendDiscoveryEntries.workspaceId, input.workspaceId), eq(youtubeTrendDiscoveryEntries.sourceId, input.sourceId), eq(youtubeTrendDiscoveryEntries.videoId, input.videoId), gt(youtubeTrendDiscoveryEntries.expiresAt, at)))
        .limit(1),
      tx.select().from(brandProfiles).where(and(eq(brandProfiles.workspaceId, input.workspaceId), eq(brandProfiles.status, "active"))).orderBy(desc(brandProfiles.revision)).limit(1),
    ]);
    if (!row) throw new YoutubeMetadataRemixError("YOUTUBE_TREND_NOT_FOUND");
    if (!brand?.acceptedAt) throw new YoutubeMetadataRemixError("INSPIRATION_ACTIVE_BRAND_REQUIRED");

    const metrics = {
      views: safeCounter(row.entry.viewCount),
      likes: safeCounter(row.entry.likeCount),
      comments: safeCounter(row.entry.commentCount),
    };
    if (Object.values(metrics).every((value) => value === null)) throw new YoutubeMetadataRemixError("YOUTUBE_TREND_METRICS_UNAVAILABLE");
    const evidenceFacts = {
      provider: "youtube-data-api",
      chart: { sourceId: row.source.id, regionCode: row.source.regionCode, categoryId: row.source.categoryId, providerRank: row.entry.providerRank },
      item: { videoId: row.entry.videoId, title: row.entry.title, channelId: row.entry.channelId, channelTitle: row.entry.channelTitle, sourceUrl: row.entry.sourceUrl, publishedAt: row.entry.publishedAt.toISOString() },
      metrics,
      observedAt: row.entry.observedAt.toISOString(),
    };
    const evidenceDigest = canonicalDigest(evidenceFacts) as `sha256:${string}`;
    const inspirationPayload = {
      sourceUrl: row.entry.sourceUrl,
      sourceAssetId: null,
      sourceMediaType: null,
      sourceName: `YouTube · ${row.entry.channelTitle}`.slice(0, 200),
      capturedAt: row.entry.observedAt.toISOString(),
      metricsObservedAt: row.entry.observedAt.toISOString(),
      metrics,
      region: row.source.regionCode,
      contentLanguage: input.contentLanguage,
      arabicVariety: input.contentLanguage === "ar" ? input.arabicVariety : null,
      format: input.format,
      rightsStatus: "metadata_only" as const,
      rightsSnapshot: null,
      permittedInfluence: ["topic" as const],
      creativePrimitives: { topics: [row.entry.title.slice(0, 120)], hookPattern: null, pacing: null, structure: [] },
      whyThisAppears: ["youtube_most_popular", "metadata_only_rights"],
      tags: [row.source.regionCode, row.entry.channelTitle.slice(0, 80)],
      trendEvidence: null,
      catalogBinding: null,
    };
    const inspiration = await createProductRecordInTransaction(tx, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: "inspiration_item",
      title: row.entry.title,
      state: "active",
      payload: inspirationPayload,
      idempotencyKey: `${input.idempotencyKey}:inspiration`,
      now: at,
    });
    const remixBrief = compileBrandAwareMetadataBrief({
      inspirationItemId: inspiration.id,
      inspirationRevision: inspiration.revision,
      sourceValue: inspiration.payload,
      brand: { id: brand.id, revision: brand.revision, acceptedAt: brand.acceptedAt, profile: brand.profile },
      evidenceDigest,
      createdAt: row.entry.observedAt,
    });
    const blitz = await createProductRecordInTransaction(tx, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: "blitz_item",
      title: row.entry.title,
      state: "queued",
      idempotencyKey: `${input.idempotencyKey}:blitz`,
      now: at,
      payload: {
        inspirationItemId: inspiration.id,
        contentPieceId: null,
        sourceAttribution: row.entry.sourceUrl,
        sourceUsage: "metadata_topic_only",
        sourceAssetId: null,
        sourceMediaType: null,
        rightsSnapshot: null,
        rightsBasis: null,
        permittedRemix: null,
        rightsEvidenceIds: [],
        contentLanguage: input.contentLanguage,
        arabicVariety: input.contentLanguage === "ar" ? input.arabicVariety : null,
        format: input.format,
        remixBrief,
        rationale: remixBrief.brandDirection.angle.slice(0, 1_000),
        sourceComparison: metrics.views !== null && metrics.likes !== null ? { views: metrics.views, likes: metrics.likes, observedAt: row.entry.observedAt.toISOString(), selectionDigest: evidenceDigest } : null,
        rejectionReasons: [],
      },
    });
    return { inspirationItemId: inspiration.id, blitzItemId: blitz.id, evidenceDigest };
  });
}
