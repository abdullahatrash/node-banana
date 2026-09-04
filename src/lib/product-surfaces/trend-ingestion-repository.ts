import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  assets, brandProfiles, inspirationTrendFeedEntries, inspirationTrendIngestionJobs, inspirationTrendIngestionReceipts,
  inspirationTrendSources, workspaceProductRecords,
} from "@/lib/db/schema";
import { inspirationRightsSnapshots } from "@/lib/model-routing/db-schema";
import { hydrateRightsSnapshot, validateRightsEvidence } from "@/lib/model-routing/rights-evidence";
import type { InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { brandProfileV1Schema } from "@/lib/onboarding/schemas";
import { ARABIC_VARIETIES, CONTENT_FORMATS, inspirationPayloadSchema, type ContentFormat } from "./definitions";
import { createProductRecordInTransaction, updateProductRecordInTransaction } from "./repository";
import { TrendAdapterRegistry, TrendIngestionWorker, type ClaimedTrendIngestionJob, type RankedTrendCandidate, type TrendIngestionRepository } from "./trend-ingestion-worker";
import { TREND_SOURCE_KINDS, trendRankingContextSchema, type TrendIngestionAdapter, type TrendRankingContext, type TrendSourceKind } from "./trend-types";
import { ensureWorkspaceOwnedTrendSource, workspaceOwnedTrendAdapter } from "./workspace-owned-trend-adapter";

type Executor = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
const MAX_PAGE_COUNT = 20;

function strings(value: unknown, maximum: number, itemMaximum = 80) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0 && item.trim().length <= itemMaximum).map((item) => item.trim()))].slice(0, maximum) : [];
}

function rankingContext(source: typeof inspirationTrendSources.$inferSelect, brand: typeof brandProfiles.$inferSelect | undefined): TrendRankingContext {
  const profile = brand ? brandProfileV1Schema.parse(brand.profile) : null;
  const keywords = profile ? [
    profile.identity.companyName, profile.identity.coreIdentity, ...profile.offering, ...profile.problems, ...profile.benefits,
    ...profile.differentiators, profile.mission, profile.positioning, profile.ownedSpace, ...profile.voice.descriptors,
    ...profile.contentAngles, ...profile.audiences.flatMap((audience) => [audience.name, audience.description]),
  ] : [];
  const language = profile?.contentLanguage.toLowerCase().startsWith("ar") ? "ar" as const : "en" as const;
  return {
    brandProfile: brand && profile ? { id: brand.id, revision: brand.revision, digest: canonicalDigest(profile) as `sha256:${string}`, contentLanguage: language, keywords: strings(keywords, 200, 500) } : null,
    preferredRegions: strings(source.preferredRegions, 20),
    preferredArabicVarieties: strings(source.preferredArabicVarieties, 5).filter((item): item is (typeof ARABIC_VARIETIES)[number] => ARABIC_VARIETIES.includes(item as (typeof ARABIC_VARIETIES)[number])),
    preferredFormats: strings(source.preferredFormats, CONTENT_FORMATS.length).filter((item): item is ContentFormat => CONTENT_FORMATS.includes(item as ContentFormat)),
    preferredTags: strings(source.preferredTags, 50), excludedTags: strings(source.excludedTags, 50),
  };
}

function owned(job: ClaimedTrendIngestionJob) {
  return and(eq(inspirationTrendIngestionJobs.workspaceId, job.workspaceId), eq(inspirationTrendIngestionJobs.id, job.id), eq(inspirationTrendIngestionJobs.state, "claimed"), eq(inspirationTrendIngestionJobs.leaseOwner, job.leaseOwner), eq(inspirationTrendIngestionJobs.leaseEpoch, job.leaseEpoch));
}

function jobFromRow(row: typeof inspirationTrendIngestionJobs.$inferSelect, source: typeof inspirationTrendSources.$inferSelect): ClaimedTrendIngestionJob {
  if (!row.leaseOwner) throw new Error("TREND_INGESTION_LEASE_MISSING");
  return { workspaceId: row.workspaceId, id: row.id, sourceId: row.sourceId, sourceKind: source.sourceKind as TrendSourceKind, adapterKey: source.adapterKey, cursor: row.cursor, sourceKey: row.sourceKey, leaseOwner: row.leaseOwner, leaseEpoch: row.leaseEpoch, attempt: row.attempt, maxAttempts: row.maxAttempts, rankingEvaluatedAt: row.requestedAt, rankingContext: trendRankingContextSchema.parse(row.rankingContext) };
}

