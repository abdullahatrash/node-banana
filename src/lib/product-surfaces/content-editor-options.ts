import "server-only";

import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, contentThemeRevisions, contentThemes, creatorPersonaEvidence, creatorPersonas, workspaceProductRecordRevisions, workspaceProductRecords } from "@/lib/db/schema";
import { evaluatePersonaGate, type CreatorPersona, type CreatorPersonaEvidence } from "@/lib/creator-personas/types";
import { inspirationRightsEvidence } from "@/lib/model-routing/db-schema";
import { parseProductPayload } from "./definitions";
import { mediaSetMembershipDigest } from "./content-execution-resources";
import { contentThemeDocumentSchema } from "./content-execution-resources";
import { isCuratedContentThemeLicenseEvidence } from "./content-theme-catalog";

export interface ContentEditorOptions {
  assets: Array<{ id: string; label: string; type: "image" | "video"; width: number | null; height: number | null; durationSeconds: number | null }>;
  personas: Array<{ id: string; label: string; revision: number }>;
  mediaSets: Array<{ id: string; label: string; assetCount: number; revision: number; digest: `sha256:${string}`; orderedAssetIds: string[] }>;
  themes: Array<{ id: string; label: string; revision: number; digest: `sha256:${string}`; document: ReturnType<typeof contentThemeDocumentSchema.parse>; licenseEvidenceIds: string[] }>;
}

function assetLabel(row: typeof assets.$inferSelect) {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
  const label = metadata.name ?? metadata.originalFileName;
  return typeof label === "string" && label.trim() ? label.trim().slice(0, 240) : row.storageKey.split("/").at(-1)?.slice(0, 240) || row.id;
}

