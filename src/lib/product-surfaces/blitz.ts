import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { assets, workspaceProductCommandReceipts, workspaceProductRecordRevisions, workspaceProductRecords } from "@/lib/db/schema";
import { runtimeOperations } from "@/lib/agent-runtime/operation-status/db-schema";
import { generationIntents, modelArtifactIngestionReceipts } from "@/lib/model-routing/db-schema";
import { isAdmittedBlitzArtifact, isAdmittedMetadataBlitzArtifact } from "./blitz-lineage";
import { brandAwareRemixBriefSchema, blitzPayloadSchema, parseProductPayload } from "./definitions";
import { validateReadyPortraitAsset, type ContentAssetEvidence } from "./content-lineage";
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "./repository";
import { requirePassedBlitzSimilarityEvidence } from "./blitz-similarity-service";
import { resolveActiveContentFormatDefinition } from "./content-format-registry";
import { buildQualifiedContentRenderProof, productionContentRenderProofVerifier } from "./content-render-proof";
import { createPresignedDownload } from "@/lib/storage";

export async function decideBlitzItem(input: { workspaceId: string; userId: string; itemId: string; expectedRevision: number; decision: "accepted" | "rejected"; reasons: Array<{ code: "not_relevant" | "brand_mismatch" | "stale_source" | "rights_unclear" | "too_similar" | "wrong_format" | "other"; note: string }>; generation: { assetId: string; intentId: string; operationId: string } | null; similarityEvidenceId: string | null; idempotencyKey: string; now?: Date }) {
  const now = input.now ?? new Date();
  const digest = canonicalDigest({ itemId: input.itemId, expectedRevision: input.expectedRevision, decision: input.decision, reasons: input.reasons, generation: input.generation, similarityEvidenceId: input.similarityEvidenceId });
  return getDb().transaction(async (tx) => {
    const [receipt] = await tx.select().from(workspaceProductCommandReceipts).where(and(eq(workspaceProductCommandReceipts.workspaceId, input.workspaceId), eq(workspaceProductCommandReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
    if (receipt) {
      if (receipt.requestDigest !== digest) throw new ProductRecordIdempotencyError("Idempotency key was already used.");
      return { itemId: receipt.recordId, revision: receipt.resultRevision };
    }
    const [item] = await tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.itemId), eq(workspaceProductRecords.kind, "blitz_item"))).limit(1);
    if (!item || item.revision !== input.expectedRevision || item.state !== "queued") throw new ProductRecordConflictError("Blitz item is no longer queued. Refresh and try again.");
    const payload = blitzPayloadSchema.parse(item.payload);
    let contentPieceId: string | null = null;
    if (input.decision === "accepted") {
      const metadataOnly = payload.sourceUsage === "metadata_topic_only";
      if (!input.generation || !payload.contentLanguage || !payload.format || (metadataOnly ? Boolean(input.similarityEvidenceId || payload.sourceAssetId || payload.sourceMediaType || payload.rightsSnapshot || payload.rightsBasis || payload.permittedRemix) : !input.similarityEvidenceId || !payload.sourceAssetId || !payload.sourceMediaType || !payload.rightsSnapshot || !payload.rightsBasis || !payload.permittedRemix)) throw new Error("BLITZ_GENERATION_REQUIRED");
      const sourcePromise = payload.sourceAssetId
        ? tx.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, payload.sourceAssetId))).limit(1)
        : Promise.resolve([] as Array<typeof assets.$inferSelect>);
      const [[receipt], [intentRow], [operation], [artifact], [sourceAsset]] = await Promise.all([
        tx.select().from(modelArtifactIngestionReceipts).where(and(eq(modelArtifactIngestionReceipts.workspaceId, input.workspaceId), eq(modelArtifactIngestionReceipts.assetId, input.generation.assetId), eq(modelArtifactIngestionReceipts.intentId, input.generation.intentId), eq(modelArtifactIngestionReceipts.status, "ready"))).limit(1),
        tx.select({ intent: generationIntents.intent }).from(generationIntents).where(and(eq(generationIntents.workspaceId, input.workspaceId), eq(generationIntents.id, input.generation.intentId))).limit(1),
        tx.select({ state: runtimeOperations.state, metadata: runtimeOperations.metadata }).from(runtimeOperations).where(and(eq(runtimeOperations.workspaceId, input.workspaceId), eq(runtimeOperations.id, input.generation.operationId), eq(runtimeOperations.resourceId, input.generation.intentId))).limit(1),
        tx.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.generation.assetId))).limit(1),
        sourcePromise,
      ]);
      const evidence = (row: typeof assets.$inferSelect): ContentAssetEvidence => ({ id: row.id, type: row.type, checksum: row.checksum, width: row.width, height: row.height, durationSeconds: row.durationSeconds, uploadState: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata.uploadState : null });
      const remixBrief = brandAwareRemixBriefSchema.safeParse(payload.remixBrief);
      const operationMetadata = operation?.metadata && typeof operation.metadata === "object" && !Array.isArray(operation.metadata) ? operation.metadata : {};
      const remixBriefDigest = remixBrief.success ? canonicalDigest({ preserve: remixBrief.data.provider.preserve, transform: remixBrief.data.provider.transform, avoid: remixBrief.data.provider.avoid }) : "";
      const receiptEvidence = receipt ? { assetId: receipt.assetId, intentId: receipt.intentId, status: receipt.status, contentDigest: receipt.contentDigest } : null;
      const operationEvidence = operation ? { state: operation.state, artifactIds: operationMetadata.artifactIds } : null;
      const lineageValid = metadataOnly
        ? isAdmittedMetadataBlitzArtifact({ remixBriefDigest, generation: input.generation, receipt: receiptEvidence, intent: intentRow?.intent ?? null, operation: operationEvidence, artifactExists: Boolean(artifact) })
        : Boolean(sourceAsset && payload.sourceAssetId && payload.rightsSnapshot && isAdmittedBlitzArtifact({ sourceAssetId: payload.sourceAssetId, rightsDigest: payload.rightsSnapshot.digest, remixBriefDigest, generation: input.generation, receipt: receiptEvidence, intent: intentRow?.intent ?? null, operation: operationEvidence, artifactExists: Boolean(artifact) }));
      if (!remixBrief.success || !artifact || validateReadyPortraitAsset(evidence(artifact), "video") || (!metadataOnly && (!sourceAsset || !payload.sourceMediaType || validateReadyPortraitAsset(evidence(sourceAsset), payload.sourceMediaType))) || !lineageValid) throw new Error("BLITZ_GENERATION_LINEAGE_INVALID");
      if (!metadataOnly) await requirePassedBlitzSimilarityEvidence(tx, { workspaceId: input.workspaceId, evidenceId: input.similarityEvidenceId!, itemId: input.itemId, itemRevision: input.expectedRevision, sourceAssetId: sourceAsset!.id, sourceDigest: sourceAsset!.checksum!, sourceMediaType: payload.sourceMediaType!, candidateAssetId: artifact.id, candidateDigest: artifact.checksum!, candidateMediaType: "video" });
      const resolvedFormatDefinition = await resolveActiveContentFormatDefinition(payload.format);
      const formatDefinition = resolvedFormatDefinition.reference;
      contentPieceId = randomUUID();
      if (artifact.storageProvider !== "s3" || !artifact.storageKey) throw new Error("CONTENT_RENDER_PROOF_UNAVAILABLE");
      const download = await createPresignedDownload({ key: artifact.storageKey, expiresInSeconds: 300 });
      const inspection = await productionContentRenderProofVerifier().inspect({ assetId: artifact.id, contentDigest: receipt.contentDigest as `sha256:${string}`, downloadUrl: download.downloadUrl, requirements: { aspectRatio: "9:16", minimumDurationSeconds: resolvedFormatDefinition.definition.duration.minimumSeconds, maximumDurationSeconds: resolvedFormatDefinition.definition.duration.maximumSeconds, captionsRequired: resolvedFormatDefinition.definition.captions.required, bidiRequired: resolvedFormatDefinition.definition.captions.bidiProofRequired, safeAreaPreset: resolvedFormatDefinition.definition.layout.safeAreaPreset } });
      const renderProof = buildQualifiedContentRenderProof({ definition: resolvedFormatDefinition.definition, definitionDigest: formatDefinition.digest as `sha256:${string}`, inputAssets: sourceAsset ? [{ assetId: sourceAsset.id, type: sourceAsset.type as "image" | "video", contentDigest: sourceAsset.checksum as `sha256:${string}` }] : [], output: { assetId: artifact.id, contentDigest: receipt.contentDigest as `sha256:${string}` }, intentId: input.generation.intentId, operationId: input.generation.operationId, contentLanguage: payload.contentLanguage, report: inspection.report, verifier: inspection.verifier, verifiedAt: now });
      const candidate = { assetId: input.generation.assetId, intentId: input.generation.intentId, operationId: input.generation.operationId, contentDigest: receipt.contentDigest, createdAt: now.toISOString(), renderProof };
      const contentPayload = parseProductPayload("content_piece", { format: payload.format, formatDefinition, contentLanguage: payload.contentLanguage, arabicVariety: payload.arabicVariety, prompt: remixBrief.data.provider.prompt, script: "", aspectRatio: "9:16", durationSeconds: Math.max(4, Math.min(60, Math.round(intentRow!.intent.outputContract.durationSeconds ?? 15))), captionStyle: "brand", sourceAssetIds: sourceAsset ? [sourceAsset.id] : [], personaId: null, candidateArtifactIds: [input.generation.assetId], candidates: [candidate], renderProofStatus: "passed", generatedText: null, generatedMedia: { assetId: input.generation.assetId, intentId: input.generation.intentId, operationId: input.generation.operationId, contentDigest: receipt.contentDigest } });
      await tx.insert(workspaceProductRecords).values({ workspaceId: input.workspaceId, id: contentPieceId, kind: "content_piece", title: item.title, state: "active", revision: 1, payload: contentPayload, createdByUserId: input.userId, updatedByUserId: input.userId, createdAt: now, updatedAt: now });
      await tx.insert(workspaceProductRecordRevisions).values({ workspaceId: input.workspaceId, recordId: contentPieceId, revision: 1, title: item.title, state: "active", payload: contentPayload, authorUserId: input.userId, createdAt: now });
    }
    const nextPayload = parseProductPayload("blitz_item", { ...payload, contentPieceId, rejectionReasons: input.decision === "rejected" ? input.reasons : [] });
    const [updated] = await tx.update(workspaceProductRecords).set({ state: input.decision, payload: nextPayload, revision: sql`${workspaceProductRecords.revision} + 1`, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.itemId), eq(workspaceProductRecords.revision, input.expectedRevision))).returning();
    if (!updated) throw new ProductRecordConflictError("Blitz item changed on another device.");
    await tx.insert(workspaceProductRecordRevisions).values({ workspaceId: input.workspaceId, recordId: input.itemId, revision: updated.revision, title: updated.title, state: updated.state, payload: nextPayload, authorUserId: input.userId, createdAt: now });
    await tx.insert(workspaceProductCommandReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: digest, recordId: input.itemId, resultRevision: updated.revision, createdAt: now });
    return { itemId: updated.id, revision: updated.revision, contentPieceId };
  });
}