async function currentRankingContext(executor: Executor, source: typeof inspirationTrendSources.$inferSelect) {
  const [brand] = await executor.select().from(brandProfiles).where(and(eq(brandProfiles.workspaceId, source.workspaceId), eq(brandProfiles.status, "active"))).orderBy(desc(brandProfiles.revision)).limit(1);
  return rankingContext(source, brand);
}

async function assertRightsReference(executor: Executor, workspaceId: string, item: RankedTrendCandidate, at: Date) {
  const ref = item.candidate.rights;
  if (!ref.sourceAssetId || !ref.sourceMediaType || !ref.rightsSnapshot) {
    if (item.ranking.eligibleForBlitz) throw new Error("TREND_RIGHTS_REFERENCE_INVALID");
    return;
  }
  const [[asset], [stored]] = await Promise.all([
    executor.select({ id: assets.id, type: assets.type, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, workspaceId), eq(assets.id, ref.sourceAssetId), isNull(assets.deletedAt))).limit(1),
    executor.select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, workspaceId), eq(inspirationRightsSnapshots.id, ref.rightsSnapshot.id), eq(inspirationRightsSnapshots.revision, ref.rightsSnapshot.revision), eq(inspirationRightsSnapshots.digest, ref.rightsSnapshot.digest))).limit(1),
  ]);
  const rights = stored ? hydrateRightsSnapshot(stored.snapshot as InspirationRightsSnapshot) : null;
  const basisMatches = rights && ({ licensed: rights.basis === "licensed", user_submitted: rights.basis === "owned" || rights.basis === "consented", embeddable: rights.basis === "public_domain", metadata_only: false, restricted: false })[ref.status];
  const assetReady = asset && (asset.type === "image" || asset.type === "video") && asset.checksum && asset.metadata?.uploadState === "ready";
  const evidenceValid = rights && validateRightsEvidence({ workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: rights.sourceAssetIds, evidence: rights.evidence, at }).ok;
  if (!assetReady || asset.type !== ref.sourceMediaType || !rights || !basisMatches || !evidenceValid || rights.sourceAssetIds.length !== 1 || rights.sourceAssetIds[0] !== ref.sourceAssetId || (rights.permittedRemix === "reference_only" && ref.permittedInfluence.some((influence) => influence !== "topic"))) throw new Error("TREND_RIGHTS_REFERENCE_INVALID");
}

function payload(source: typeof inspirationTrendSources.$inferSelect, item: RankedTrendCandidate, capturedAt: Date) {
  const observationDigest = canonicalDigest(item.candidate);
  return inspirationPayloadSchema.parse({
    sourceUrl: item.candidate.sourceUrl, sourceAssetId: item.candidate.rights.sourceAssetId, sourceMediaType: item.candidate.rights.sourceMediaType, sourceName: item.candidate.sourceName,
    capturedAt: capturedAt.toISOString(), metricsObservedAt: item.candidate.metricsObservedAt, metrics: item.candidate.metrics, region: item.candidate.region,
    contentLanguage: item.candidate.contentLanguage, arabicVariety: item.candidate.arabicVariety, format: item.candidate.format, rightsStatus: item.candidate.rights.status,
    rightsSnapshot: item.candidate.rights.rightsSnapshot, permittedInfluence: item.candidate.rights.permittedInfluence, whyThisAppears: item.ranking.reasonCodes, tags: item.candidate.tags,
    creativePrimitives: item.candidate.creativePrimitives,
    trendEvidence: {
      schema: "inspiration-trend-evidence/v1",
      source: { sourceId: source.id, sourceKind: source.sourceKind, adapterKey: source.adapterKey, externalItemId: item.candidate.externalItemId, sourceContentDigest: item.candidate.sourceContentDigest, capturedAt: capturedAt.toISOString(), publishedAt: item.candidate.sourcePublishedAt, observationDigest, observationProvenance: item.candidate.observationProvenance },
      rights: { status: item.candidate.rights.status, evidenceRef: item.candidate.rights.evidenceRef, evidenceDigest: item.candidate.rights.evidenceDigest, observedAt: item.candidate.rights.observedAt, expiresAt: item.candidate.rights.expiresAt },
      ranking: item.ranking,
    },
  });
}

