import "server-only";

import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, contentThemeRevisions, contentThemes, workspaceProductRecordRevisions, workspaceProductRecords } from "@/lib/db/schema";
import { inspirationRightsEvidence } from "@/lib/model-routing/db-schema";
import type { contentPieceSchema } from "./definitions";
import { orderedContentAssetIds, resolveMediaSetRevision, resolveThemeRevision } from "./content-execution-resources";
import { isCuratedContentThemeLicenseEvidence } from "./content-theme-catalog";

type ContentPiecePayload = ReturnType<typeof contentPieceSchema.parse>;

export async function loadContentExecutionResources(workspaceId: string, payload: ContentPiecePayload, now = new Date()) {
  const db = getDb();
  const mediaSetIds = [...new Set(payload.mediaSetRevisionRefs.map((reference) => reference.mediaSetId))];
  const themeIds = [...new Set(payload.themeRevisionRefs.map((reference) => reference.themeId))];
  const [mediaSetRows, snapshots, themeRows] = await Promise.all([
    mediaSetIds.length ? db.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.kind, "media_set"), inArray(workspaceProductRecords.id, mediaSetIds), eq(workspaceProductRecords.state, "active"), isNull(workspaceProductRecords.archivedAt))) : [],
    mediaSetIds.length ? db.select().from(workspaceProductRecordRevisions).where(and(eq(workspaceProductRecordRevisions.workspaceId, workspaceId), inArray(workspaceProductRecordRevisions.recordId, mediaSetIds))) : [],
    themeIds.length ? db.select({ workspaceId: contentThemes.workspaceId, themeId: contentThemeRevisions.themeId, revision: contentThemeRevisions.revision, state: contentThemes.state, document: contentThemeRevisions.document, documentDigest: contentThemeRevisions.documentDigest, licenseEvidenceIds: contentThemeRevisions.licenseEvidenceIds, licenseExpiresAt: contentThemeRevisions.licenseExpiresAt }).from(contentThemes).innerJoin(contentThemeRevisions, and(eq(contentThemeRevisions.workspaceId, contentThemes.workspaceId), eq(contentThemeRevisions.themeId, contentThemes.id))).where(and(eq(contentThemes.workspaceId, workspaceId), inArray(contentThemes.id, themeIds), eq(contentThemes.state, "active"), isNull(contentThemes.archivedAt))) : [],
  ]);
  const activeSetIds = new Set(mediaSetRows.map((row) => row.id));
  const snapshotsByKey = new Map(snapshots.map((row) => [`${row.recordId}:${row.revision}`, row]));
  const themeByKey = new Map(themeRows.map((row) => [`${row.themeId}:${row.revision}`, row]));
  const mediaSets = payload.mediaSetRevisionRefs.map((reference) => resolveMediaSetRevision({ workspaceId, reference: { ...reference, digest: reference.digest as `sha256:${string}` }, snapshot: activeSetIds.has(reference.mediaSetId) ? snapshotsByKey.get(`${reference.mediaSetId}:${reference.revision}`) ?? null : null }));
  const themes = payload.themeRevisionRefs.map((reference) => {
    if (!reference.digest) throw new Error("CONTENT_THEME_REVISION_INVALID");
    return resolveThemeRevision({ workspaceId, reference: { ...reference, digest: reference.digest as `sha256:${string}` }, row: themeByKey.get(`${reference.themeId}:${reference.revision}`) ?? null, now });
  });
  const licenseEvidenceIds = [...new Set(themes.flatMap((theme) => theme.licenseEvidenceIds))];
  const licenseEvidence = licenseEvidenceIds.length ? await db.select({ id: inspirationRightsEvidence.id }).from(inspirationRightsEvidence).where(and(eq(inspirationRightsEvidence.workspaceId, workspaceId), inArray(inspirationRightsEvidence.id, licenseEvidenceIds), eq(inspirationRightsEvidence.basis, "licensed"), or(isNull(inspirationRightsEvidence.expiresAt), gt(inspirationRightsEvidence.expiresAt, now)))) : [];
  const currentLicenseEvidenceIds = new Set(licenseEvidence.map((row) => row.id));
  if (themes.some((theme) => theme.licenseEvidenceIds.some((evidenceId) => !currentLicenseEvidenceIds.has(evidenceId) && !isCuratedContentThemeLicenseEvidence({ themeId: theme.themeId, revision: theme.revision, digest: theme.digest, evidenceId })))) throw new Error("CONTENT_THEME_LICENSE_EVIDENCE_INVALID");
  const orderedAssetIds = orderedContentAssetIds(payload.sourceAssetIds, mediaSets);
  const assetRows = orderedAssetIds.length ? await db.select().from(assets).where(and(eq(assets.workspaceId, workspaceId), inArray(assets.id, orderedAssetIds), isNull(assets.deletedAt))) : [];
  const assetById = new Map(assetRows.map((row) => [row.id, row]));
  const orderedAssets = orderedAssetIds.map((id) => assetById.get(id));
  if (orderedAssets.some((row) => !row || !/^sha256:[a-f0-9]{64}$/.test(row.checksum ?? "") || (row.metadata as Record<string, unknown> | null)?.uploadState !== "ready")) throw new Error("CONTENT_RESOURCE_ASSET_NOT_READY");
  return { mediaSets, themes, orderedAssetIds, orderedAssets: orderedAssets.filter((row): row is typeof assets.$inferSelect => Boolean(row)) };
}
