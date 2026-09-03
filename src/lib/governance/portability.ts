import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { getDb } from "@/lib/db";
import {
  assets,
  artifactContents,
  artifacts,
  agentAuthorizationDecisions,
  agentKeys,
  agentPrincipals,
  brandSources,
  contentWorkflows,
  contentWorkflowRevisions,
  savedPrompts,
  socialAccounts,
  socialEvents,
  socialPosts,
  workspacePortableImportRecords,
} from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { copyObjectInS3 } from "@/lib/storage/s3";
import { GOVERNANCE_REGION_ROUTES, requireGovernanceRegionRoute } from "./region-enforcement";

export const GOVERNANCE_PORTABLE_KINDS = [
  "media",
  "content_revision",
  "prompt",
  "brand_source",
  "calendar_plan",
  "caption",
  "platform_observation",
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
  calendar_plan: z.object({ schema: z.literal("portable-calendar-plan/v2"), id, sourceChannelId: id, status: z.enum(["draft", "queued", "publishing", "published", "failed"]), kind: id, content: z.string().nullable(), stableMediaRefs: z.array(z.object({ type: z.enum(["image", "video", "audio", "model3d", "workflow"]), sourceKind: z.enum(["studio_asset", "artifact"]).optional(), sourceAssetId: id, assetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), order: z.number().int().nonnegative(), alt: z.string().max(2_000).optional() }).strict()).superRefine((refs, context) => {
    const orders = refs.map((ref) => ref.order);
    if (new Set(orders).size !== orders.length || orders.some((order, index) => order !== index)) context.addIssue({ code: "custom", message: "Calendar media order must be unique, contiguous, and zero-based." });
    if (new Set(refs.map((ref) => ref.sourceAssetId)).size !== refs.length) context.addIssue({ code: "custom", message: "Each calendar asset may appear only once." });
  }), platformSettings: z.record(z.string(), z.unknown()), scheduledAt: timestamp, createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }) }).strict(),
  caption: z.object({ schema: z.literal("portable-caption/v1"), id, sourcePostId: id, text: z.string().min(1), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }) }).strict(),
  platform_observation: z.object({ schema: z.literal("portable-platform-observation/v1"), id, eventType: z.enum(["post.queued", "post.publishing", "post.published", "post.failed", "account.reauth_required", "token.refreshed", "dispatch.failed"]), severity: z.enum(["info", "warn", "error"]), userFacing: z.boolean(), sourcePostId: z.string().nullable(), sourceChannelId: z.string().nullable(), provider: z.enum(["x", "linkedin", "facebook", "instagram", "tiktok", "youtube", "reddit", "threads", "pinterest", "bluesky", "mastodon"]).nullable(), createdAt: z.string().datetime({ offset: true }) }).strict(),
  platform_export_metadata: z.object({ schema: z.literal("portable-platform-export-metadata/v1"), id, platform: id, sourceChannelId: id, platformPostId: z.string().nullable(), platformPostUrl: z.string().nullable(), publishedAt: timestamp, createdAt: z.string().datetime({ offset: true }) }).strict(),
} satisfies Record<GovernancePortableKind, z.ZodType>;

export interface GovernancePortableItem {
  kind: GovernancePortableKind;
  sourceId: string;
  digest: string;
  payload: Record<string, unknown>;
}

export interface GovernanceImportRegionRoutePin {
  kind: "primary_storage";
  routeId: "storage:workspace-import";
  configuredRegion: string;
  policyApplied: boolean;
  evidenceDigest: string | null;
  admittedAt: string;
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
    regionRoute: GovernanceImportRegionRoutePin;
    mapping?: Record<string, string>;
  }): Promise<GovernancePortableMaterializeResult>;
}