export class PostgresTrendIngestionRepository implements TrendIngestionRepository {
  async scheduleDue(input: { at: Date; limit: number }) {
    return getDb().transaction(async (tx) => {
      const sources = await tx.select().from(inspirationTrendSources).where(and(eq(inspirationTrendSources.state, "active"), lte(inspirationTrendSources.nextRunAt, input.at))).orderBy(asc(inspirationTrendSources.nextRunAt), asc(inspirationTrendSources.workspaceId), asc(inspirationTrendSources.id)).limit(input.limit).for("update", { skipLocked: true });
      let scheduled = 0;
      for (const source of sources) {
        const sourceKey = `scheduled:${source.nextRunAt.toISOString()}`;
        const context = await currentRankingContext(tx, source);
        const inserted = await tx.insert(inspirationTrendIngestionJobs).values({ workspaceId: source.workspaceId, id: randomUUID(), sourceId: source.id, sourceKey, requestedByUserId: source.createdByUserId, state: "queued", cursor: source.cursor, rankingContext: context, nextAttemptAt: input.at, requestedAt: input.at, updatedAt: input.at }).onConflictDoNothing().returning({ id: inspirationTrendIngestionJobs.id });
        if (!inserted.length) continue;
        scheduled += 1;
        await tx.update(inspirationTrendSources).set({ nextRunAt: new Date(Math.max(input.at.getTime(), source.nextRunAt.getTime()) + source.scheduleMinutes * 60_000), updatedAt: input.at }).where(and(eq(inspirationTrendSources.workspaceId, source.workspaceId), eq(inspirationTrendSources.id, source.id)));
      }
      return scheduled;
    });
  }

  async claim(input: { workerId: string; at: Date; leaseUntil: Date }) {
    return getDb().transaction(async (tx) => {
      await tx.update(inspirationTrendIngestionJobs).set({ state: "failed_known", leaseOwner: null, leaseExpiresAt: null, failureCode: "TREND_INGESTION_ATTEMPTS_EXHAUSTED", finishedAt: input.at, updatedAt: input.at }).where(and(eq(inspirationTrendIngestionJobs.state, "claimed"), lte(inspirationTrendIngestionJobs.leaseExpiresAt, input.at), sql`${inspirationTrendIngestionJobs.attempt} >= ${inspirationTrendIngestionJobs.maxAttempts}`));
      const [due] = await tx.select({ job: inspirationTrendIngestionJobs, source: inspirationTrendSources }).from(inspirationTrendIngestionJobs).innerJoin(inspirationTrendSources, and(eq(inspirationTrendSources.workspaceId, inspirationTrendIngestionJobs.workspaceId), eq(inspirationTrendSources.id, inspirationTrendIngestionJobs.sourceId), eq(inspirationTrendSources.state, "active"))).where(or(
        and(eq(inspirationTrendIngestionJobs.state, "queued"), lte(inspirationTrendIngestionJobs.nextAttemptAt, input.at), sql`${inspirationTrendIngestionJobs.attempt} < ${inspirationTrendIngestionJobs.maxAttempts}`),
        and(eq(inspirationTrendIngestionJobs.state, "claimed"), lte(inspirationTrendIngestionJobs.leaseExpiresAt, input.at), sql`${inspirationTrendIngestionJobs.attempt} < ${inspirationTrendIngestionJobs.maxAttempts}`),
      )).orderBy(asc(inspirationTrendIngestionJobs.nextAttemptAt), asc(inspirationTrendIngestionJobs.id)).limit(1).for("update", { skipLocked: true });
      if (!due) return null;
      const [claimed] = await tx.update(inspirationTrendIngestionJobs).set({ state: "claimed", leaseOwner: input.workerId, leaseExpiresAt: input.leaseUntil, leaseEpoch: sql`${inspirationTrendIngestionJobs.leaseEpoch} + 1`, attempt: sql`${inspirationTrendIngestionJobs.attempt} + 1`, startedAt: due.job.startedAt ?? input.at, failureCode: null, updatedAt: input.at }).where(and(eq(inspirationTrendIngestionJobs.workspaceId, due.job.workspaceId), eq(inspirationTrendIngestionJobs.id, due.job.id), eq(inspirationTrendIngestionJobs.leaseEpoch, due.job.leaseEpoch))).returning();
      if (!claimed) return null;
      return jobFromRow(claimed, due.source);
    });
  }

