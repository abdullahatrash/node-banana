import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  licensedTrendCatalogEntries,
  licensedTrendCatalogRevisions,
  licensedTrendMaterializationJobs,
  licensedTrendWorkspaceEntitlements,
} from "@/lib/db/schema";
import {
  licensedTrendCatalogDocumentSchema,
  licensedTrendCatalogUnsignedSchema,
  licensedTrendEntitlementDocumentSchema,
  type LicensedTrendCatalogCard,
  type LicensedTrendCatalogDocument,
  type LicensedTrendEntitlementDocument,
} from "./licensed-trend-types";
import { getObjectStreamFromS3 } from "@/lib/storage";

const stableId = (prefix: string, value: string) => `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
const normalizeSearch = (values: string[]) => values.join(" ").normalize("NFKC").toLocaleLowerCase("und").slice(0, 8_000);

export class LicensedTrendCatalogError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function verifyCatalogObject(object: { storageKey: string; versionId: string | null; etag: string; digest: string; sizeBytes: number; mimeType: string }) {
  const stored = await getObjectStreamFromS3({ key: object.storageKey });
  if (stored.contentLength !== object.sizeBytes || stored.etag !== object.etag || stored.versionId !== object.versionId || (stored.contentType && stored.contentType !== object.mimeType)) throw new LicensedTrendCatalogError("CATALOG_OBJECT_IDENTITY_MISMATCH");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stored.body) { size += chunk.byteLength; hash.update(chunk); }
  if (size !== object.sizeBytes || `sha256:${hash.digest("hex")}` !== object.digest) throw new LicensedTrendCatalogError("CATALOG_OBJECT_DIGEST_MISMATCH");
}

export async function publishLicensedTrendCatalogRevision(input: {
  document: Omit<LicensedTrendCatalogDocument, "digest">;
  at?: Date;
}) {
  const unsigned = licensedTrendCatalogUnsignedSchema.parse(input.document);
  const document = licensedTrendCatalogDocumentSchema.parse({ ...unsigned, digest: canonicalDigest(unsigned) });
  const at = input.at ?? new Date();
  await Promise.all([verifyCatalogObject(document.media), verifyCatalogObject(document.evidenceDocument)]);
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`licensed-catalog:${document.id}`}))`);
    const [head] = await tx.select().from(licensedTrendCatalogEntries).where(eq(licensedTrendCatalogEntries.id, document.id)).limit(1);
    if (head && (head.providerKey !== document.provider.key || head.providerItemId !== document.provider.itemId)) throw new LicensedTrendCatalogError("CATALOG_IDENTITY_CONFLICT");
    if (head && document.revision < head.activeRevision) throw new LicensedTrendCatalogError("CATALOG_REVISION_REGRESSION");
    const [existing] = await tx.select().from(licensedTrendCatalogRevisions).where(and(eq(licensedTrendCatalogRevisions.catalogId, document.id), eq(licensedTrendCatalogRevisions.revision, document.revision))).limit(1);
    if (existing) {
      if (existing.documentDigest !== document.digest) throw new LicensedTrendCatalogError("CATALOG_REVISION_IMMUTABLE");
      return { kind: "replayed" as const, document };
    }
    if (head && document.revision !== head.activeRevision + 1) throw new LicensedTrendCatalogError("CATALOG_REVISION_GAP");
    await tx.insert(licensedTrendCatalogEntries).values({ id: document.id, providerKey: document.provider.key, providerItemId: document.provider.itemId, activeRevision: document.revision, state: "active", createdAt: at, updatedAt: at }).onConflictDoUpdate({ target: licensedTrendCatalogEntries.id, set: { activeRevision: document.revision, state: "active", updatedAt: at } });
    await tx.insert(licensedTrendCatalogRevisions).values({
      catalogId: document.id, revision: document.revision, document, documentDigest: document.digest,
      contentLanguage: document.classification.contentLanguage, arabicVariety: document.classification.arabicVariety,
      region: document.classification.region, format: document.classification.format,
      publishedAt: new Date(document.publishedAt), metricsObservedAt: new Date(document.metrics.observedAt),
      rightsExpiresAt: document.rights.expiresAt ? new Date(document.rights.expiresAt) : null,
      searchableText: normalizeSearch([document.title, document.sourceName, document.classification.region, ...document.classification.tags, ...document.classification.creativePrimitives.topics]), createdAt: at,
    });
    return { kind: "created" as const, document };
  });
}