export async function copyPortableMediaIntoPrimaryStorage(
  input: { workspaceId: string; sourceKey: string; destinationKey: string; configuredRegion: string | undefined },
  dependencies: {
    admit: typeof requireGovernanceRegionRoute;
    copy: typeof copyObjectInS3;
  } = { admit: requireGovernanceRegionRoute, copy: copyObjectInS3 },
): Promise<void> {
  await dependencies.admit({
    workspaceId: input.workspaceId,
    route: GOVERNANCE_REGION_ROUTES.assetStorage,
    configuredRegion: input.configuredRegion,
  });
  await dependencies.copy({ sourceKey: input.sourceKey, destinationKey: input.destinationKey });
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
    const [mediaRows, artifactMediaRows, revisionRows, promptRows, brandRows, postRows, calendarAssetRows, observationRows] = await Promise.all([
      requested.has("media") ? db.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), isNull(assets.deletedAt))) : [],
      requested.has("media") || requested.has("calendar_plan") ? db.select({ artifact: artifacts, content: artifactContents }).from(artifacts).innerJoin(artifactContents, and(eq(artifactContents.workspaceId, artifacts.workspaceId), eq(artifactContents.digest, artifacts.contentDigest))).where(and(eq(artifacts.workspaceId, input.workspaceId), eq(artifactContents.kind, "image"), isNull(artifacts.deletedAt))) : [],
      requested.has("content_revision") ? db.select().from(contentWorkflowRevisions).where(eq(contentWorkflowRevisions.workspaceId, input.workspaceId)) : [],
      requested.has("prompt") ? db.select().from(savedPrompts).where(and(eq(savedPrompts.workspaceId, input.workspaceId), isNull(savedPrompts.deletedAt))) : [],
      requested.has("brand_source") ? db.select().from(brandSources).where(eq(brandSources.workspaceId, input.workspaceId)) : [],
      requested.has("calendar_plan") || requested.has("caption") || requested.has("platform_export_metadata")
        ? db.select({ post: socialPosts, platform: socialAccounts.platform }).from(socialPosts)
          .innerJoin(socialAccounts, and(eq(socialAccounts.workspaceId, socialPosts.workspaceId), eq(socialAccounts.id, socialPosts.socialAccountId)))
          .where(and(eq(socialPosts.workspaceId, input.workspaceId), requested.has("platform_export_metadata") && !requested.has("calendar_plan") ? isNotNull(socialPosts.publishedAt) : undefined))
        : [],
      requested.has("calendar_plan") ? db.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), isNull(assets.deletedAt))) : [],
      requested.has("platform_observation") ? db.select({ id: socialEvents.id, eventType: socialEvents.eventType, severity: socialEvents.severity, userFacing: socialEvents.userFacing, postId: socialEvents.postId, accountId: socialEvents.accountId, provider: socialEvents.provider, createdAt: socialEvents.createdAt }).from(socialEvents).where(eq(socialEvents.workspaceId, input.workspaceId)) : [],
    ]);
    const calendarAssets = new Map<string, CalendarMediaResource>();
    for (const asset of calendarAssetRows) calendarAssets.set(`studio_asset:${asset.id}`, { ...asset, resourceKind: "studio_asset" });
    for (const { artifact, content } of artifactMediaRows) calendarAssets.set(`artifact:${artifact.id}`, { id: artifact.id, resourceKind: "artifact", type: "image", storageKey: content.storageKey ?? "", mimeType: content.mediaType, sizeBytes: content.sizeBytes, width: content.width, height: content.height, durationSeconds: null, checksum: content.digest });
    const raw: Array<{ kind: GovernancePortableKind; sourceId: string; payload: Record<string, unknown> }> = [];
    if (requested.has("media")) for (const row of mediaRows) raw.push({ kind: "media", sourceId: row.id, payload: { schema: "portable-media/v1", id: row.id, type: row.type, storageProvider: row.storageProvider, storageBucket: row.storageBucket, storageKey: row.storageKey, mimeType: row.mimeType, sizeBytes: row.sizeBytes, width: row.width, height: row.height, durationSeconds: row.durationSeconds, checksum: row.checksum, metadata: row.metadata, createdAt: row.createdAt.toISOString() } });
    if (requested.has("media")) for (const { artifact, content } of artifactMediaRows) raw.push({ kind: "media", sourceId: artifact.id, payload: { schema: "portable-media/v1", id: artifact.id, type: "image", storageProvider: "s3", storageBucket: process.env.S3_BUCKET_NAME ?? null, storageKey: content.storageKey!, mimeType: content.mediaType, sizeBytes: content.sizeBytes, width: content.width, height: content.height, durationSeconds: null, checksum: content.digest, metadata: { sourceKind: "artifact", origin: artifact.origin }, createdAt: artifact.createdAt.toISOString() } });
    if (requested.has("content_revision")) for (const row of revisionRows) raw.push({ kind: "content_revision", sourceId: row.id, payload: { schema: "portable-content-revision/v1", id: row.id, workflowId: row.workflowId, revision: row.revision, definitionDigest: row.definitionDigest, definition: row.definition as unknown as Record<string, unknown>, operationRegistryDigest: row.operationRegistryDigest, createdAt: row.createdAt.toISOString() } });
    if (requested.has("prompt")) for (const row of promptRows) raw.push({ kind: "prompt", sourceId: row.id, payload: { schema: "portable-prompt/v1", id: row.id, mode: row.mode, name: row.name, promptText: row.promptText, formConfig: row.formConfig, isPublic: row.isPublic, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() } });
    if (requested.has("brand_source")) for (const row of brandRows) raw.push({ kind: "brand_source", sourceId: row.id, payload: { schema: "portable-brand-source/v1", id: row.id, revision: row.revision, kind: row.kind, submittedUrl: row.submittedUrl, finalUrl: row.finalUrl, submittedDescription: row.submittedDescription, cleanedText: row.cleanedText, contentHash: row.contentHash, sourceLanguage: row.sourceLanguage, extractedBytes: row.extractedBytes, fetchedAt: row.fetchedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() } });
    if (requested.has("calendar_plan")) for (const { post } of postRows) {
      const stableMediaRefs = buildPortableCalendarStableMediaRefs({ postId: post.id, stableMediaRefs: post.stableMediaRefs, studioAssetId: post.studioAssetId, legacyMediaUrls: post.mediaUrls ?? [], assetsById: calendarAssets });
      if (post.stableMediaRefs.length === 0 && stableMediaRefs.length > 0) {
        await db.update(socialPosts).set({ stableMediaRefs: stableMediaRefs.map((reference) => ({ resourceKind: reference.sourceKind, assetId: reference.sourceAssetId, assetDigest: reference.assetDigest, order: reference.order, ...(reference.alt ? { alt: reference.alt } : {}) })), studioAssetId: stableMediaRefs.find((reference) => reference.sourceKind === "studio_asset")?.sourceAssetId ?? null, updatedAt: post.updatedAt }).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, post.id), sql`jsonb_array_length(${socialPosts.stableMediaRefs}) = 0`));
      }
      raw.push({ kind: "calendar_plan", sourceId: post.id, payload: { schema: "portable-calendar-plan/v2", id: post.id, sourceChannelId: post.socialAccountId, status: post.status, kind: post.kind, content: post.content, stableMediaRefs, platformSettings: post.platformSettings ?? {}, scheduledAt: post.scheduledAt?.toISOString() ?? null, createdAt: post.createdAt.toISOString(), updatedAt: post.updatedAt.toISOString() } });
    }
    if (requested.has("caption")) for (const { post } of postRows.filter(({ post }) => Boolean(post.content))) raw.push({ kind: "caption", sourceId: post.id, payload: { schema: "portable-caption/v1", id: `caption:${post.id}`, sourcePostId: post.id, text: post.content!, createdAt: post.createdAt.toISOString(), updatedAt: post.updatedAt.toISOString() } });
    if (requested.has("platform_observation")) for (const row of observationRows) raw.push({ kind: "platform_observation", sourceId: row.id, payload: { schema: "portable-platform-observation/v1", id: row.id, eventType: row.eventType, severity: row.severity, userFacing: row.userFacing, sourcePostId: row.postId, sourceChannelId: row.accountId, provider: row.provider, createdAt: row.createdAt.toISOString() } });
    if (requested.has("platform_export_metadata")) for (const { post, platform } of postRows.filter(({ post }) => post.publishedAt)) raw.push({ kind: "platform_export_metadata", sourceId: post.id, payload: { schema: "portable-platform-export-metadata/v1", id: post.id, platform, sourceChannelId: post.socialAccountId, platformPostId: post.platformPostId, platformPostUrl: post.platformPostUrl, publishedAt: post.publishedAt?.toISOString() ?? null, createdAt: post.createdAt.toISOString() } });
    return raw.flatMap((item) => {
      const payload = validatePortablePayload(item.kind, item.payload);
      return payload ? [{ ...item, payload, digest: canonicalDigest(payload) }] : [];
    });
  }

  async materialize(input: Parameters<GovernancePortableDataPort["materialize"]>[0]): Promise<GovernancePortableMaterializeResult> {
    if (
      input.regionRoute.kind !== "primary_storage" ||
      input.regionRoute.routeId !== GOVERNANCE_REGION_ROUTES.workspaceImportStorage.routeId ||
      !input.regionRoute.configuredRegion ||
      !Number.isFinite(new Date(input.regionRoute.admittedAt).getTime())
    ) return { kind: "invalid", reason: "IMPORT_REGION_ROUTE_PIN_INVALID" };
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
      mapping: {
        ...(input.mapping ?? {}),
        _regionRouteKind: input.regionRoute.kind,
        _regionRouteId: input.regionRoute.routeId,
        _region: input.regionRoute.configuredRegion,
        _regionPolicyApplied: String(input.regionRoute.policyApplied),
        ...(input.regionRoute.evidenceDigest ? { _regionEvidenceDigest: input.regionRoute.evidenceDigest } : {}),
        _regionAdmittedAt: input.regionRoute.admittedAt,
      },
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
      case "caption": return this.materializeCaption(input, payload as z.infer<typeof schemas.caption>);
      case "platform_observation": return this.materializePlatformObservation(input, payload as z.infer<typeof schemas.platform_observation>);
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
    await copyPortableMediaIntoPrimaryStorage({
      workspaceId: input.workspaceId,
      sourceKey,
      destinationKey,
      configuredRegion: process.env.S3_REGION ?? process.env.APP_DATA_REGION,
    });
    await db.insert(assets).values({ id: input.destinationId, workspaceId: input.workspaceId, projectId: null, type: payload.type, storageProvider: "s3", storageBucket: configuredBucket, storageKey: destinationKey, mimeType: payload.mimeType, sizeBytes: payload.sizeBytes, width: payload.width, height: payload.height, durationSeconds: payload.durationSeconds, checksum: payload.checksum, metadata: { ...(payload.metadata ?? {}), importProvenance: { source: input.provenance.source, sourceId: input.sourceId, sourceManifestDigest: input.provenance.sourceManifestDigest } }, createdByUserId: input.requestedByUserId, createdAt: new Date(payload.createdAt), updatedAt: new Date(payload.createdAt) });
    return { kind: "created" as const, destinationId: input.destinationId };
  }

  private async materializeCalendarPlan(input: Parameters<GovernancePortableDataPort["materialize"]>[0], payload: z.infer<typeof schemas.calendar_plan>) {
    const destinationChannelId = input.mapping?.destinationChannelId;
    const assetMappingKeys = payload.stableMediaRefs.map((_, index) => `destinationAssetId${index}`);
    const requiredMappings = ["destinationChannelId", ...assetMappingKeys].filter((key) => !input.mapping?.[key]);
    if (requiredMappings.length) return { kind: "waiting_user" as const, reason: "DESTINATION_CALENDAR_MAPPING_REQUIRED", requiredMappings };
    const db = this.database();
    const channel = await db.select().from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.id, destinationChannelId!))).limit(1);
    if (!channel[0] || channel[0].disabled || channel[0].requiresReauth) return { kind: "invalid" as const, reason: "DESTINATION_CHANNEL_UNAVAILABLE" };
    const existing = await db.select().from(socialPosts).where(eq(socialPosts.id, input.destinationId)).limit(1);
    if (existing[0]) return existing[0].workspaceId === input.workspaceId && existing[0].triggerSource === `workspace-import:${input.digest}`
      ? { kind: "matched" as const, destinationId: existing[0].id }
      : { kind: "conflict" as const, reason: "CALENDAR_PLAN_DESTINATION_CONFLICT" };
    const destinationAssets = [];
    for (let index = 0; index < payload.stableMediaRefs.length; index += 1) {
      const reference = payload.stableMediaRefs[index];
      const destinationAssetId = input.mapping![assetMappingKeys[index]];
      const [destinationAsset] = await db.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, destinationAssetId), isNull(assets.deletedAt))).limit(1);
      if (!destinationAsset || portableAssetDigest(destinationAsset) !== reference.assetDigest) return { kind: "invalid" as const, reason: "DESTINATION_ASSET_MAPPING_MISMATCH" };
      destinationAssets.push(destinationAsset);
    }
    const stableMediaRefs = destinationAssets.map((asset, index) => ({
      resourceKind: "studio_asset" as const,
      assetId: asset.id,
      assetDigest: payload.stableMediaRefs[index].assetDigest,
      order: index,
      ...(payload.stableMediaRefs[index].alt ? { alt: payload.stableMediaRefs[index].alt } : {}),
    }));
    await db.insert(socialPosts).values({ id: input.destinationId, workspaceId: input.workspaceId, socialAccountId: destinationChannelId!, status: "draft", kind: payload.kind, content: payload.content, mediaUrls: null, stableMediaRefs, studioAssetId: destinationAssets[0]?.id ?? null, platformSettings: payload.platformSettings, scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt) : null, triggerSource: `workspace-import:${input.digest}`, createdByUserId: input.requestedByUserId, createdAt: new Date(payload.createdAt), updatedAt: new Date(payload.updatedAt) });
    return { kind: "created" as const, destinationId: input.destinationId };
  }

  private async materializeCaption(input: Parameters<GovernancePortableDataPort["materialize"]>[0], payload: z.infer<typeof schemas.caption>) {
    const destinationPostId = input.mapping?.destinationPostId;
    if (!destinationPostId) return { kind: "waiting_user" as const, reason: "DESTINATION_POST_MAPPING_REQUIRED", requiredMappings: ["destinationPostId"] };
    const db = this.database();
    const [post] = await db.select().from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, destinationPostId))).limit(1);
    if (!post || post.status !== "draft") return { kind: "invalid" as const, reason: "DESTINATION_POST_NOT_EDITABLE" };
    if (post.content === payload.text && post.triggerSource === `workspace-import-caption:${input.digest}`) return { kind: "matched" as const, destinationId: post.id };
    if (post.content) return { kind: "conflict" as const, reason: "DESTINATION_CAPTION_CONFLICT" };
    await db.update(socialPosts).set({ content: payload.text, triggerSource: `workspace-import-caption:${input.digest}`, updatedAt: new Date(payload.updatedAt) }).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, destinationPostId)));
    return { kind: "created" as const, destinationId: post.id };
  }

  private async materializePlatformObservation(input: Parameters<GovernancePortableDataPort["materialize"]>[0], payload: z.infer<typeof schemas.platform_observation>) {
    const db = this.database();
    const [existing] = await db.select({ id: socialEvents.id, workspaceId: socialEvents.workspaceId, metadata: socialEvents.metadata }).from(socialEvents).where(eq(socialEvents.id, input.destinationId)).limit(1);
    if (existing) return existing.workspaceId === input.workspaceId && (existing.metadata as { importDigest?: string } | null)?.importDigest === input.digest
      ? { kind: "matched" as const, destinationId: existing.id }
      : { kind: "conflict" as const, reason: "PLATFORM_OBSERVATION_DESTINATION_CONFLICT" };
    const destinationPostId = input.mapping?.destinationPostId ?? null;
    const destinationChannelId = input.mapping?.destinationChannelId ?? null;
    if (destinationPostId && !(await db.select({ id: socialPosts.id }).from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, destinationPostId))).limit(1))[0]) return { kind: "invalid" as const, reason: "DESTINATION_POST_UNAVAILABLE" };
    if (destinationChannelId && !(await db.select({ id: socialAccounts.id }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.id, destinationChannelId))).limit(1))[0]) return { kind: "invalid" as const, reason: "DESTINATION_CHANNEL_UNAVAILABLE" };
    await db.insert(socialEvents).values({ id: input.destinationId, workspaceId: input.workspaceId, eventType: payload.eventType, severity: payload.severity, message: "Imported platform observation", userFacing: payload.userFacing, postId: destinationPostId, accountId: destinationChannelId, provider: payload.provider, metadata: { importDigest: input.digest, source: input.provenance.source, sourceId: input.sourceId, sourceManifestDigest: input.provenance.sourceManifestDigest }, createdByUserId: input.requestedByUserId, createdAt: new Date(payload.createdAt) });
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