  async persistPage(input: { job: ClaimedTrendIngestionJob; items: RankedTrendCandidate[]; at: Date; leaseUntil: Date }) {
    return getDb().transaction(async (tx) => {
      const [[lease], [source]] = await Promise.all([
        tx.select().from(inspirationTrendIngestionJobs).where(owned(input.job)).limit(1).for("update"),
        tx.select().from(inspirationTrendSources).where(and(eq(inspirationTrendSources.workspaceId, input.job.workspaceId), eq(inspirationTrendSources.id, input.job.sourceId), eq(inspirationTrendSources.state, "active"))).limit(1),
      ]);
      if (!lease || !source || lease.pageCount >= MAX_PAGE_COUNT) throw new Error("TREND_INGESTION_LEASE_LOST");
      let inserted = 0; let updated = 0; let replayed = 0; let restricted = 0;
      for (const item of input.items) {
        await assertRightsReference(tx, input.job.workspaceId, item, input.at);
        const observationDigest = canonicalDigest(item.candidate);
        const [receipt] = await tx.select({ itemId: inspirationTrendIngestionReceipts.inspirationItemId }).from(inspirationTrendIngestionReceipts).where(and(
          eq(inspirationTrendIngestionReceipts.workspaceId, input.job.workspaceId), eq(inspirationTrendIngestionReceipts.sourceId, input.job.sourceId), eq(inspirationTrendIngestionReceipts.externalItemId, item.candidate.externalItemId),
          eq(inspirationTrendIngestionReceipts.observationDigest, observationDigest), eq(inspirationTrendIngestionReceipts.rankingDigest, item.ranking.digest),
        )).limit(1);
        if (receipt) { replayed += 1; continue; }
        const [currentFeed] = await tx.select().from(inspirationTrendFeedEntries).where(and(eq(inspirationTrendFeedEntries.workspaceId, input.job.workspaceId), eq(inspirationTrendFeedEntries.sourceId, input.job.sourceId), eq(inspirationTrendFeedEntries.externalItemId, item.candidate.externalItemId))).limit(1).for("update");
        const current = currentFeed ? (await tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.job.workspaceId), eq(workspaceProductRecords.id, currentFeed.inspirationItemId), eq(workspaceProductRecords.kind, "inspiration_item"))).limit(1))[0] : null;
        const nextPayload = payload(source, item, input.at);
        const desiredState = item.ranking.eligibleForDiscovery ? current?.state === "saved" || current?.state === "dismissed" ? current.state : "active" : "restricted";
        const key = `trend:${canonicalDigest({ sourceId: source.id, externalItemId: item.candidate.externalItemId, observationDigest, rankingDigest: item.ranking.digest }).slice(7)}`;
        const record = current
          ? await updateProductRecordInTransaction(tx, { workspaceId: input.job.workspaceId, userId: lease.requestedByUserId, id: current.id, expectedKind: "inspiration_item", expectedRevision: current.revision, title: item.candidate.title, state: desiredState, payload: nextPayload, idempotencyKey: key, now: input.at })
          : await createProductRecordInTransaction(tx, { workspaceId: input.job.workspaceId, userId: lease.requestedByUserId, kind: "inspiration_item", title: item.candidate.title, state: desiredState, payload: nextPayload, idempotencyKey: key, now: input.at });
        if (!record) throw new Error("TREND_INSPIRATION_RECORD_UNAVAILABLE");
        const feedValues = { workspaceId: input.job.workspaceId, inspirationItemId: record.id, sourceId: source.id, externalItemId: item.candidate.externalItemId, score: item.ranking.score, rankingDigest: item.ranking.digest, metricsObservedAt: new Date(item.candidate.metricsObservedAt), sourcePublishedAt: new Date(item.candidate.sourcePublishedAt), rightsExpiresAt: item.candidate.rights.expiresAt ? new Date(item.candidate.rights.expiresAt) : null, region: item.candidate.region, contentLanguage: item.candidate.contentLanguage, arabicVariety: item.candidate.arabicVariety, format: item.candidate.format, rightsStatus: item.candidate.rights.status, eligibleForBlitz: item.ranking.eligibleForBlitz, searchableText: [item.candidate.title, item.candidate.sourceName, item.candidate.region, ...item.candidate.tags].join(" ").normalize("NFKC").toLocaleLowerCase("und"), updatedAt: input.at };
        if (currentFeed) await tx.update(inspirationTrendFeedEntries).set(feedValues).where(and(eq(inspirationTrendFeedEntries.workspaceId, currentFeed.workspaceId), eq(inspirationTrendFeedEntries.inspirationItemId, currentFeed.inspirationItemId)));
        else await tx.insert(inspirationTrendFeedEntries).values(feedValues);
        await tx.insert(inspirationTrendIngestionReceipts).values({ workspaceId: input.job.workspaceId, sourceId: source.id, externalItemId: item.candidate.externalItemId, observationDigest, inspirationItemId: record.id, inspirationItemRevision: record.revision, sourceContentDigest: item.candidate.sourceContentDigest, rightsEvidenceDigest: item.candidate.rights.evidenceDigest, rankingDigest: item.ranking.digest, createdAt: input.at });
        if (current) updated += 1; else inserted += 1;
        if (!item.ranking.eligibleForDiscovery) restricted += 1;
      }
      const [renewed] = await tx.update(inspirationTrendIngestionJobs).set({ pageCount: sql`${inspirationTrendIngestionJobs.pageCount} + 1`, insertedCount: sql`${inspirationTrendIngestionJobs.insertedCount} + ${inserted}`, updatedCount: sql`${inspirationTrendIngestionJobs.updatedCount} + ${updated}`, replayedCount: sql`${inspirationTrendIngestionJobs.replayedCount} + ${replayed}`, restrictedCount: sql`${inspirationTrendIngestionJobs.restrictedCount} + ${restricted}`, leaseExpiresAt: input.leaseUntil, updatedAt: input.at }).where(owned(input.job)).returning({ id: inspirationTrendIngestionJobs.id });
      if (!renewed) throw new Error("TREND_INGESTION_LEASE_LOST");
      return { inserted, updated, replayed, restricted };
    });
  }

  async checkpoint(input: { job: ClaimedTrendIngestionJob; cursor: string; at: Date }) {
    const [row] = await getDb().update(inspirationTrendIngestionJobs).set({ state: "queued", cursor: input.cursor, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: input.at, updatedAt: input.at }).where(owned(input.job)).returning({ id: inspirationTrendIngestionJobs.id });
    return Boolean(row);
  }

  async complete(input: { job: ClaimedTrendIngestionJob; cursor: string | null; at: Date }) {
    return getDb().transaction(async (tx) => {
      const [row] = await tx.update(inspirationTrendIngestionJobs).set({ state: "succeeded", cursor: input.cursor, leaseOwner: null, leaseExpiresAt: null, failureCode: null, finishedAt: input.at, updatedAt: input.at }).where(owned(input.job)).returning({ id: inspirationTrendIngestionJobs.id });
      if (!row) return false;
      await tx.update(inspirationTrendSources).set({ cursor: input.cursor, updatedAt: input.at }).where(and(eq(inspirationTrendSources.workspaceId, input.job.workspaceId), eq(inspirationTrendSources.id, input.job.sourceId)));
      return true;
    });
  }

  async retry(input: { job: ClaimedTrendIngestionJob; errorCode: string; at: Date; nextAttemptAt: Date }) {
    const terminal = input.job.attempt >= input.job.maxAttempts;
    const [row] = await getDb().update(inspirationTrendIngestionJobs).set({ state: terminal ? "failed_known" : "queued", leaseOwner: null, leaseExpiresAt: null, failureCode: input.errorCode, nextAttemptAt: input.nextAttemptAt, finishedAt: terminal ? input.at : null, updatedAt: input.at }).where(owned(input.job)).returning({ id: inspirationTrendIngestionJobs.id });
    return row ? terminal ? "failed_known" as const : "queued" as const : "lost_lease" as const;
  }
}