export async function setLicensedTrendCatalogState(input: { catalogId: string; state: "active" | "paused" | "revoked"; at?: Date }) {
  const [updated] = await getDb().update(licensedTrendCatalogEntries).set({ state: input.state, updatedAt: input.at ?? new Date() }).where(eq(licensedTrendCatalogEntries.id, input.catalogId)).returning();
  if (!updated) throw new LicensedTrendCatalogError("CATALOG_NOT_FOUND");
  return updated;
}

export async function grantLicensedTrendEntitlement(input: {
  workspaceId: string; catalogId: string; catalogRevision: number; territories: string[];
  expiresAt: Date | null; grantAuthority: string; at?: Date;
}) {
  const at = input.at ?? new Date();
  const [catalog] = await getDb().select({ head: licensedTrendCatalogEntries, revision: licensedTrendCatalogRevisions }).from(licensedTrendCatalogEntries).innerJoin(licensedTrendCatalogRevisions, and(eq(licensedTrendCatalogRevisions.catalogId, licensedTrendCatalogEntries.id), eq(licensedTrendCatalogRevisions.revision, input.catalogRevision))).where(eq(licensedTrendCatalogEntries.id, input.catalogId)).limit(1);
  if (!catalog || catalog.head.state === "revoked") throw new LicensedTrendCatalogError("CATALOG_NOT_GRANTABLE");
  if (catalog.revision.documentDigest !== catalog.revision.document.digest) throw new LicensedTrendCatalogError("CATALOG_DIGEST_MISMATCH");
  const id = stableId("lte", `${input.workspaceId}:${input.catalogId}:${input.catalogRevision}`);
  const unsigned = {
    schema: "licensed-trend-workspace-entitlement/v1" as const, id, workspaceId: input.workspaceId,
    catalog: { id: input.catalogId, revision: input.catalogRevision, digest: catalog.revision.documentDigest as `sha256:${string}` },
    state: "active" as const, territories: [...new Set(input.territories)], grantedAt: at.toISOString(),
    expiresAt: input.expiresAt?.toISOString() ?? null, revokedAt: null, grantAuthority: input.grantAuthority,
  };
  const document = licensedTrendEntitlementDocumentSchema.parse({ ...unsigned, digest: canonicalDigest(unsigned) });
  const [existing] = await getDb().select().from(licensedTrendWorkspaceEntitlements).where(and(eq(licensedTrendWorkspaceEntitlements.workspaceId, input.workspaceId), eq(licensedTrendWorkspaceEntitlements.id, id))).limit(1);
  if (existing) {
    if (existing.documentDigest !== document.digest) throw new LicensedTrendCatalogError("ENTITLEMENT_IMMUTABLE");
    return { kind: "replayed" as const, document };
  }
  await getDb().insert(licensedTrendWorkspaceEntitlements).values({ workspaceId: input.workspaceId, id, catalogId: input.catalogId, catalogRevision: input.catalogRevision, catalogDigest: catalog.revision.documentDigest, state: "active", document, documentDigest: document.digest, grantedAt: at, expiresAt: input.expiresAt, revokedAt: null, updatedAt: at });
  return { kind: "created" as const, document };
}

