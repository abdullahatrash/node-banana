import { Readable } from "node:stream";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { assets, brandProfiles } from "@/lib/db/schema";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { admitStudioGeneration } from "@/lib/model-routing/admitted-generation-service";
import { findCuratedModel } from "@/lib/model-routing/catalog";
import { inspirationRightsSnapshots, modelTextOutputReceipts } from "@/lib/model-routing/db-schema";
import { hydrateRightsSnapshot, validateRightsEvidence } from "@/lib/model-routing/rights-evidence";
import { finalizeAssetUpload, getAsset, recordPendingS3AssetWithQuota } from "@/lib/studio/repository";
import { getObjectStreamFromS3, streamUploadToS3 } from "@/lib/storage";
import { CreativeError, type Composition, type StructuredCopy } from "./contracts";
import { validateComposition, validateCopyForRequest } from "./composition";
import { PostgresCreativeSessionStore } from "./repository";
import { renderCreativeFrame, renderCreativeVideo } from "./render";
import { CreativeGenerationService, type CreativeActor, type CreativeGenerationPorts } from "./service";

export const CREATIVE_STORE = new PostgresCreativeSessionStore();
const ports: CreativeGenerationPorts = {
  store: CREATIVE_STORE,
  resolveModel: findCuratedModel,
  async loadBrand(request) {
    const [row] = await getDb().select().from(brandProfiles).where(and(eq(brandProfiles.workspaceId, request.workspaceId), eq(brandProfiles.id, request.brand.profileId), eq(brandProfiles.revision, request.brand.revision))).limit(1);
    if (!row?.acceptedAt || row.status !== "active" && row.status !== "superseded") throw new CreativeError("creative.errors.brandStale");
    return { workspaceId: row.workspaceId, profileId: row.id, revision: row.revision, acceptedAt: row.acceptedAt.toISOString(), profile: row.profile };
  },
  async validateSourcesAndRights(request) {
    const [row] = await getDb().select().from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, request.workspaceId), eq(inspirationRightsSnapshots.id, request.rights.snapshotId), eq(inspirationRightsSnapshots.revision, request.rights.revision))).limit(1);
    if (!row || row.digest !== request.rights.digest || row.basis !== request.rights.basis || row.permittedRemix !== request.rights.permittedRemix) throw new CreativeError("creative.errors.rightsStale");
    const rights = hydrateRightsSnapshot(row.snapshot);
    const sourceIds = request.sourceAssets.map((asset) => asset.assetId);
    if (canonicalDigest(sourceIds) !== canonicalDigest(rights.sourceAssetIds) || canonicalDigest([...request.rights.evidenceIds].sort()) !== canonicalDigest(rights.evidence.map((item) => item.id).sort()) || !validateRightsEvidence({ workspaceId: request.workspaceId, basis: rights.basis, permittedRemix: rights.permittedRemix, sourceAssetIds: sourceIds, evidence: rights.evidence, at: new Date() }).ok) throw new CreativeError("creative.errors.rightsStale");
    const sources = sourceIds.length ? await getDb().select().from(assets).where(and(eq(assets.workspaceId, request.workspaceId), inArray(assets.id, sourceIds), isNull(assets.deletedAt))) : [];
    if (sources.length !== sourceIds.length || request.sourceAssets.some((source) => sources.find((asset) => asset.id === source.assetId)?.checksum !== source.digest)) throw new CreativeError("creative.errors.sourceBinding");
  },
  admit: admitStudioGeneration,
  async observe(workspaceId, stage) {
    const operation = await PRODUCTION_OPERATION_STATUS.get(workspaceId, stage.operationId);
    if (!operation || operation.resourceId !== stage.intentId) throw new CreativeError("creative.errors.operationPending");
    const value = { state: operation.state, metadata: operation.metadata };
    if (operation.state !== "succeeded") return value;
    if (stage.stage === "copy") {
      const [receipt] = await getDb().select().from(modelTextOutputReceipts).where(and(eq(modelTextOutputReceipts.workspaceId, workspaceId), eq(modelTextOutputReceipts.intentId, stage.intentId))).limit(1);
      return { ...value, ...(receipt ? { text: receipt.content } : {}) };
    }
    const ids = operation.metadata.artifactIds;
    if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string") throw new CreativeError("creative.errors.sourceBinding");
    const asset = await getAsset(workspaceId, ids[0]);
    const metadata = asset?.metadata as Record<string, unknown> | null;
    if (!asset?.checksum || metadata?.generationIntentId !== stage.intentId || metadata.uploadState !== "ready") throw new CreativeError("creative.errors.sourceBinding");
    return { ...value, plate: { assetId: asset.id, digest: asset.checksum, intentId: stage.intentId } };
  },
  async cancel(actor, stage, idempotencyKey) {
    const operation = await PRODUCTION_OPERATION_STATUS.get(actor.workspaceId, stage.operationId);
    if (!operation) throw new CreativeError("creative.errors.operationPending");
    if (!(operation.actor.type === "human" && operation.actor.userId === actor.userId) && actor.role !== "owner" && actor.role !== "admin") throw new CreativeError("creative.errors.forbidden");
    return PRODUCTION_OPERATION_STATUS.requestCancellation({ workspaceId: actor.workspaceId, operationId: operation.id, expectedRevision: operation.revision, actor: { type: "human", userId: actor.userId }, idempotencyKey });
  },
  inspector: { async inspect(input) {
    const endpoint = process.env.CREATIVE_PLATE_INSPECTOR_URL; const token = process.env.CREATIVE_PLATE_INSPECTOR_TOKEN;
    if (!endpoint || !token || new URL(endpoint).protocol !== "https:") return null;
    const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ schema: "creative-plate-inspection-request/v1", ...input }), signal: AbortSignal.timeout(30_000), redirect: "error", cache: "no-store" });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 128_000) return null;
    const text = await response.text(); if (Buffer.byteLength(text) > 128_000) return null;
    return JSON.parse(text);
  } },
};
export const CREATIVE_GENERATION = new CreativeGenerationService(ports);