export async function loadContentEditorOptions(workspaceId: string, now = new Date(), pinned?: { mediaSetRevisionRefs: Array<{ mediaSetId: string; revision: number }>; themeRevisionRefs: Array<{ themeId: string; revision: number }> }): Promise<ContentEditorOptions> {
  const db = getDb();
  const [assetRows, personaRows, evidenceRows, mediaSetRows, themeRows] = await Promise.all([
    db.select().from(assets).where(and(eq(assets.workspaceId, workspaceId), isNull(assets.deletedAt), inArray(assets.type, ["image", "video"]), sql`${assets.metadata}->>'uploadState' = 'ready'`, sql`${assets.checksum} ~ '^sha256:[a-f0-9]{64}$'`)).orderBy(desc(assets.createdAt)).limit(100),
    db.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, workspaceId), eq(creatorPersonas.state, "active"), isNull(creatorPersonas.deletedAt))).orderBy(desc(creatorPersonas.updatedAt)).limit(100),
    db.select().from(creatorPersonaEvidence).where(eq(creatorPersonaEvidence.workspaceId, workspaceId)),
    db.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.kind, "media_set"), eq(workspaceProductRecords.state, "active"), isNull(workspaceProductRecords.archivedAt))).orderBy(desc(workspaceProductRecords.updatedAt)).limit(100),
    db.select({ id: contentThemes.id, label: contentThemes.title, activeRevision: contentThemes.activeRevision, revision: contentThemeRevisions.revision, digest: contentThemeRevisions.documentDigest, document: contentThemeRevisions.document, licenseEvidenceIds: contentThemeRevisions.licenseEvidenceIds, licenseExpiresAt: contentThemeRevisions.licenseExpiresAt }).from(contentThemes).innerJoin(contentThemeRevisions, and(eq(contentThemeRevisions.workspaceId, contentThemes.workspaceId), eq(contentThemeRevisions.themeId, contentThemes.id))).where(and(eq(contentThemes.workspaceId, workspaceId), eq(contentThemes.state, "active"), isNull(contentThemes.archivedAt))).orderBy(desc(contentThemes.updatedAt)).limit(500),
  ]);
  const mediaSetSnapshots = mediaSetRows.length ? await db.select().from(workspaceProductRecordRevisions).where(and(eq(workspaceProductRecordRevisions.workspaceId, workspaceId), inArray(workspaceProductRecordRevisions.recordId, mediaSetRows.map((row) => row.id)))) : [];
  const membershipAssetIds = [...new Set(mediaSetSnapshots.flatMap((snapshot) => { const parsed = parseProductPayload("media_set", snapshot.payload); return Array.isArray(parsed.assetIds) ? parsed.assetIds : []; }))];
  const membershipAssets = membershipAssetIds.length ? await db.select({ id: assets.id, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, workspaceId), inArray(assets.id, membershipAssetIds), isNull(assets.deletedAt))) : [];
  const readyMembershipAssetIds = new Set(membershipAssets.filter((row) => /^sha256:[a-f0-9]{64}$/.test(row.checksum ?? "") && (row.metadata as Record<string, unknown> | null)?.uploadState === "ready").map((row) => row.id));
  const themeLicenseEvidenceIds = [...new Set(themeRows.flatMap((row) => Array.isArray(row.licenseEvidenceIds) ? row.licenseEvidenceIds : []))];
  const themeLicenseEvidence = themeLicenseEvidenceIds.length ? await db.select({ id: inspirationRightsEvidence.id }).from(inspirationRightsEvidence).where(and(eq(inspirationRightsEvidence.workspaceId, workspaceId), inArray(inspirationRightsEvidence.id, themeLicenseEvidenceIds), eq(inspirationRightsEvidence.basis, "licensed"), or(isNull(inspirationRightsEvidence.expiresAt), gt(inspirationRightsEvidence.expiresAt, now)))) : [];
  const currentThemeLicenseEvidenceIds = new Set(themeLicenseEvidence.map((row) => row.id));
  const evidenceByPersona = new Map<string, CreatorPersonaEvidence[]>();
  for (const evidence of evidenceRows as CreatorPersonaEvidence[]) evidenceByPersona.set(evidence.personaId, [...(evidenceByPersona.get(evidence.personaId) ?? []), evidence]);
  return {
    assets: assetRows.map((row) => ({ id: row.id, label: assetLabel(row), type: row.type as "image" | "video", width: row.width, height: row.height, durationSeconds: row.durationSeconds })),
    personas: personaRows.filter((row) => evaluatePersonaGate({ persona: row as CreatorPersona, evidence: evidenceByPersona.get(row.id) ?? [], at: now }).admitted).map((row) => ({ id: row.id, label: row.name, revision: row.revision })),
    mediaSets: mediaSetRows.flatMap((row) => mediaSetSnapshots.filter((snapshot) => snapshot.recordId === row.id && (snapshot.revision === row.revision || pinned?.mediaSetRevisionRefs.some((ref) => ref.mediaSetId === row.id && ref.revision === snapshot.revision))).flatMap((snapshot) => { const payload = parseProductPayload("media_set", snapshot.payload); const orderedAssetIds = Array.isArray(payload.assetIds) ? payload.assetIds : []; return orderedAssetIds.length && orderedAssetIds.every((id) => readyMembershipAssetIds.has(id)) ? [{ id: row.id, label: row.title, assetCount: orderedAssetIds.length, revision: snapshot.revision, digest: mediaSetMembershipDigest({ mediaSetId: row.id, revision: snapshot.revision, orderedAssetIds }), orderedAssetIds }] : []; })),
    themes: themeRows.flatMap(({ id, label, activeRevision, revision, digest, document, licenseEvidenceIds, licenseExpiresAt }) => { if (revision !== activeRevision && !pinned?.themeRevisionRefs.some((ref) => ref.themeId === id && ref.revision === revision)) return []; const parsed = contentThemeDocumentSchema.safeParse(document); return (!licenseExpiresAt || licenseExpiresAt > now) && parsed.success && /^sha256:[a-f0-9]{64}$/.test(digest) && Array.isArray(licenseEvidenceIds) && licenseEvidenceIds.length && licenseEvidenceIds.every((evidenceId) => currentThemeLicenseEvidenceIds.has(evidenceId) || isCuratedContentThemeLicenseEvidence({ themeId: id, revision, digest, evidenceId })) ? [{ id, label, revision, digest: digest as `sha256:${string}`, document: parsed.data, licenseEvidenceIds }] : []; }),
  };
}
