import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { getDb } from "@/lib/db";
import {
  assets,
  brandSources,
  contentWorkflowRevisions,
  savedPrompts,
  socialAccounts,
  socialPosts,
} from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";

export const GOVERNANCE_PORTABLE_KINDS = [
  "media",
  "content_revision",
  "prompt",
  "brand_source",
  "calendar_plan",
  "platform_export_metadata",
] as const;
export type GovernancePortableKind = (typeof GOVERNANCE_PORTABLE_KINDS)[number];

const id = z.string().min(1).max(500);
const timestamp = z.string().datetime({ offset: true }).nullable();
const schemas = {
  media: z.object({ schema: z.literal("portable-media/v1"), id, type: id, storageProvider: id, storageBucket: z.string().nullable(), storageKey: id, mimeType: z.string().nullable(), sizeBytes: z.number().int().nonnegative().nullable(), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(), durationSeconds: z.number().int().nonnegative().nullable(), checksum: z.string().nullable(), metadata: z.record(z.string(), z.unknown()).nullable(), createdAt: z.string().datetime({ offset: true }) }).strict(),
  content_revision: z.object({ schema: z.literal("portable-content-revision/v1"), id, workflowId: id, revision: z.number().int().positive(), definitionDigest: id, definition: z.record(z.string(), z.unknown()), operationRegistryDigest: id, createdAt: z.string().datetime({ offset: true }) }).strict(),
  prompt: z.object({ schema: z.literal("portable-prompt/v1"), id, mode: z.enum(["photo", "video", "copy"]), name: z.string().min(1), promptText: z.string(), formConfig: z.record(z.string(), z.unknown()), isPublic: z.boolean(), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }) }).strict(),
  brand_source: z.object({ schema: z.literal("portable-brand-source/v1"), id, revision: z.number().int().positive(), kind: z.enum(["website", "description"]), submittedUrl: z.string().nullable(), finalUrl: z.string().nullable(), submittedDescription: z.string().nullable(), cleanedText: z.string().nullable(), contentHash: z.string().nullable(), sourceLanguage: z.string().nullable(), extractedBytes: z.number().int().nonnegative().nullable(), fetchedAt: timestamp, createdAt: z.string().datetime({ offset: true }) }).strict(),
  calendar_plan: z.object({ schema: z.literal("portable-calendar-plan/v1"), id, sourceChannelId: id, status: z.enum(["draft", "queued", "publishing", "published", "failed"]), kind: id, content: z.string().nullable(), media: z.array(z.object({ type: z.string(), url: z.string(), alt: z.string().optional() }).strict()), platformSettings: z.record(z.string(), z.unknown()), scheduledAt: timestamp, createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }) }).strict(),
  platform_export_metadata: z.object({ schema: z.literal("portable-platform-export-metadata/v1"), id, platform: id, sourceChannelId: id, platformPostId: z.string().nullable(), platformPostUrl: z.string().nullable(), publishedAt: timestamp, createdAt: z.string().datetime({ offset: true }) }).strict(),
} satisfies Record<GovernancePortableKind, z.ZodType>;

export interface GovernancePortableItem {
  kind: GovernancePortableKind;
  sourceId: string;
  digest: string;
  payload: Record<string, unknown>;
}

export type GovernancePortableMaterializeResult =
  | { kind: "created" | "matched"; destinationId: string }
  | { kind: "conflict" | "invalid" | "unavailable"; reason: string };

export interface GovernancePortableDataPort {
  list(input: { workspaceId: string; kinds: GovernancePortableKind[] }): Promise<GovernancePortableItem[]>;
  materialize(input: {
    workspaceId: string;
    requestedByUserId: string;
    kind: GovernancePortableKind;
    sourceId: string;
    destinationId: string;
    digest: string;
    payload: Record<string, unknown>;
    provenance: { source: string; sourceManifestDigest: string };
    idempotencyKey: string;
  }): Promise<GovernancePortableMaterializeResult>;
}

export function validatePortablePayload(kind: GovernancePortableKind, payload: unknown) {
  const parsed = schemas[kind].safeParse(payload);
  return parsed.success ? parsed.data as Record<string, unknown> : null;
}

type Db = ReturnType<typeof getDb>;

/** Reads the real canonical Workspace stores; secret-bearing columns are never selected. */
export class DrizzleGovernancePortableDataPort implements GovernancePortableDataPort {
  constructor(private readonly database: () => Db) {}

