import "server-only";

import { and, desc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { inspirationTrendFeedEntries, workspaceProductRecords } from "@/lib/db/schema";
import { ARABIC_VARIETIES, CONTENT_FORMATS, inspirationPayloadSchema } from "./definitions";
import { TREND_RIGHTS_STATUSES } from "./trend-types";

export const trendFeedFiltersSchema = z.object({
  query: z.string().trim().max(120).default(""),
  region: z.string().trim().max(80).default(""),
  language: z.enum(["ar", "en"]).optional(),
  arabicVariety: z.enum(ARABIC_VARIETIES).optional(),
  format: z.enum(CONTENT_FORMATS).optional(),
  rightsStatus: z.enum(TREND_RIGHTS_STATUSES).exclude(["restricted"]).optional(),
  blitzReady: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(60),
}).strict();

export type TrendFeedFilters = z.input<typeof trendFeedFiltersSchema>;

export function trendFreshness(metricsObservedAt: Date, at: Date) {
  const hours = Math.max(0, (at.getTime() - metricsObservedAt.getTime()) / 3_600_000);
  return hours <= 24 ? "live" as const : hours <= 168 ? "recent" as const : "aging" as const;
}

function searchPattern(value: string) {
  return `%${value.normalize("NFKC").toLocaleLowerCase("und").replace(/[\\%_]/g, "\\$&")}%`;
}

export async function listInspirationTrendFeed(input: { workspaceId: string; filters?: TrendFeedFilters; at?: Date }) {
  const filters = trendFeedFiltersSchema.parse(input.filters ?? {});
  const at = input.at ?? new Date();
  const where = [
    eq(inspirationTrendFeedEntries.workspaceId, input.workspaceId),
    eq(workspaceProductRecords.kind, "inspiration_item"),
    isNull(workspaceProductRecords.archivedAt),
    or(eq(workspaceProductRecords.state, "active"), eq(workspaceProductRecords.state, "saved"))!,
    ne(inspirationTrendFeedEntries.rightsStatus, "restricted"),
    or(isNull(inspirationTrendFeedEntries.rightsExpiresAt), gt(inspirationTrendFeedEntries.rightsExpiresAt, at))!,
  ];
  if (filters.query) where.push(sql`${inspirationTrendFeedEntries.searchableText} ilike ${searchPattern(filters.query)} escape '\\'`);
  if (filters.region) where.push(eq(inspirationTrendFeedEntries.region, filters.region));
  if (filters.language) where.push(eq(inspirationTrendFeedEntries.contentLanguage, filters.language));
  if (filters.arabicVariety) where.push(eq(inspirationTrendFeedEntries.arabicVariety, filters.arabicVariety));
  if (filters.format) where.push(eq(inspirationTrendFeedEntries.format, filters.format));
  if (filters.rightsStatus) where.push(eq(inspirationTrendFeedEntries.rightsStatus, filters.rightsStatus));
  if (filters.blitzReady !== undefined) where.push(eq(inspirationTrendFeedEntries.eligibleForBlitz, filters.blitzReady));

  const rows = await getDb().select({ record: workspaceProductRecords, feed: inspirationTrendFeedEntries })
    .from(inspirationTrendFeedEntries)
    .innerJoin(workspaceProductRecords, and(
      eq(workspaceProductRecords.workspaceId, inspirationTrendFeedEntries.workspaceId),
      eq(workspaceProductRecords.id, inspirationTrendFeedEntries.inspirationItemId),
    ))
    .where(and(...where))
    .orderBy(desc(inspirationTrendFeedEntries.score), desc(inspirationTrendFeedEntries.metricsObservedAt), desc(inspirationTrendFeedEntries.inspirationItemId))
    .limit(filters.limit);

  return rows.map(({ record, feed }) => ({
    id: record.id,
    title: record.title,
    revision: record.revision,
    state: record.state,
    payload: inspirationPayloadSchema.parse(record.payload),
    score: feed.score,
    freshness: trendFreshness(feed.metricsObservedAt, at),
    metricsObservedAt: feed.metricsObservedAt.toISOString(),
    sourcePublishedAt: feed.sourcePublishedAt.toISOString(),
    eligibleForBlitz: feed.eligibleForBlitz,
  }));
}
