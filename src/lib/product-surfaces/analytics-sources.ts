import "server-only"

import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { and, eq } from "drizzle-orm"
import { canonicalDigest } from "@/lib/agent-tools/canonical"
import { getDb } from "@/lib/db"
import { productAnalyticsRefreshJobs, workspaceProductRecords } from "@/lib/db/schema"
import { fetchPublicRemoteFile } from "@/lib/security/remote-file-fetch"
import { geoAnalyticsSourceSchema, websiteAnalyticsSourceSchema } from "./definitions"
import { updateProductRecord, updateProductRecordInTransaction } from "./repository"

export class AnalyticsSourceError extends Error {
  constructor(readonly code: "ANALYTICS_SOURCE_NOT_FOUND" | "ANALYTICS_SOURCE_NOT_VERIFIED" | "ANALYTICS_SOURCE_VERIFICATION_FAILED") { super(code) }
}

export async function verifyAnalyticsSource(input: { workspaceId: string; userId: string; id: string; expectedRevision: number; idempotencyKey: string }) {
  const [record] = await getDb().select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.id))).limit(1)
  if (!record || (record.kind !== "website_analytics_source" && record.kind !== "geo_analytics_source")) throw new AnalyticsSourceError("ANALYTICS_SOURCE_NOT_FOUND")
  const source = record.kind === "website_analytics_source"
    ? { kind: "website_analytics_source" as const, payload: websiteAnalyticsSourceSchema.parse(record.payload) }
    : { kind: "geo_analytics_source" as const, payload: geoAnalyticsSourceSchema.parse(record.payload) }
  const hostname = source.kind === "website_analytics_source" ? source.payload.hostname : source.payload.domain
  const fetched = await fetchPublicRemoteFile({ sourceUrl: `https://${hostname}/`, allowedOrigins: [`https://${hostname}`], maximumBytes: 1_000_000, timeoutMs: 5_000, maxRedirects: 1 }).catch(() => { throw new AnalyticsSourceError("ANALYTICS_SOURCE_VERIFICATION_FAILED") })
  try {
    if (fetched.mimeType && fetched.mimeType !== "text/html" && fetched.mimeType !== "application/xhtml+xml") throw new AnalyticsSourceError("ANALYTICS_SOURCE_VERIFICATION_FAILED")
    const html = await readFile(fetched.path, "utf8")
    if (!html.includes(source.payload.verificationChallenge)) throw new AnalyticsSourceError("ANALYTICS_SOURCE_VERIFICATION_FAILED")
  } finally {
    await fetched.cleanup()
  }
  const now = new Date().toISOString()
  return updateProductRecord({ workspaceId: input.workspaceId, userId: input.userId, id: input.id, expectedKind: source.kind, expectedRevision: input.expectedRevision, state: "active", payload: { ...source.payload, enabled: true, verificationStatus: "verified", verifiedAt: now, refreshStatus: "idle", lastRefreshError: null }, idempotencyKey: input.idempotencyKey })
}

export async function requestAnalyticsRefresh(input: { workspaceId: string; userId: string; id: string; expectedRevision: number; idempotencyKey: string }) {
  return getDb().transaction(async (tx) => {
    const [record] = await tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.id))).limit(1)
    if (!record || (record.kind !== "website_analytics_source" && record.kind !== "geo_analytics_source")) throw new AnalyticsSourceError("ANALYTICS_SOURCE_NOT_FOUND")
    const source = record.kind === "website_analytics_source"
      ? { kind: "website_analytics_source" as const, payload: websiteAnalyticsSourceSchema.parse(record.payload) }
      : { kind: "geo_analytics_source" as const, payload: geoAnalyticsSourceSchema.parse(record.payload) }
    if (!source.payload.enabled || source.payload.verificationStatus !== "verified") throw new AnalyticsSourceError("ANALYTICS_SOURCE_NOT_VERIFIED")
    const now = new Date()
    const updated = await updateProductRecordInTransaction(tx, { workspaceId: input.workspaceId, userId: input.userId, id: input.id, expectedKind: source.kind, expectedRevision: input.expectedRevision, payload: { ...source.payload, refreshStatus: "queued", refreshRequestedAt: now.toISOString(), lastRefreshError: null }, idempotencyKey: input.idempotencyKey, now })
    if (!updated) throw new AnalyticsSourceError("ANALYTICS_SOURCE_NOT_FOUND")
    const requestDigest = canonicalDigest({ workspaceId: input.workspaceId, sourceId: input.id, sourceRevision: updated.revision, sourceKind: source.kind })
    await tx.insert(productAnalyticsRefreshJobs).values({ workspaceId: input.workspaceId, id: randomUUID(), sourceId: input.id, sourceRevision: updated.revision, sourceKind: source.kind, state: "queued", nextAttemptAt: now, idempotencyKey: input.idempotencyKey, requestDigest, requestedByUserId: input.userId, requestedAt: now, updatedAt: now }).onConflictDoNothing({ target: [productAnalyticsRefreshJobs.workspaceId, productAnalyticsRefreshJobs.idempotencyKey] })
    return updated
  })
}