export async function revokeLicensedTrendEntitlement(input: { workspaceId: string; entitlementId: string; at?: Date }) {
  const at = input.at ?? new Date();
  const [row] = await getDb().select().from(licensedTrendWorkspaceEntitlements).where(and(eq(licensedTrendWorkspaceEntitlements.workspaceId, input.workspaceId), eq(licensedTrendWorkspaceEntitlements.id, input.entitlementId))).limit(1);
  if (!row) throw new LicensedTrendCatalogError("ENTITLEMENT_NOT_FOUND");
  const current = licensedTrendEntitlementDocumentSchema.parse(row.document);
  if (current.state === "revoked") return current;
  const unsigned = { ...current, state: "revoked" as const, revokedAt: at.toISOString() };
  const { digest: _oldDigest, ...withoutDigest } = unsigned;
  const document = licensedTrendEntitlementDocumentSchema.parse({ ...withoutDigest, digest: canonicalDigest(withoutDigest) });
  await getDb().update(licensedTrendWorkspaceEntitlements).set({ state: "revoked", document, documentDigest: document.digest, revokedAt: at, updatedAt: at }).where(and(eq(licensedTrendWorkspaceEntitlements.workspaceId, input.workspaceId), eq(licensedTrendWorkspaceEntitlements.id, input.entitlementId)));
  return document;
}

export async function listLicensedTrendCatalog(input: { workspaceId: string; query?: string; language?: "ar" | "en"; arabicVariety?: string; region?: string; format?: string; limit?: number; at?: Date }): Promise<LicensedTrendCatalogCard[]> {
  const at = input.at ?? new Date();
  const filters = [
    eq(licensedTrendWorkspaceEntitlements.workspaceId, input.workspaceId), eq(licensedTrendWorkspaceEntitlements.state, "active"),
    or(isNull(licensedTrendWorkspaceEntitlements.expiresAt), sql`${licensedTrendWorkspaceEntitlements.expiresAt} > ${at}`)!,
    eq(licensedTrendCatalogEntries.state, "active"),
    or(isNull(licensedTrendCatalogRevisions.rightsExpiresAt), sql`${licensedTrendCatalogRevisions.rightsExpiresAt} > ${at}`)!,
    eq(licensedTrendCatalogRevisions.documentDigest, licensedTrendWorkspaceEntitlements.catalogDigest),
  ];
  if (input.query?.trim()) filters.push(ilike(licensedTrendCatalogRevisions.searchableText, `%${input.query.trim().normalize("NFKC")}%`));
  if (input.language) filters.push(eq(licensedTrendCatalogRevisions.contentLanguage, input.language));
  if (input.arabicVariety) filters.push(eq(licensedTrendCatalogRevisions.arabicVariety, input.arabicVariety));
  if (input.region) filters.push(eq(licensedTrendCatalogRevisions.region, input.region));
  if (input.format) filters.push(eq(licensedTrendCatalogRevisions.format, input.format));
  const rows = await getDb().select({ entitlement: licensedTrendWorkspaceEntitlements, revision: licensedTrendCatalogRevisions, job: licensedTrendMaterializationJobs }).from(licensedTrendWorkspaceEntitlements)
    .innerJoin(licensedTrendCatalogEntries, eq(licensedTrendCatalogEntries.id, licensedTrendWorkspaceEntitlements.catalogId))
    .innerJoin(licensedTrendCatalogRevisions, and(eq(licensedTrendCatalogRevisions.catalogId, licensedTrendWorkspaceEntitlements.catalogId), eq(licensedTrendCatalogRevisions.revision, licensedTrendWorkspaceEntitlements.catalogRevision)))
    .leftJoin(licensedTrendMaterializationJobs, and(eq(licensedTrendMaterializationJobs.workspaceId, licensedTrendWorkspaceEntitlements.workspaceId), eq(licensedTrendMaterializationJobs.entitlementId, licensedTrendWorkspaceEntitlements.id)))
    .where(and(...filters)).orderBy(desc(licensedTrendCatalogRevisions.metricsObservedAt), asc(licensedTrendCatalogRevisions.catalogId)).limit(Math.min(input.limit ?? 60, 100));
  return rows.map((row) => ({ catalogId: row.revision.catalogId, revision: row.revision.revision, entitlementId: row.entitlement.id, state: row.job?.state === "succeeded" ? "imported" : row.job?.state === "failed_known" ? "failed" : row.job ? "importing" : "available", importJobId: row.job?.id ?? null, inspirationItemId: row.job?.inspirationItemId ?? null, previewUrl: `/api/product-inspiration/licensed-catalog/${encodeURIComponent(row.revision.catalogId)}/${row.revision.revision}/preview`, document: licensedTrendCatalogDocumentSchema.parse(row.revision.document) }));
}