export async function requestWorkspaceTrendRefresh(input: { workspaceId: string; userId: string; idempotencyKey: string; at?: Date }) {
  const at = input.at ?? new Date();
  await ensureWorkspaceOwnedTrendSource({ workspaceId: input.workspaceId, userId: input.userId, at });
  return getDb().transaction(async (tx) => {
    const sources = await tx.select().from(inspirationTrendSources).where(and(eq(inspirationTrendSources.workspaceId, input.workspaceId), eq(inspirationTrendSources.state, "active"))).orderBy(asc(inspirationTrendSources.id)).limit(100);
    let scheduled = 0; let replayed = 0;
    for (const source of sources) {
      const context = await currentRankingContext(tx, source);
      const rows = await tx.insert(inspirationTrendIngestionJobs).values({ workspaceId: input.workspaceId, id: randomUUID(), sourceId: source.id, sourceKey: `manual:${input.idempotencyKey}`, requestedByUserId: input.userId, state: "queued", cursor: source.cursor, rankingContext: context, nextAttemptAt: at, requestedAt: at, updatedAt: at }).onConflictDoNothing().returning({ id: inspirationTrendIngestionJobs.id });
      if (rows.length) scheduled += 1; else replayed += 1;
    }
    return { scheduled, replayed };
  });
}

