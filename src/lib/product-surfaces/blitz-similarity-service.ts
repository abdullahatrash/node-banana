import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { assets, blitzSimilarityEvidence, workspaceProductRecords } from "@/lib/db/schema";
import { createPresignedDownload } from "@/lib/storage";
import { blitzPayloadSchema } from "./definitions";
import { buildBlitzSimilarityGate, validateBlitzSimilarityGate, type BlitzSimilarityGateEvidence, type BlitzSimilarityMediaType } from "./blitz-similarity-policy";
import { productionBlitzSimilarityEvaluator, type BlitzSimilarityEvaluator } from "./blitz-similarity-evaluator";

export class BlitzSimilarityServiceError extends Error { constructor(readonly code: string) { super(code); } }

type AssetRow = typeof assets.$inferSelect;
type Dependencies = { evaluator: BlitzSimilarityEvaluator; sign: (asset: AssetRow) => Promise<string>; now: () => Date; id: () => string };
const productionDependencies = (): Dependencies => ({
  evaluator: productionBlitzSimilarityEvaluator(), now: () => new Date(), id: randomUUID,
  sign: async (asset) => {
    if (asset.storageProvider !== "s3" || !asset.storageKey) throw new BlitzSimilarityServiceError("BLITZ_SIMILARITY_ASSET_UNAVAILABLE");
    return (await createPresignedDownload({ key: asset.storageKey, expiresInSeconds: 300 })).downloadUrl;
  },
});

function ready(asset: AssetRow | undefined): asset is AssetRow { return Boolean(asset?.checksum && /^sha256:[a-f0-9]{64}$/.test(asset.checksum) && (asset.metadata as Record<string, unknown> | null)?.uploadState === "ready" && !asset.deletedAt); }
function mediaType(asset: Pick<AssetRow, "type">): BlitzSimilarityMediaType {
  if (asset.type !== "image" && asset.type !== "video" && asset.type !== "audio") throw new BlitzSimilarityServiceError("BLITZ_SIMILARITY_ASSET_UNAVAILABLE");
  return asset.type;
}
function assetIdentity(asset: Pick<AssetRow, "id" | "checksum" | "type">) {
  return { id: asset.id, contentDigest: asset.checksum as `sha256:${string}`, mediaType: mediaType(asset) };
}