export async function getLicensedTrendPreview(input: { workspaceId: string; catalogId: string; revision: number; at?: Date }) {
  const at = input.at ?? new Date();
  const [row] = await getDb().select({ entitlement: licensedTrendWorkspaceEntitlements, head: licensedTrendCatalogEntries, revision: licensedTrendCatalogRevisions }).from(licensedTrendWorkspaceEntitlements)
    .innerJoin(licensedTrendCatalogEntries, eq(licensedTrendCatalogEntries.id, licensedTrendWorkspaceEntitlements.catalogId))
    .innerJoin(licensedTrendCatalogRevisions, and(eq(licensedTrendCatalogRevisions.catalogId, licensedTrendWorkspaceEntitlements.catalogId), eq(licensedTrendCatalogRevisions.revision, licensedTrendWorkspaceEntitlements.catalogRevision)))
    .where(and(eq(licensedTrendWorkspaceEntitlements.workspaceId, input.workspaceId), eq(licensedTrendWorkspaceEntitlements.catalogId, input.catalogId), eq(licensedTrendWorkspaceEntitlements.catalogRevision, input.revision))).limit(1);
  if (!row || row.entitlement.state !== "active" || row.head.state !== "active" || row.entitlement.catalogDigest !== row.revision.documentDigest || (row.entitlement.expiresAt && row.entitlement.expiresAt <= at) || (row.revision.rightsExpiresAt && row.revision.rightsExpiresAt <= at)) throw new LicensedTrendCatalogError("LICENSED_TREND_NOT_ENTITLED");
  const document = licensedTrendCatalogDocumentSchema.parse(row.revision.document);
  return { storageKey: document.media.storageKey, mediaType: document.media.type, mimeType: document.media.mimeType };
}

export async function listActiveLicensedCatalogBindingKeys(workspaceId: string, at = new Date()) {
  const rows = await getDb().select({ entitlementId: licensedTrendWorkspaceEntitlements.id, catalogId: licensedTrendWorkspaceEntitlements.catalogId, revision: licensedTrendWorkspaceEntitlements.catalogRevision, digest: licensedTrendWorkspaceEntitlements.catalogDigest }).from(licensedTrendWorkspaceEntitlements)
    .innerJoin(licensedTrendCatalogEntries, and(eq(licensedTrendCatalogEntries.id, licensedTrendWorkspaceEntitlements.catalogId), eq(licensedTrendCatalogEntries.state, "active")))
    .innerJoin(licensedTrendCatalogRevisions, and(eq(licensedTrendCatalogRevisions.catalogId, licensedTrendWorkspaceEntitlements.catalogId), eq(licensedTrendCatalogRevisions.revision, licensedTrendWorkspaceEntitlements.catalogRevision), eq(licensedTrendCatalogRevisions.documentDigest, licensedTrendWorkspaceEntitlements.catalogDigest)))
    .where(and(eq(licensedTrendWorkspaceEntitlements.workspaceId, workspaceId), eq(licensedTrendWorkspaceEntitlements.state, "active"), or(isNull(licensedTrendWorkspaceEntitlements.expiresAt), sql`${licensedTrendWorkspaceEntitlements.expiresAt} > ${at}`), or(isNull(licensedTrendCatalogRevisions.rightsExpiresAt), sql`${licensedTrendCatalogRevisions.rightsExpiresAt} > ${at}`)));
  return new Set(rows.map((row) => `${row.catalogId}:${row.revision}:${row.digest}:${row.entitlementId}`));
}

