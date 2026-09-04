import "server-only";

import { and, count, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentThemeRevisions, contentThemes } from "@/lib/db/schema";
import { CURATED_CONTENT_THEMES, CURATED_THEME_LIMIT, curatedContentTheme } from "./content-theme-catalog";
import type { WorkspaceRemixSummary } from "./content-theme-summary";
import { mediaSetSchema } from "./definitions";
import { listProductRecords } from "./repository";

const workspaceThemeId = (catalogId: string) => `curated-theme:${catalogId}`;

export class ContentThemeCatalogError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function getWorkspaceRemixSummary(workspaceId: string): Promise<WorkspaceRemixSummary> {
  const [themeRows, mediaSetRows] = await Promise.all([
    getDb().select({ id: contentThemes.id, state: contentThemes.state, activeRevision: contentThemes.activeRevision, digest: contentThemeRevisions.documentDigest }).from(contentThemes).innerJoin(contentThemeRevisions, and(eq(contentThemeRevisions.workspaceId, contentThemes.workspaceId), eq(contentThemeRevisions.themeId, contentThemes.id), eq(contentThemeRevisions.revision, contentThemes.activeRevision))).where(and(eq(contentThemes.workspaceId, workspaceId), isNull(contentThemes.archivedAt))),
    listProductRecords({ workspaceId, kinds: ["media_set"] }),
  ]);
  const activeById = new Map(themeRows.filter((row) => row.state === "active").map((row) => [row.id, row]));
  return {
    themes: CURATED_CONTENT_THEMES.map((theme) => { const active = activeById.get(workspaceThemeId(theme.id)); return { catalogId: theme.id, themeId: workspaceThemeId(theme.id), revision: active?.activeRevision ?? theme.revision, authoredName: theme.authoredName, authoredDescription: theme.authoredDescription, culturalNote: theme.culturalNote, palette: theme.document.visual.palette, digest: active?.digest ?? theme.digest, active: Boolean(active && active.digest === theme.digest) }; }),
    activeThemeCount: activeById.size,
    themeLimit: CURATED_THEME_LIMIT,
    mediaSets: mediaSetRows.map((row) => { const payload = mediaSetSchema.parse(row.payload); return { id: row.id, title: row.title, revision: row.revision, assetCount: payload.assetIds.length, purpose: payload.purpose }; }),
    measuredAt: new Date().toISOString(),
  };
}

export async function addCuratedContentTheme(input: { workspaceId: string; userId: string; catalogId: string }) {
  const catalog = curatedContentTheme(input.catalogId);
  if (!catalog) throw new ContentThemeCatalogError("CONTENT_THEME_NOT_FOUND");
  const id = workspaceThemeId(catalog.id);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:curated-themes`}))`);
    const [existing] = await tx.select().from(contentThemes).where(and(eq(contentThemes.workspaceId, input.workspaceId), eq(contentThemes.id, id))).limit(1);
    const [existingRevision] = existing ? await tx.select().from(contentThemeRevisions).where(and(eq(contentThemeRevisions.workspaceId, input.workspaceId), eq(contentThemeRevisions.themeId, id), eq(contentThemeRevisions.revision, catalog.revision))).limit(1) : [];
    if (existingRevision && existingRevision.documentDigest !== catalog.digest) throw new ContentThemeCatalogError("CONTENT_THEME_REVISION_CONFLICT");
    if (existing?.state === "active" && !existing.archivedAt && existing.activeRevision === catalog.revision && existingRevision?.documentDigest === catalog.digest) return { kind: "replayed" as const, theme: existing };
    const consumesSlot = !existing || existing.state !== "active" || Boolean(existing.archivedAt);
    if (consumesSlot) {
      const [usage] = await tx.select({ value: count() }).from(contentThemes).where(and(eq(contentThemes.workspaceId, input.workspaceId), eq(contentThemes.state, "active"), isNull(contentThemes.archivedAt)));
      if ((usage?.value ?? 0) >= CURATED_THEME_LIMIT) throw new ContentThemeCatalogError("CONTENT_THEME_LIMIT_REACHED");
    }
    const now = new Date();
    if (existing) {
      if (!existingRevision) throw new ContentThemeCatalogError("CONTENT_THEME_REVISION_CONFLICT");
      const [theme] = await tx.update(contentThemes).set({ state: "active", activeRevision: catalog.revision, title: `${catalog.authoredName.en} · ${catalog.authoredName.ar}`, archivedAt: null, updatedAt: now }).where(and(eq(contentThemes.workspaceId, input.workspaceId), eq(contentThemes.id, id))).returning();
      return { kind: "reactivated" as const, theme };
    }
    await tx.insert(contentThemes).values({ workspaceId: input.workspaceId, id, title: `${catalog.authoredName.en} · ${catalog.authoredName.ar}`, state: "draft", activeRevision: null, createdByUserId: input.userId, createdAt: now, updatedAt: now });
    await tx.insert(contentThemeRevisions).values({ workspaceId: input.workspaceId, themeId: id, revision: catalog.revision, document: catalog.document, documentDigest: catalog.digest, licenseEvidenceIds: catalog.licenseEvidenceIds, licenseExpiresAt: null, authoredByUserId: input.userId, createdAt: now });
    const [theme] = await tx.update(contentThemes).set({ state: "active", activeRevision: catalog.revision, updatedAt: now }).where(and(eq(contentThemes.workspaceId, input.workspaceId), eq(contentThemes.id, id))).returning();
    return { kind: "created" as const, theme };
  });
}

export async function archiveCuratedContentTheme(input: { workspaceId: string; catalogId: string }) {
  if (!curatedContentTheme(input.catalogId)) throw new ContentThemeCatalogError("CONTENT_THEME_NOT_FOUND");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.workspaceId}:curated-themes`}))`);
    const id = workspaceThemeId(input.catalogId);
    const [existing] = await tx.select().from(contentThemes).where(and(eq(contentThemes.workspaceId, input.workspaceId), eq(contentThemes.id, id))).limit(1);
    if (!existing) throw new ContentThemeCatalogError("CONTENT_THEME_NOT_ACTIVE");
    if (existing.state === "archived" || existing.archivedAt) return { kind: "replayed" as const, theme: existing };
    const now = new Date();
    const [theme] = await tx.update(contentThemes).set({ state: "archived", archivedAt: now, updatedAt: now }).where(and(eq(contentThemes.workspaceId, input.workspaceId), eq(contentThemes.id, id), eq(contentThemes.state, "active"))).returning();
    if (!theme) throw new ContentThemeCatalogError("CONTENT_THEME_NOT_ACTIVE");
    return { kind: "archived" as const, theme };
  });
}