export async function renderStoredCreative(actor: CreativeActor, id: string, input: { expectedRevision: number; idempotencyKey: string; mode: "preview" | "export"; draft?: { copy: StructuredCopy; composition: Composition }; signal?: AbortSignal }) {
  const session = await CREATIVE_STORE.get(actor.workspaceId, id);
  if (!session) throw new CreativeError("creative.errors.notFound");
  if (session.revision !== input.expectedRevision) throw new CreativeError("creative.errors.revisionConflict");
  if (session.cancellationRequestedAt) throw new CreativeError("creative.errors.cancelled");
  const copy = input.mode === "preview" && input.draft ? validateCopyForRequest(input.draft.copy, session.request) : session.copy;
  const layout = input.mode === "preview" && input.draft ? input.draft.composition : session.composition;
  if (!copy || !layout || !session.plate) throw new CreativeError("creative.errors.renderRequired");
  const composition = validateComposition(layout, copy);
  if (composition.plate.assetId !== session.plate.assetId || composition.plate.digest !== session.plate.digest || canonicalDigest(composition.canvas) !== canonicalDigest(session.request.output)) throw new CreativeError("creative.errors.sourceBinding");
  if (input.mode === "export" && (session.copyApproval?.digest !== canonicalDigest(copy) || session.visualReview?.decision !== "accepted")) throw new CreativeError("creative.errors.visualReviewRequired");
  const asset = await getAsset(actor.workspaceId, session.plate.assetId);
  if (!asset?.storageKey || asset.checksum !== session.plate.digest) throw new CreativeError("creative.errors.sourceBinding");
  const object = await getObjectStreamFromS3({ key: asset.storageKey });
  if (object.contentLength > 500 * 1024 * 1024) throw new CreativeError("creative.errors.sourceBinding");
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of object.body) { length += chunk.byteLength; if (length > object.contentLength) throw new CreativeError("creative.errors.sourceBinding"); chunks.push(Buffer.from(chunk)); }
  if (length !== object.contentLength) throw new CreativeError("creative.errors.sourceBinding");
  const plate = Buffer.concat(chunks);
  const result = composition.canvas.format === "video" ? await renderCreativeVideo({ composition, copy, plate, signal: input.signal }) : await renderCreativeFrame({ composition, copy, plate });
  if (input.mode === "preview") return { kind: "preview" as const, ...result };
  // Validate all pinned source rights again at export; acceptance of a plate
  // never extends expired/revoked source licenses.
  await ports.validateSourcesAndRights(session.request);
  const suffix = result.receipt.output.mimeType === "video/mp4" ? "mp4" : "png";
  const storageKey = `${actor.workspaceId}/creative/${id}/${result.receipt.output.digest.slice(7)}.${suffix}`;
  const metadata = { creativeSessionId: id, creativeSessionRevision: session.revision, creativeCompositionDigest: result.receipt.compositionDigest, creativeReviewRequired: true, generationIntentIds: session.stages.map((stage) => stage.intentId), sourceAssetIds: [...session.request.sourceAssets.map((source) => source.assetId), session.plate.assetId], brandProfileId: session.request.brand.profileId, brandRevision: session.request.brand.revision, rightsSnapshotId: session.request.rights.snapshotId, rightsSnapshotRevision: session.request.rights.revision, contentLanguage: session.request.contentLanguage, arabicVariety: session.request.arabicVariety, creativeCopy: copy, creativeComposition: composition, creativeRenderReceipt: result.receipt };
  const output = await recordPendingS3AssetWithQuota({ workspaceId: actor.workspaceId, userId: actor.userId, type: session.request.output.format, storageKey, expectedSizeBytes: result.buffer.length, mimeType: result.receipt.output.mimeType, metadata });
  if ((output.metadata as Record<string, unknown> | null)?.uploadState !== "ready") {
    await streamUploadToS3({ key: storageKey, body: Readable.from(result.buffer), contentType: result.receipt.output.mimeType, contentLength: result.buffer.length });
    await finalizeAssetUpload({ workspaceId: actor.workspaceId, assetId: output.id, uploadState: "ready", sizeBytes: result.buffer.length, checksum: result.receipt.output.digest, mimeType: result.receipt.output.mimeType, width: composition.canvas.width, height: composition.canvas.height, durationSeconds: composition.canvas.durationMs === null ? null : composition.canvas.durationMs / 1000, metadata });
  }
  const updated = await CREATIVE_STORE.mutate({ workspaceId: actor.workspaceId, id, userId: actor.userId, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey, requestDigest: canonicalDigest({ action: "export", id, compositionDigest: result.receipt.compositionDigest, expectedRevision: input.expectedRevision }) }, (current) => {
    if (current.cancellationRequestedAt) throw new CreativeError("creative.errors.cancelled");
    return { ...current, output: { assetId: output.id, digest: result.receipt.output.digest, receipt: result.receipt }, publicationReview: null };
  });
  return { kind: "export" as const, session: updated };
}