export async function requestLicensedTrendMaterialization(input: { workspaceId: string; userId: string; entitlementId: string; idempotencyKey: string; at?: Date }) {
  const at = input.at ?? new Date();
  const [row] = await getDb().select({ entitlement: licensedTrendWorkspaceEntitlements, catalog: licensedTrendCatalogEntries, revision: licensedTrendCatalogRevisions }).from(licensedTrendWorkspaceEntitlements)
    .innerJoin(licensedTrendCatalogEntries, eq(licensedTrendCatalogEntries.id, licensedTrendWorkspaceEntitlements.catalogId))
    .innerJoin(licensedTrendCatalogRevisions, and(eq(licensedTrendCatalogRevisions.catalogId, licensedTrendWorkspaceEntitlements.catalogId), eq(licensedTrendCatalogRevisions.revision, licensedTrendWorkspaceEntitlements.catalogRevision)))
    .where(and(eq(licensedTrendWorkspaceEntitlements.workspaceId, input.workspaceId), eq(licensedTrendWorkspaceEntitlements.id, input.entitlementId))).limit(1);
  if (!row || row.entitlement.state !== "active" || row.catalog.state !== "active" || (row.entitlement.expiresAt && row.entitlement.expiresAt <= at) || (row.revision.rightsExpiresAt && row.revision.rightsExpiresAt <= at) || row.entitlement.catalogDigest !== row.revision.documentDigest) throw new LicensedTrendCatalogError("LICENSED_TREND_NOT_ENTITLED");
  const requestDigest = canonicalDigest({ workspaceId: input.workspaceId, entitlementId: input.entitlementId, catalogId: row.revision.catalogId, revision: row.revision.revision, digest: row.revision.documentDigest });
  const [sameKey] = await getDb().select().from(licensedTrendMaterializationJobs).where(and(eq(licensedTrendMaterializationJobs.workspaceId, input.workspaceId), eq(licensedTrendMaterializationJobs.idempotencyKey, input.idempotencyKey))).limit(1);
  if (sameKey) {
    if (sameKey.requestDigest !== requestDigest) throw new LicensedTrendCatalogError("IDEMPOTENCY_CONFLICT");
    return { kind: "replayed" as const, job: sameKey };
  }
  const [existing] = await getDb().select().from(licensedTrendMaterializationJobs).where(and(eq(licensedTrendMaterializationJobs.workspaceId, input.workspaceId), eq(licensedTrendMaterializationJobs.entitlementId, input.entitlementId))).limit(1);
  if (existing) return { kind: "replayed" as const, job: existing };
  const jobId = `ltm_${randomUUID()}`;
  const prefix = `licensed-imports/${input.workspaceId}/${row.revision.catalogId}/r${row.revision.revision}`;
  const [job] = await getDb().insert(licensedTrendMaterializationJobs).values({ workspaceId: input.workspaceId, id: jobId, entitlementId: input.entitlementId, catalogId: row.revision.catalogId, catalogRevision: row.revision.revision, catalogDigest: row.revision.documentDigest, state: "queued", idempotencyKey: input.idempotencyKey, requestDigest, requestedByUserId: input.userId, sourceDestinationKey: `${prefix}/source`, evidenceDestinationKey: `${prefix}/license-evidence`, nextAttemptAt: at, requestedAt: at, updatedAt: at }).returning();
  return { kind: "created" as const, job };
}