  async list(input: { workspaceId: string; kinds: GovernancePortableKind[] }) {
    const requested = new Set(input.kinds);
    const db = this.database();
    const [mediaRows, revisionRows, promptRows, brandRows, postRows] = await Promise.all([
      requested.has("media") ? db.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), isNull(assets.deletedAt))) : [],
      requested.has("content_revision") ? db.select().from(contentWorkflowRevisions).where(eq(contentWorkflowRevisions.workspaceId, input.workspaceId)) : [],
      requested.has("prompt") ? db.select().from(savedPrompts).where(and(eq(savedPrompts.workspaceId, input.workspaceId), isNull(savedPrompts.deletedAt))) : [],
      requested.has("brand_source") ? db.select().from(brandSources).where(eq(brandSources.workspaceId, input.workspaceId)) : [],
      requested.has("calendar_plan") || requested.has("platform_export_metadata")
        ? db.select({ post: socialPosts, platform: socialAccounts.platform }).from(socialPosts)
          .innerJoin(socialAccounts, and(eq(socialAccounts.workspaceId, socialPosts.workspaceId), eq(socialAccounts.id, socialPosts.socialAccountId)))
          .where(and(eq(socialPosts.workspaceId, input.workspaceId), requested.has("platform_export_metadata") && !requested.has("calendar_plan") ? isNotNull(socialPosts.publishedAt) : undefined))
        : [],
    ]);
    const raw: Array<{ kind: GovernancePortableKind; sourceId: string; payload: Record<string, unknown> }> = [];
    if (requested.has("media")) for (const row of mediaRows) raw.push({ kind: "media", sourceId: row.id, payload: { schema: "portable-media/v1", id: row.id, type: row.type, storageProvider: row.storageProvider, storageBucket: row.storageBucket, storageKey: row.storageKey, mimeType: row.mimeType, sizeBytes: row.sizeBytes, width: row.width, height: row.height, durationSeconds: row.durationSeconds, checksum: row.checksum, metadata: row.metadata, createdAt: row.createdAt.toISOString() } });
    if (requested.has("content_revision")) for (const row of revisionRows) raw.push({ kind: "content_revision", sourceId: row.id, payload: { schema: "portable-content-revision/v1", id: row.id, workflowId: row.workflowId, revision: row.revision, definitionDigest: row.definitionDigest, definition: row.definition as unknown as Record<string, unknown>, operationRegistryDigest: row.operationRegistryDigest, createdAt: row.createdAt.toISOString() } });
    if (requested.has("prompt")) for (const row of promptRows) raw.push({ kind: "prompt", sourceId: row.id, payload: { schema: "portable-prompt/v1", id: row.id, mode: row.mode, name: row.name, promptText: row.promptText, formConfig: row.formConfig, isPublic: row.isPublic, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } });
    if (requested.has("brand_source")) for (const row of brandRows) raw.push({ kind: "brand_source", sourceId: row.id, payload: { schema: "portable-brand-source/v1", id: row.id, revision: row.revision, kind: row.kind, submittedUrl: row.submittedUrl, finalUrl: row.finalUrl, submittedDescription: row.submittedDescription, cleanedText: row.cleanedText, contentHash: row.contentHash, sourceLanguage: row.sourceLanguage, extractedBytes: row.extractedBytes, fetchedAt: row.fetchedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() } });
    if (requested.has("calendar_plan")) for (const { post } of postRows) raw.push({ kind: "calendar_plan", sourceId: post.id, payload: { schema: "portable-calendar-plan/v1", id: post.id, sourceChannelId: post.socialAccountId, status: post.status, kind: post.kind, content: post.content, media: post.mediaUrls ?? [], platformSettings: post.platformSettings ?? {}, scheduledAt: post.scheduledAt?.toISOString() ?? null, createdAt: post.createdAt.toISOString(), updatedAt: post.updatedAt.toISOString() } });
    if (requested.has("platform_export_metadata")) for (const { post, platform } of postRows.filter(({ post }) => post.publishedAt)) raw.push({ kind: "platform_export_metadata", sourceId: post.id, payload: { schema: "portable-platform-export-metadata/v1", id: post.id, platform, sourceChannelId: post.socialAccountId, platformPostId: post.platformPostId, platformPostUrl: post.platformPostUrl, publishedAt: post.publishedAt?.toISOString() ?? null, createdAt: post.createdAt.toISOString() } });
    return raw.flatMap((item) => {
      const payload = validatePortablePayload(item.kind, item.payload);
      return payload ? [{ ...item, payload, digest: canonicalDigest(payload) }] : [];
    });
  }

  async materialize(): Promise<GovernancePortableMaterializeResult> {
    // Each destination subsystem requires its own exact remapping authority
    // (storage copy, Agent provenance, Channel mapping). Never synthesize it.
    return { kind: "unavailable", reason: "DESTINATION_ADAPTER_REQUIRED" };
  }
}