export async function configureTrendSource(input: { workspaceId: string; userId: string; id: string; adapterKey: string; sourceKind: TrendSourceKind; displayName: string; scheduleMinutes: number; preferredRegions?: string[]; preferredArabicVarieties?: string[]; preferredFormats?: string[]; preferredTags?: string[]; excludedTags?: string[]; at?: Date }) {
  if (!input.id.trim() || input.id.length > 200 || !input.displayName.trim() || input.displayName.trim().length > 200 || !TREND_SOURCE_KINDS.includes(input.sourceKind) || !/^[a-z][a-z0-9._-]{1,119}$/.test(input.adapterKey) || !Number.isInteger(input.scheduleMinutes) || input.scheduleMinutes < 5 || input.scheduleMinutes > 10_080) throw new Error("TREND_SOURCE_INVALID");
  const at = input.at ?? new Date();
  const values = { workspaceId: input.workspaceId, id: input.id, adapterKey: input.adapterKey, sourceKind: input.sourceKind, displayName: input.displayName.trim(), state: "active", scheduleMinutes: input.scheduleMinutes, nextRunAt: at, cursor: null, preferredRegions: strings(input.preferredRegions, 20), preferredArabicVarieties: strings(input.preferredArabicVarieties, 5), preferredFormats: strings(input.preferredFormats, CONTENT_FORMATS.length), preferredTags: strings(input.preferredTags, 50), excludedTags: strings(input.excludedTags, 50), createdByUserId: input.userId, createdAt: at, updatedAt: at };
  const [row] = await getDb().insert(inspirationTrendSources).values(values).onConflictDoUpdate({ target: [inspirationTrendSources.workspaceId, inspirationTrendSources.id], set: { adapterKey: values.adapterKey, sourceKind: values.sourceKind, displayName: values.displayName, state: values.state, scheduleMinutes: values.scheduleMinutes, preferredRegions: values.preferredRegions, preferredArabicVarieties: values.preferredArabicVarieties, preferredFormats: values.preferredFormats, preferredTags: values.preferredTags, excludedTags: values.excludedTags, updatedAt: at } }).returning();
  return row;
}

export function createProductionTrendIngestionWorker(adapters: TrendIngestionAdapter[]) {
  return new TrendIngestionWorker(new PostgresTrendIngestionRepository(), new TrendAdapterRegistry(adapters));
}

/** Only the Workspace-owned adapter is enabled by default. External sources
 * remain fail-closed until their provider-specific policy is audited. */
export const PRODUCTION_TREND_INGESTION_WORKER = createProductionTrendIngestionWorker([workspaceOwnedTrendAdapter]);