export async function evaluateAndStoreBlitzSimilarity(input: { workspaceId: string; itemId: string; expectedRevision: number; candidateAssetId: string }, dependencies: Dependencies = productionDependencies()) {
  const db = getDb();
  const [[item], [candidate]] = await Promise.all([
    db.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.itemId), eq(workspaceProductRecords.kind, "blitz_item"), isNull(workspaceProductRecords.archivedAt))).limit(1),
    db.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.candidateAssetId), isNull(assets.deletedAt))).limit(1),
  ]);
  if (!item || item.state !== "queued" || item.revision !== input.expectedRevision) throw new BlitzSimilarityServiceError("BLITZ_ITEM_STALE");
  const payload = blitzPayloadSchema.parse(item.payload); if (!payload.sourceAssetId) throw new BlitzSimilarityServiceError("BLITZ_SOURCE_REQUIRED");
  const [source] = await db.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, payload.sourceAssetId), isNull(assets.deletedAt))).limit(1);
  if (!ready(source) || !ready(candidate)) throw new BlitzSimilarityServiceError("BLITZ_SIMILARITY_ASSET_UNAVAILABLE");
  const [existing] = await db.select().from(blitzSimilarityEvidence).where(and(eq(blitzSimilarityEvidence.workspaceId, input.workspaceId), eq(blitzSimilarityEvidence.blitzItemId, input.itemId), eq(blitzSimilarityEvidence.blitzItemRevision, input.expectedRevision), eq(blitzSimilarityEvidence.candidateAssetId, input.candidateAssetId))).limit(1);
  if (existing) {
    const evidence = existing.evidence as unknown as BlitzSimilarityGateEvidence;
    const validation = validateBlitzSimilarityGate({ evidence, sourceAsset: assetIdentity(source), candidateAsset: assetIdentity(candidate) });
    if (!validation.ok && validation.code !== "BLITZ_SIMILARITY_BLOCKED") throw new BlitzSimilarityServiceError(validation.code);
    return { evidenceId: existing.id, evidence };
  }
  const [sourceUrl, candidateUrl] = await Promise.all([dependencies.sign(source), dependencies.sign(candidate)]);
  const evaluated = await dependencies.evaluator.evaluate({ source: { assetId: source.id, contentDigest: source.checksum as `sha256:${string}`, mediaType: mediaType(source), downloadUrl: sourceUrl }, candidate: { assetId: candidate.id, contentDigest: candidate.checksum as `sha256:${string}`, mediaType: mediaType(candidate), downloadUrl: candidateUrl } });
  const evidence = buildBlitzSimilarityGate({ sourceAsset: assetIdentity(source), candidateAsset: assetIdentity(candidate), measurements: evaluated.measurements, evaluatedAt: dependencies.now(), evaluator: { kind: "qualified_internal", adapterId: evaluated.evaluator.id, adapterVersion: evaluated.evaluator.version, qualificationDigest: evaluated.evaluator.qualificationDigest } });
  return db.transaction(async (tx) => {
    const [[current], [currentSource], [currentCandidate]] = await Promise.all([
      tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.itemId), eq(workspaceProductRecords.kind, "blitz_item"))).limit(1),
      tx.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, source.id), isNull(assets.deletedAt))).limit(1),
      tx.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, candidate.id), isNull(assets.deletedAt))).limit(1),
    ]);
    if (!current || current.state !== "queued" || current.revision !== input.expectedRevision || !ready(currentSource) || !ready(currentCandidate)) throw new BlitzSimilarityServiceError("BLITZ_ITEM_STALE");
    const validation = validateBlitzSimilarityGate({ evidence, sourceAsset: assetIdentity(currentSource), candidateAsset: assetIdentity(currentCandidate) });
    if (!validation.ok && validation.code !== "BLITZ_SIMILARITY_BLOCKED") throw new BlitzSimilarityServiceError(validation.code);
    const id = dependencies.id();
    const inserted = await tx.insert(blitzSimilarityEvidence).values({ workspaceId: input.workspaceId, id, blitzItemId: input.itemId, blitzItemRevision: input.expectedRevision, sourceAssetId: source.id, candidateAssetId: candidate.id, status: evidence.status, evaluatorId: evidence.evaluator.adapterId, evaluatorVersion: evidence.evaluator.adapterVersion, evidence: evidence as unknown as Record<string, unknown>, evidenceDigest: evidence.digest, evaluatedAt: new Date(evidence.evaluatedAt), createdAt: dependencies.now() }).onConflictDoNothing().returning({ id: blitzSimilarityEvidence.id });
    if (inserted.length) return { evidenceId: id, evidence };
    const [winner] = await tx.select().from(blitzSimilarityEvidence).where(and(eq(blitzSimilarityEvidence.workspaceId, input.workspaceId), eq(blitzSimilarityEvidence.blitzItemId, input.itemId), eq(blitzSimilarityEvidence.blitzItemRevision, input.expectedRevision), eq(blitzSimilarityEvidence.candidateAssetId, input.candidateAssetId))).limit(1);
    if (!winner || winner.evidenceDigest !== evidence.digest) throw new BlitzSimilarityServiceError("BLITZ_SIMILARITY_EVIDENCE_CONFLICT");
    return { evidenceId: winner.id, evidence: winner.evidence as unknown as BlitzSimilarityGateEvidence };
  });
}

export async function requirePassedBlitzSimilarityEvidence(executor: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], input: { workspaceId: string; evidenceId: string; itemId: string; itemRevision: number; sourceAssetId: string; sourceDigest: string; sourceMediaType: BlitzSimilarityMediaType; candidateAssetId: string; candidateDigest: string; candidateMediaType: BlitzSimilarityMediaType }) {
  const [row] = await executor.select().from(blitzSimilarityEvidence).where(and(eq(blitzSimilarityEvidence.workspaceId, input.workspaceId), eq(blitzSimilarityEvidence.id, input.evidenceId), eq(blitzSimilarityEvidence.blitzItemId, input.itemId), eq(blitzSimilarityEvidence.blitzItemRevision, input.itemRevision), eq(blitzSimilarityEvidence.sourceAssetId, input.sourceAssetId), eq(blitzSimilarityEvidence.candidateAssetId, input.candidateAssetId))).limit(1);
  const validation = validateBlitzSimilarityGate({ evidence: row?.evidence as unknown as BlitzSimilarityGateEvidence ?? null, sourceAsset: { id: input.sourceAssetId, contentDigest: input.sourceDigest as `sha256:${string}`, mediaType: input.sourceMediaType }, candidateAsset: { id: input.candidateAssetId, contentDigest: input.candidateDigest as `sha256:${string}`, mediaType: input.candidateMediaType } });
  if (!row || row.status !== "passed" || !validation.ok) throw new BlitzSimilarityServiceError(validation.ok ? "BLITZ_SIMILARITY_REQUIRED" : validation.code);
  return row;
}
