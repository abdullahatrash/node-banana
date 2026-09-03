import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { getDb } from "@/lib/db";
import {
  assets,
  agentAuthorizationDecisions,
  agentKeys,
  agentPrincipals,
  brandSources,
  contentWorkflows,
  contentWorkflowRevisions,
  savedPrompts,
  socialAccounts,
  socialPosts,
  workspacePortableImportRecords,
} from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { copyObjectInS3 } from "@/lib/storage/s3";

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
  media: z.object({ schema: z.literal("portable-media/v1"), id, type: z.enum(["image", "video", "audio", "model3d", "workflow"]), storageProvider: z.enum(["local", "s3", "r2"]), storageBucket: z.string().nullable(), storageKey: id, mimeType: z.string().nullable(), sizeBytes: z.number().int().nonnegative().nullable(), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(), durationSeconds: z.number().int().nonnegative().nullable(), checksum: z.string().nullable(), metadata: z.record(z.string(), z.unknown()).nullable(), createdAt: z.string().datetime({ offset: true }) }).strict(),
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
  | { kind: "waiting_user"; reason: string; requiredMappings: string[] }
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
    mapping?: Record<string, string>;
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

  async materialize(input: Parameters<GovernancePortableDataPort["materialize"]>[0]): Promise<GovernancePortableMaterializeResult> {
    const payload = validatePortablePayload(input.kind, input.payload);
    if (!payload || canonicalDigest(payload) !== input.digest) return { kind: "invalid", reason: "PORTABLE_PAYLOAD_DIGEST_MISMATCH" };
    const db = this.database();
    const prior = await db.select().from(workspacePortableImportRecords).where(and(
      eq(workspacePortableImportRecords.workspaceId, input.workspaceId),
      eq(workspacePortableImportRecords.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (prior[0]) {
      if (prior[0].sourceDigest !== input.digest || prior[0].kind !== input.kind) return { kind: "conflict", reason: "IDEMPOTENCY_KEY_REUSED" };
      return { kind: "matched", destinationId: prior[0].destinationId };
    }

    const result = await this.materializeCanonical(input, payload);
    if (result.kind !== "created" && result.kind !== "matched") return result;
    await db.insert(workspacePortableImportRecords).values({
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      source: input.provenance.source,
      sourceManifestDigest: input.provenance.sourceManifestDigest,
      sourceId: input.sourceId,
      sourceDigest: input.digest,
      destinationId: result.destinationId,
      payload,
      mapping: input.mapping ?? {},
      disposition: input.kind === "platform_export_metadata" ? "archived" : result.kind,
      requestedByUserId: input.requestedByUserId,
      createdAt: new Date(),
    }).onConflictDoNothing();
    return result;
  }

  private async materializeCanonical(
    input: Parameters<GovernancePortableDataPort["materialize"]>[0],
    payload: Record<string, unknown>,
  ): Promise<GovernancePortableMaterializeResult> {
    switch (input.kind) {
      case "prompt": return this.materializePrompt(input, payload as z.infer<typeof schemas.prompt>);
      case "brand_source": return this.materializeBrandSource(input, payload as z.infer<typeof schemas.brand_source>);
      case "media": return this.materializeMedia(input, payload as z.infer<typeof schemas.media>);
      case "calendar_plan": return this.materializeCalendarPlan(input, payload as z.infer<typeof schemas.calendar_plan>);
      case "content_revision": return this.materializeContentRevision(input, payload as z.infer<typeof schemas.content_revision>);
      case "platform_export_metadata":
        // Remote posts are evidence, not credentials or publishing authority. The
        // provenance ledger is their canonical imported archive.
        return { kind: "created", destinationId: input.destinationId };
    }
  }

  private async materializePrompt(input: Parameters<GovernancePortableDataPort["materialize"]>[0], payload: z.infer<typeof schemas.prompt>) {
    const db = this.database();
    const existing = await db.select().from(savedPrompts).where(eq(savedPrompts.id, input.destinationId)).limit(1);
    if (existing[0]) {
      const row = existing[0];
      const matches = row.workspaceId === input.workspaceId && row.mode === payload.mode && row.name === payload.name && row.promptText === payload.promptText && canonicalDigest(row.formConfig) === canonicalDigest(payload.formConfig) && row.isPublic === false && row.createdAt.toISOString() === payload.createdAt && row.updatedAt.toISOString() === payload.updatedAt;
      return matches ? { kind: "matched" as const, destinationId: row.id } : { kind: "conflict" as const, reason: "PROMPT_DESTINATION_CONFLICT" };
    }
    await db.insert(savedPrompts).values({ id: input.destinationId, workspaceId: input.workspaceId, mode: payload.mode, name: payload.name, promptText: payload.promptText, formConfig: payload.formConfig, isPublic: false, createdAt: new Date(payload.createdAt), updatedAt: new Date(payload.updatedAt) });
    return { kind: "created" as const, destinationId: input.destinationId };
  }

  private async materializeBrandSource(input: Parameters<GovernancePortableDataPort["materialize"]>[0], payload: z.infer<typeof schemas.brand_source>) {
    const db = this.database();
    const existing = await db.select().from(brandSources).where(eq(brandSources.id, input.destinationId)).limit(1);
    if (existing[0]) return existing[0].workspaceId === input.workspaceId && existing[0].kind === payload.kind && existing[0].submittedUrl === payload.submittedUrl && existing[0].submittedDescription === payload.submittedDescription && existing[0].contentHash === payload.contentHash
      ? { kind: "matched" as const, destinationId: existing[0].id }
      : { kind: "conflict" as const, reason: "BRAND_SOURCE_DESTINATION_CONFLICT" };
    const requestedRevision = input.mapping?.destinationRevision;
    const revision = requestedRevision ? Number(requestedRevision) : payload.revision;
    if (!Number.isInteger(revision) || revision < 1) return { kind: "invalid" as const, reason: "INVALID_DESTINATION_REVISION" };
    const collision = await db.select({ id: brandSources.id }).from(brandSources).where(and(eq(brandSources.workspaceId, input.workspaceId), eq(brandSources.revision, revision))).limit(1);
    if (collision[0]) return { kind: "waiting_user" as const, reason: "BRAND_REVISION_MAPPING_REQUIRED", requiredMappings: ["destinationRevision"] };
    await db.insert(brandSources).values({ id: input.destinationId, workspaceId: input.workspaceId, revision, kind: payload.kind, submittedUrl: payload.submittedUrl, finalUrl: payload.finalUrl, submittedDescription: payload.submittedDescription, cleanedText: payload.cleanedText, contentHash: payload.contentHash, sourceLanguage: payload.sourceLanguage, extractedBytes: payload.extractedBytes, fetchedAt: payload.fetchedAt ? new Date(payload.fetchedAt) : null, createdByUserId: input.requestedByUserId, createdAt: new Date(payload.createdAt) });
    return { kind: "created" as const, destinationId: input.destinationId };
  }

  private async materializeMedia(input: Parameters<GovernancePortableDataPort["materialize"]>[0], payload: z.infer<typeof schemas.media>) {
    const db = this.database();
    const existing = await db.select().from(assets).where(eq(assets.id, input.destinationId)).limit(1);
    if (existing[0]) {
      const provenance = existing[0].metadata?.importProvenance as Record<string, unknown> | undefined;
      return existing[0].workspaceId === input.workspaceId && provenance?.sourceManifestDigest === input.provenance.sourceManifestDigest && provenance?.sourceId === input.sourceId
      ? { kind: "matched" as const, destinationId: existing[0].id }
      : { kind: "conflict" as const, reason: "MEDIA_DESTINATION_CONFLICT" };
    }
    const configuredBucket = process.env.S3_BUCKET_NAME;
    const sourceWorkspaceId = workspaceIdentityFromExportSource(input.provenance.source)?.workspaceId ?? null;
    const destinationUploadedAssetId = input.mapping?.destinationUploadedAssetId;
    if (!sourceWorkspaceId) {
      if (!destinationUploadedAssetId) {
        return { kind: "waiting_user" as const, reason: "DESTINATION_MEDIA_UPLOAD_REQUIRED", requiredMappings: ["destinationUploadedAssetId"] };
      }
      const uploaded = await db.select().from(assets).where(and(
        eq(assets.workspaceId, input.workspaceId),
        eq(assets.id, destinationUploadedAssetId),
        isNull(assets.deletedAt),
      )).limit(1);
      if (!uploaded[0] || (payload.checksum && uploaded[0].checksum !== payload.checksum)) {
        return { kind: "invalid" as const, reason: "DESTINATION_MEDIA_UPLOAD_MISMATCH" };
      }
      return { kind: "matched" as const, destinationId: uploaded[0].id };
    }
    const sourceRows = await db.select().from(assets).where(and(
      eq(assets.workspaceId, sourceWorkspaceId),
      eq(assets.id, input.sourceId),
      isNull(assets.deletedAt),
    )).limit(1);
    const source = sourceRows[0];
    const signedSourceMatches = source
      && source.storageProvider === payload.storageProvider
      && source.storageBucket === payload.storageBucket
      && source.storageKey === payload.storageKey
      && source.checksum === payload.checksum;
    if (!signedSourceMatches) return { kind: "invalid" as const, reason: "SIGNED_SOURCE_MEDIA_PROVENANCE_MISMATCH" };
    const sourceKey = source.storageProvider === "s3" && configuredBucket
      && (!source.storageBucket || source.storageBucket === configuredBucket)
      ? source.storageKey
      : null;
    if (!sourceKey) return { kind: "unavailable" as const, reason: "SOURCE_STORAGE_ROUTE_UNAVAILABLE" };
    if (!configuredBucket) return { kind: "unavailable" as const, reason: "DESTINATION_STORAGE_NOT_CONFIGURED" };
    if (!safeStorageKey(sourceKey)) return { kind: "invalid" as const, reason: "INVALID_SOURCE_STORAGE_KEY" };
    const destinationKey = input.mapping?.destinationStorageKey ?? `workspace-imports/${input.workspaceId}/${input.digest.slice(7, 39)}/${fileName(payload.storageKey)}`;
    if (!safeStorageKey(destinationKey)) return { kind: "invalid" as const, reason: "INVALID_DESTINATION_STORAGE_KEY" };
    await copyObjectInS3({ sourceKey, destinationKey });
    await db.insert(assets).values({ id: input.destinationId, workspaceId: input.workspaceId, projectId: null, type: payload.type, storageProvider: "s3", storageBucket: configuredBucket, storageKey: destinationKey, mimeType: payload.mimeType, sizeBytes: payload.sizeBytes, width: payload.width, height: payload.height, durationSeconds: payload.durationSeconds, checksum: payload.checksum, metadata: { ...(payload.metadata ?? {}), importProvenance: { source: input.provenance.source, sourceId: input.sourceId, sourceManifestDigest: input.provenance.sourceManifestDigest } }, createdByUserId: input.requestedByUserId, createdAt: new Date(payload.createdAt), updatedAt: new Date(payload.createdAt) });
    return { kind: "created" as const, destinationId: input.destinationId };
  }

  private async materializeCalendarPlan(input: Parameters<GovernancePortableDataPort["materialize"]>[0], payload: z.infer<typeof schemas.calendar_plan>) {
    const destinationChannelId = input.mapping?.destinationChannelId;
    if (!destinationChannelId) return { kind: "waiting_user" as const, reason: "DESTINATION_CHANNEL_MAPPING_REQUIRED", requiredMappings: ["destinationChannelId"] };
    const db = this.database();
    const channel = await db.select().from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.id, destinationChannelId))).limit(1);
    if (!channel[0] || channel[0].disabled || channel[0].requiresReauth) return { kind: "invalid" as const, reason: "DESTINATION_CHANNEL_UNAVAILABLE" };
    const existing = await db.select().from(socialPosts).where(eq(socialPosts.id, input.destinationId)).limit(1);
    if (existing[0]) return existing[0].workspaceId === input.workspaceId && existing[0].triggerSource === `workspace-import:${input.digest}`
      ? { kind: "matched" as const, destinationId: existing[0].id }
      : { kind: "conflict" as const, reason: "CALENDAR_PLAN_DESTINATION_CONFLICT" };
    await db.insert(socialPosts).values({ id: input.destinationId, workspaceId: input.workspaceId, socialAccountId: destinationChannelId, status: "draft", kind: payload.kind, content: payload.content, mediaUrls: payload.media, platformSettings: payload.platformSettings, scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt) : null, triggerSource: `workspace-import:${input.digest}`, createdByUserId: input.requestedByUserId, createdAt: new Date(payload.createdAt), updatedAt: new Date(payload.updatedAt) });
    return { kind: "created" as const, destinationId: input.destinationId };
  }

  private async materializeContentRevision(input: Parameters<GovernancePortableDataPort["materialize"]>[0], payload: z.infer<typeof schemas.content_revision>) {
    const principalId = input.mapping?.destinationPrincipalId;
    const keyId = input.mapping?.destinationKeyId;
    const evidenceRef = input.mapping?.authorizationEvidenceRef;
    const requiredMappings = ["destinationPrincipalId", "destinationKeyId", "authorizationEvidenceRef"].filter((key) => !input.mapping?.[key]);
    if (requiredMappings.length) return { kind: "waiting_user" as const, reason: "CONTENT_AUTHOR_MAPPING_REQUIRED", requiredMappings };
    if ((payload.definition as { workflowId?: unknown }).workflowId !== payload.workflowId) return { kind: "invalid" as const, reason: "CONTENT_DEFINITION_IDENTITY_MISMATCH" };
    const db = this.database();
    const [principal] = await db.select().from(agentPrincipals).where(and(eq(agentPrincipals.workspaceId, input.workspaceId), eq(agentPrincipals.id, principalId!))).limit(1);
    const [key] = await db.select().from(agentKeys).where(and(eq(agentKeys.principalId, principalId!), eq(agentKeys.id, keyId!))).limit(1);
    const [authorization] = await db.select().from(agentAuthorizationDecisions).where(and(
      eq(agentAuthorizationDecisions.workspaceId, input.workspaceId),
      eq(agentAuthorizationDecisions.principalId, principalId!),
      eq(agentAuthorizationDecisions.keyId, keyId!),
      eq(agentAuthorizationDecisions.operatorTraceRef, evidenceRef!),
      eq(agentAuthorizationDecisions.capabilityName, "workflows.create"),
      eq(agentAuthorizationDecisions.capabilityVersion, 1),
      eq(agentAuthorizationDecisions.outcome, "allowed"),
    )).limit(1);
    const now = new Date();
    const exactResource = authorization?.resources.some((resource) => resource.kind === "workflow" && resource.id === payload.workflowId);
    if (!principal || principal.status !== "active" || !key || key.revokedAt || (key.expiresAt && key.expiresAt <= now) || !authorization || !exactResource) return { kind: "invalid" as const, reason: "CONTENT_AUTHOR_MAPPING_UNAUTHORIZED" };
    const existingRevision = await db.select().from(contentWorkflowRevisions).where(and(eq(contentWorkflowRevisions.workspaceId, input.workspaceId), eq(contentWorkflowRevisions.id, input.destinationId))).limit(1);
    if (existingRevision[0]) return existingRevision[0].definitionDigest === payload.definitionDigest
      ? { kind: "matched" as const, destinationId: existingRevision[0].id }
      : { kind: "conflict" as const, reason: "CONTENT_REVISION_DESTINATION_CONFLICT" };
    const revisionCollision = await db.select({ id: contentWorkflowRevisions.id }).from(contentWorkflowRevisions).where(and(eq(contentWorkflowRevisions.workspaceId, input.workspaceId), eq(contentWorkflowRevisions.workflowId, payload.workflowId), eq(contentWorkflowRevisions.revision, payload.revision))).limit(1);
    if (revisionCollision[0]) return { kind: "conflict" as const, reason: "CONTENT_WORKFLOW_REVISION_CONFLICT" };
    await db.transaction(async (tx) => {
      await tx.insert(contentWorkflows).values({ workspaceId: input.workspaceId, id: payload.workflowId, currentRevision: 0, createdByPrincipalId: principalId!, createdByKeyId: keyId!, authorizationEvidenceRef: evidenceRef!, createdAt: new Date(payload.createdAt), updatedAt: new Date(payload.createdAt) }).onConflictDoNothing();
      await tx.insert(contentWorkflowRevisions).values({ workspaceId: input.workspaceId, id: input.destinationId, workflowId: payload.workflowId, revision: payload.revision, definitionDigest: payload.definitionDigest, definition: payload.definition as never, operationRegistryDigest: payload.operationRegistryDigest, authorPrincipalId: principalId!, authorKeyId: keyId!, authorizationEvidenceRef: evidenceRef!, createdAt: new Date(payload.createdAt) });
      await tx.update(contentWorkflows).set({ currentRevision: sql`greatest(${contentWorkflows.currentRevision}, ${payload.revision})`, updatedAt: now }).where(and(eq(contentWorkflows.workspaceId, input.workspaceId), eq(contentWorkflows.id, payload.workflowId)));
    });
    return { kind: "created" as const, destinationId: input.destinationId };
  }
}

/** Only first-party Workspace exports may authorize a server-side object copy. */
export function workspaceIdFromExportSource(source: string): string | null {
  return workspaceIdentityFromExportSource(source)?.workspaceId ?? null;
}

export function workspaceIdentityFromExportSource(source: string): { workspaceId: string; exportId: string | null } | null {
  const match = /^workspace-export:([A-Za-z0-9][A-Za-z0-9_-]{0,199})(?::([A-Za-z0-9][A-Za-z0-9_-]{0,199}))?$/.exec(source);
  return match ? { workspaceId: match[1], exportId: match[2] ?? null } : null;
}

function safeStorageKey(value: string): boolean {
  return value.length > 0 && value.length <= 1_024 && !value.startsWith("/") && !value.includes("..") && !/^https?:\/\//i.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
}

function fileName(storageKey: string): string {
  const candidate = storageKey.split("/").at(-1)?.replace(/[^A-Za-z0-9._-]/g, "_");
  return candidate && candidate.length <= 180 ? candidate : "asset.bin";
}