export async function retryLicensedTrendMaterialization(input: { workspaceId: string; jobId: string; at?: Date }) {
  const at = input.at ?? new Date();
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select({ job: licensedTrendMaterializationJobs, entitlement: licensedTrendWorkspaceEntitlements, catalog: licensedTrendCatalogEntries, revision: licensedTrendCatalogRevisions }).from(licensedTrendMaterializationJobs)
      .innerJoin(licensedTrendWorkspaceEntitlements, and(eq(licensedTrendWorkspaceEntitlements.workspaceId, licensedTrendMaterializationJobs.workspaceId), eq(licensedTrendWorkspaceEntitlements.id, licensedTrendMaterializationJobs.entitlementId)))
      .innerJoin(licensedTrendCatalogEntries, eq(licensedTrendCatalogEntries.id, licensedTrendMaterializationJobs.catalogId))
      .innerJoin(licensedTrendCatalogRevisions, and(eq(licensedTrendCatalogRevisions.catalogId, licensedTrendMaterializationJobs.catalogId), eq(licensedTrendCatalogRevisions.revision, licensedTrendMaterializationJobs.catalogRevision)))
      .where(and(eq(licensedTrendMaterializationJobs.workspaceId, input.workspaceId), eq(licensedTrendMaterializationJobs.id, input.jobId))).limit(1).for("update");
    if (!row) throw new LicensedTrendCatalogError("MATERIALIZATION_NOT_FOUND");
    if (row.entitlement.state !== "active" || row.catalog.state !== "active" || row.entitlement.catalogDigest !== row.revision.documentDigest || (row.entitlement.expiresAt && row.entitlement.expiresAt <= at) || (row.revision.rightsExpiresAt && row.revision.rightsExpiresAt <= at)) throw new LicensedTrendCatalogError("LICENSED_TREND_NOT_ENTITLED");
    if (row.job.state === "succeeded") return { kind: "already_succeeded" as const, job: row.job };
    if (row.job.state !== "failed_known") return { kind: "already_pending" as const, job: row.job };
    const [job] = await tx.update(licensedTrendMaterializationJobs).set({ state: "queued", attempt: 0, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: at, failureCode: null, finishedAt: null, updatedAt: at }).where(and(eq(licensedTrendMaterializationJobs.workspaceId, input.workspaceId), eq(licensedTrendMaterializationJobs.id, input.jobId), eq(licensedTrendMaterializationJobs.state, "failed_known"))).returning();
    if (!job) throw new LicensedTrendCatalogError("MATERIALIZATION_RETRY_CONFLICT");
    return { kind: "retried" as const, job };
  });
}

export async function assertLicensedCatalogBindingActive(input: { workspaceId: string; catalogId: string; revision: number; digest: string; entitlementId: string; at?: Date }) {
  const at = input.at ?? new Date();
  const [row] = await getDb().select({ entitlement: licensedTrendWorkspaceEntitlements, catalog: licensedTrendCatalogEntries, revision: licensedTrendCatalogRevisions }).from(licensedTrendWorkspaceEntitlements)
    .innerJoin(licensedTrendCatalogEntries, eq(licensedTrendCatalogEntries.id, licensedTrendWorkspaceEntitlements.catalogId))
    .innerJoin(licensedTrendCatalogRevisions, and(eq(licensedTrendCatalogRevisions.catalogId, licensedTrendWorkspaceEntitlements.catalogId), eq(licensedTrendCatalogRevisions.revision, licensedTrendWorkspaceEntitlements.catalogRevision)))
    .where(and(eq(licensedTrendWorkspaceEntitlements.workspaceId, input.workspaceId), eq(licensedTrendWorkspaceEntitlements.id, input.entitlementId), eq(licensedTrendWorkspaceEntitlements.catalogId, input.catalogId), eq(licensedTrendWorkspaceEntitlements.catalogRevision, input.revision), eq(licensedTrendWorkspaceEntitlements.catalogDigest, input.digest))).limit(1);
  return Boolean(row && row.entitlement.state === "active" && row.catalog.state === "active" && (!row.entitlement.expiresAt || row.entitlement.expiresAt > at) && (!row.revision.rightsExpiresAt || row.revision.rightsExpiresAt > at));
}

export type { LicensedTrendEntitlementDocument };
