import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const contentThemeDocumentSchema = z.object({
  schema: z.literal("content-theme/v1"),
  visual: z.object({
    stylePrompt: text(2_000),
    palette: z.array(z.string().regex(/^#[a-fA-F0-9]{6}$/)).max(16).default([]),
    avoid: z.array(text(300)).max(30).default([]),
  }).strict(),
  captions: z.object({
    style: text(300),
    fontFamilies: z.array(text(200)).min(1).max(12),
    position: z.enum(["top", "center", "bottom"]),
    bidi: z.literal("native"),
  }).strict(),
}).strict();

export type ContentThemeDocument = z.infer<typeof contentThemeDocumentSchema>;
export type MediaSetRevisionRef = { mediaSetId: string; revision: number; digest: `sha256:${string}` };
export type ThemeRevisionRef = { themeId: string; revision: number; digest: `sha256:${string}` };

export interface ResolvedMediaSetRevision extends MediaSetRevisionRef {
  orderedAssetIds: string[];
}

export interface ResolvedThemeRevision extends ThemeRevisionRef {
  document: ContentThemeDocument;
  licenseEvidenceIds: string[];
}

export function mediaSetMembershipDigest(input: { mediaSetId: string; revision: number; orderedAssetIds: string[] }): `sha256:${string}` {
  return canonicalDigest({ schema: "media-set-membership/v1", ...input }) as `sha256:${string}`;
}

export function resolveMediaSetRevision(input: {
  reference: MediaSetRevisionRef;
  snapshot: { workspaceId: string; recordId: string; revision: number; state: string; payload: unknown } | null;
  workspaceId: string;
}): ResolvedMediaSetRevision {
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.workspaceId !== input.workspaceId || snapshot.recordId !== input.reference.mediaSetId || snapshot.revision !== input.reference.revision || snapshot.state !== "active") throw new Error("CONTENT_MEDIA_SET_REVISION_INVALID");
  const parsed = z.object({ assetIds: z.array(text(200)).min(1) }).passthrough().safeParse(snapshot.payload);
  if (!parsed.success || new Set(parsed.data.assetIds).size !== parsed.data.assetIds.length) throw new Error("CONTENT_MEDIA_SET_REVISION_INVALID");
  const digest = mediaSetMembershipDigest({ mediaSetId: snapshot.recordId, revision: snapshot.revision, orderedAssetIds: parsed.data.assetIds });
  if (digest !== input.reference.digest) throw new Error("CONTENT_MEDIA_SET_REVISION_STALE");
  return { ...input.reference, orderedAssetIds: parsed.data.assetIds };
}

export function resolveThemeRevision(input: {
  reference: ThemeRevisionRef;
  row: { workspaceId: string; themeId: string; revision: number; state: string; document: unknown; documentDigest: string; licenseEvidenceIds: unknown; licenseExpiresAt: Date | null } | null;
  workspaceId: string;
  now?: Date;
}): ResolvedThemeRevision {
  const row = input.row;
  if (!row || row.workspaceId !== input.workspaceId || row.themeId !== input.reference.themeId || row.revision !== input.reference.revision || row.state !== "active") throw new Error("CONTENT_THEME_REVISION_INVALID");
  if (row.documentDigest !== input.reference.digest || canonicalDigest(row.document) !== row.documentDigest) throw new Error("CONTENT_THEME_REVISION_STALE");
  if (row.licenseExpiresAt && row.licenseExpiresAt <= (input.now ?? new Date())) throw new Error("CONTENT_THEME_LICENSE_EXPIRED");
  const document = contentThemeDocumentSchema.parse(row.document);
  const licenseEvidenceIds = z.array(text(200)).min(1).parse(row.licenseEvidenceIds);
  return { ...input.reference, document, licenseEvidenceIds };
}

export function compileThemeInstructions(themes: ResolvedThemeRevision[]) {
  return themes.map((theme) => ({
    themeId: theme.themeId,
    revision: theme.revision,
    digest: theme.digest,
    visual: theme.document.visual,
    captions: theme.document.captions,
    licenseEvidenceIds: theme.licenseEvidenceIds,
  }));
}

export function orderedContentAssetIds(directAssetIds: string[], mediaSets: ResolvedMediaSetRevision[]): string[] {
  return [...new Set([...directAssetIds, ...mediaSets.flatMap((set) => set.orderedAssetIds)])];
}
