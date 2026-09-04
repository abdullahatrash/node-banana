import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, contentThemeRevisions, contentThemes, creatorPersonaEvidence, creatorPersonas, workspaceProductRecords } from "@/lib/db/schema";
import { evaluatePersonaGate, type CreatorPersona, type CreatorPersonaEvidence } from "@/lib/creator-personas/types";
import { parseProductPayload } from "./definitions";

export interface ContentEditorOptions {
  assets: Array<{ id: string; label: string; type: "image" | "video"; width: number | null; height: number | null; durationSeconds: number | null }>;
  personas: Array<{ id: string; label: string; revision: number }>;
  mediaSets: Array<{ id: string; label: string; assetCount: number }>;
  themes: Array<{ id: string; label: string; revision: number; digest: string }>;
}

function assetLabel(row: typeof assets.$inferSelect) {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
  const label = metadata.name ?? metadata.originalFileName;
  return typeof label === "string" && label.trim() ? label.trim().slice(0, 240) : row.storageKey.split("/").at(-1)?.slice(0, 240) || row.id;
}

export async function loadContentEditorOptions(workspaceId: string, now = new Date()): Promise<ContentEditorOptions> {
  const db = getDb();
  const [assetRows, personaRows, evidenceRows, mediaSetRows, themeRows] = await Promise.all([
    db.select().from(assets).where(and(eq(assets.workspaceId, workspaceId), isNull(assets.deletedAt), inArray(assets.type, ["image", "video"]), sql`${assets.metadata}->>'uploadState' = 'ready'`, sql`${assets.checksum} ~ '^sha256:[a-f0-9]{64}$'`)).orderBy(desc(assets.createdAt)).limit(100),
    db.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, workspaceId), eq(creatorPersonas.state, "active"), isNull(creatorPersonas.deletedAt))).orderBy(desc(creatorPersonas.updatedAt)).limit(100),
    db.select().from(creatorPersonaEvidence).where(eq(creatorPersonaEvidence.workspaceId, workspaceId)),
    db.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.kind, "media_set"), eq(workspaceProductRecords.state, "active"), isNull(workspaceProductRecords.archivedAt))).orderBy(desc(workspaceProductRecords.updatedAt)).limit(100),
    db.select({ id: contentThemes.id, label: contentThemes.title, revision: contentThemeRevisions.revision, digest: contentThemeRevisions.documentDigest, licenseExpiresAt: contentThemeRevisions.licenseExpiresAt }).from(contentThemes).innerJoin(contentThemeRevisions, and(eq(contentThemeRevisions.workspaceId, contentThemes.workspaceId), eq(contentThemeRevisions.themeId, contentThemes.id), eq(contentThemeRevisions.revision, contentThemes.activeRevision))).where(and(eq(contentThemes.workspaceId, workspaceId), eq(contentThemes.state, "active"), isNull(contentThemes.archivedAt))).orderBy(desc(contentThemes.updatedAt)).limit(100),
  ]);
  const evidenceByPersona = new Map<string, CreatorPersonaEvidence[]>();
  for (const evidence of evidenceRows as CreatorPersonaEvidence[]) evidenceByPersona.set(evidence.personaId, [...(evidenceByPersona.get(evidence.personaId) ?? []), evidence]);
  return {
    assets: assetRows.map((row) => ({ id: row.id, label: assetLabel(row), type: row.type as "image" | "video", width: row.width, height: row.height, durationSeconds: row.durationSeconds })),
    personas: personaRows.filter((row) => evaluatePersonaGate({ persona: row as CreatorPersona, evidence: evidenceByPersona.get(row.id) ?? [], at: now }).admitted).map((row) => ({ id: row.id, label: row.name, revision: row.revision })),
    mediaSets: mediaSetRows.map((row) => { const payload = parseProductPayload("media_set", row.payload); const assetIds = Array.isArray(payload.assetIds) ? payload.assetIds : []; return { id: row.id, label: row.title, assetCount: assetIds.length }; }),
    themes: themeRows.filter((row) => !row.licenseExpiresAt || row.licenseExpiresAt > now).map(({ id, label, revision, digest }) => ({ id, label, revision, digest })),
  };
}