function portableAssetDigest(input: { type: string; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; durationSeconds: number | null; checksum: string | null }): string {
  if (input.checksum && /^sha256:[a-f0-9]{64}$/.test(input.checksum)) return input.checksum;
  return canonicalDigest({ type: input.type, mimeType: input.mimeType, sizeBytes: input.sizeBytes, width: input.width, height: input.height, durationSeconds: input.durationSeconds });
}

type CalendarMediaResource = {
  id: string;
  resourceKind: "studio_asset" | "artifact";
  type: "image" | "video" | "audio" | "model3d" | "workflow";
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  checksum: string | null;
};

function storageKeyMatchesUrl(storageKey: string, url: string): boolean {
  if (storageKey === url) return true;
  try {
    return decodeURIComponent(new URL(url).pathname).endsWith(`/${storageKey}`);
  } catch {
    return false;
  }
}

export function buildPortableCalendarStableMediaRefs(input: {
  postId: string;
  stableMediaRefs: Array<{ resourceKind?: "studio_asset" | "artifact"; assetId: string; assetDigest: string; order: number; alt?: string }>;
  studioAssetId: string | null;
  legacyMediaUrls: Array<{ type: string; url: string; alt?: string }>;
  assetsById: ReadonlyMap<string, CalendarMediaResource>;
}) {
  const mediaResources = [...input.assetsById.values()];
  const derived = input.legacyMediaUrls.map((media, order) => {
    const explicitId = input.legacyMediaUrls.length === 1 ? input.studioAssetId : null;
    const candidates = mediaResources.filter((resource) => (explicitId ? resource.id === explicitId : storageKeyMatchesUrl(resource.storageKey, media.url)) && resource.type === media.type);
    if (candidates.length !== 1) throw new Error(`CALENDAR_MEDIA_RELATION_NOT_BACKFILLED:${input.postId}:${order}`);
    const candidate = candidates[0];
    return { resourceKind: candidate.resourceKind, assetId: candidate.id, assetDigest: "", order, ...(media.alt ? { alt: media.alt } : {}) };
  });
  const persisted = input.stableMediaRefs.length > 0
    ? [...input.stableMediaRefs].sort((left, right) => left.order - right.order)
    : derived;
  return persisted.map((reference, order) => {
    const resourceKind = reference.resourceKind ?? "studio_asset";
    const asset = input.assetsById.get(`${resourceKind}:${reference.assetId}`);
    if (!asset) throw new Error(`CALENDAR_ASSET_NOT_FOUND:${input.postId}:${reference.assetId}`);
    const assetDigest = portableAssetDigest(asset);
    if (reference.assetDigest && reference.assetDigest !== assetDigest) throw new Error(`CALENDAR_ASSET_DIGEST_MISMATCH:${input.postId}:${reference.assetId}`);
    return { type: asset.type, sourceKind: asset.resourceKind, sourceAssetId: asset.id, assetDigest, order, ...(reference.alt ? { alt: reference.alt } : {}) };
  });
}
