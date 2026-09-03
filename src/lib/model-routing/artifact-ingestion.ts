import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { buildAssetObjectKey, streamUploadToS3 } from "@/lib/storage";
import { finalizeAssetUpload, recordPendingS3AssetWithQuota } from "@/lib/studio/repository";
import { PostgresArtifactReceiptRepository, type ArtifactReceiptPort } from "./artifact-receipts";
import type { CanonicalArtifactIngestionPort } from "./replicate-contract";
import type { GenerationIntent } from "./types";

const MAX_BYTES = 500 * 1024 * 1024;
function outputUrls(output: unknown): string[] { const values = typeof output === "string" ? [output] : Array.isArray(output) ? output : []; return values.filter((value): value is string => typeof value === "string").slice(0, 8); }
function extension(contentType: string) { if (contentType.includes("webm")) return "webm"; if (contentType.includes("video")) return "mp4"; if (contentType.includes("jpeg")) return "jpg"; if (contentType.includes("webp")) return "webp"; return "png"; }
export function isAllowedArtifactUrl(value: string | URL, allowedHosts: string[]): boolean { try { const url = value instanceof URL ? value : new URL(value); return url.protocol === "https:" && allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)); } catch { return false; } }
function recordMetadata(intent: GenerationIntent, predictionId: string, outputIndex: number, digest: string, durationSeconds: number | null, fps: number | null) { return { generationIntentId: intent.id, providerPredictionId: predictionId, providerOutputIndex: outputIndex, contentDigest: digest, durationSecondsExact: durationSeconds, fps, dimensionEvidence: "server-media-probe/v1", selectedProvider: intent.selectedModel.provider, selectedModel: intent.selectedModel.model, selectedModelVersion: intent.selectedModel.version, inputSchemaDigest: intent.selectedModel.inputSchemaDigest, brandProfileId: intent.brand.profileId, brandRevision: intent.brand.revision, rightsSnapshotId: intent.rights.snapshotId, rightsSnapshotRevision: intent.rights.revision, regionEvidenceDigest: intent.regionAdmission.evidenceDigest, contentLanguage: intent.contentLanguage, arabicVariety: intent.arabicVariety }; }

export interface DecodedArtifactMetadata { width: number; height: number; durationSeconds: number | null; fps: number | null; }
export function validateDecodedArtifact(contract: GenerationIntent["outputContract"], metadata: DecodedArtifactMetadata): void {
  if (metadata.width !== contract.width || metadata.height !== contract.height || metadata.width * 16 !== metadata.height * 9) throw new Error("ARTIFACT_DIMENSIONS_MISMATCH");
  if (contract.mediaType === "image") { if (metadata.durationSeconds !== null || metadata.fps !== null) throw new Error("ARTIFACT_MEDIA_METADATA_MISMATCH"); return; }
  if (metadata.durationSeconds === null || contract.durationSeconds === null || metadata.fps === null || contract.fps === null) throw new Error("ARTIFACT_VIDEO_METADATA_REQUIRED");
  const frameTolerance = Math.max(0.05, 1 / contract.fps);
  if (Math.abs(metadata.durationSeconds - contract.durationSeconds) > frameTolerance || Math.abs(metadata.fps - contract.fps) > 0.1) throw new Error("ARTIFACT_VIDEO_CONTRACT_MISMATCH");
}

async function probe(path: string, mediaType: "image" | "video"): Promise<DecodedArtifactMetadata> {
  if (mediaType === "image") { const metadata = await sharp(path, { failOn: "error" }).metadata(); if (!metadata.width || !metadata.height) throw new Error("ARTIFACT_IMAGE_METADATA_REQUIRED"); return { width: metadata.width, height: metadata.height, durationSeconds: null, fps: null }; }
  const { ALL_FORMATS, FilePathSource, Input } = await import("mediabunny"); const media = new Input({ formats: ALL_FORMATS, source: new FilePathSource(path) });
  try { const track = await media.getPrimaryVideoTrack(); if (!track) throw new Error("ARTIFACT_VIDEO_TRACK_REQUIRED"); const [durationSeconds, stats] = await Promise.all([media.computeDuration(), track.computePacketStats(240)]); return { width: track.displayWidth, height: track.displayHeight, durationSeconds, fps: stats.averagePacketRate }; } finally { media.dispose(); }
}

async function download(fetcher: typeof fetch, url: URL, path: string, declared: number, allowedHosts: string[]): Promise<{ sizeBytes: number; digest: `sha256:${string}` }> {
  const response = await fetcher(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(60_000) }); if (!response.ok || !response.body || !isAllowedArtifactUrl(response.url || url, allowedHosts)) throw new Error("REPLICATE_OUTPUT_FETCH_FAILED");
  const handle = await open(path, "wx"); const hash = createHash("sha256"); let sizeBytes = 0; const reader = response.body.getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; sizeBytes += value.byteLength; if (sizeBytes > MAX_BYTES || (declared > 0 && sizeBytes > declared)) throw new Error("REPLICATE_OUTPUT_SIZE_INVALID"); hash.update(value); await handle.write(value); } } finally { await reader.cancel().catch(() => {}); await handle.close(); }
  if (sizeBytes <= 0 || (declared > 0 && sizeBytes !== declared)) throw new Error("REPLICATE_OUTPUT_SIZE_INVALID"); return { sizeBytes, digest: `sha256:${hash.digest("hex")}` };
}

export class ArtifactIngestionBusyError extends Error { readonly code = "ARTIFACT_INGESTION_BUSY"; constructor() { super("Artifact output is already being ingested."); } }

export class ArtifactLeaseGuard {
  private lost = false;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly receipts: ArtifactReceiptPort, private readonly identity: { workspaceId: string; predictionId: string; outputIndex: number; intentId: string; leaseOwner: string; leaseEpoch: number }, private readonly now: () => Date) {
    this.timer = setInterval(() => { void this.renew().catch(() => { this.lost = true; }); }, 30_000);
    this.timer.unref?.();
  }
  private async renew() {
    if (this.lost) return;
    const at = this.now();
    if (!await this.receipts.renew({ ...this.identity, at, leaseExpiresAt: new Date(at.getTime() + 120_000) })) this.lost = true;
  }
  async assertOwned() { await this.renew(); if (this.lost) throw new Error("ARTIFACT_LEASE_LOST"); }
  stop() { clearInterval(this.timer); }
}

/** Exactly-once, leased ingestion from trusted Replicate delivery into canonical Workspace assets. */
export class S3CanonicalArtifactIngestion implements CanonicalArtifactIngestionPort {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly allowedHosts = (process.env.REPLICATE_OUTPUT_HOSTS ?? "replicate.delivery").split(",").map((item) => item.trim()).filter(Boolean), private readonly receipts: ArtifactReceiptPort = new PostgresArtifactReceiptRepository(getDb), private readonly now = () => new Date()) {}
  async ingest(input: Parameters<CanonicalArtifactIngestionPort["ingest"]>[0]) {
    const urls = outputUrls(input.output); if (!urls.length) throw new Error("REPLICATE_OUTPUT_UNSUPPORTED"); const artifactIds: string[] = [];
    for (const [outputIndex, value] of urls.entries()) {
      const url = new URL(value); if (!isAllowedArtifactUrl(url, this.allowedHosts)) throw new Error("REPLICATE_OUTPUT_HOST_NOT_ALLOWED");
      const assetType = input.intent.outputContract.mediaType; const proposedStorageKey = buildAssetObjectKey({ workspaceId: input.workspaceId, projectId: null, assetType, fileExtension: assetType === "video" ? "mp4" : "png" }); const owner = randomUUID(); const at = this.now();
      const claimed = await this.receipts.claim({ workspaceId: input.workspaceId, predictionId: input.providerPredictionId, outputIndex, intentId: input.intent.id, proposedStorageKey, leaseOwner: owner, leaseExpiresAt: new Date(at.getTime() + 120_000), at });
      if (claimed.kind === "busy") throw new ArtifactIngestionBusyError(); if (claimed.kind === "ready") { artifactIds.push(claimed.receipt.assetId!); continue; }
      const lease = new ArtifactLeaseGuard(this.receipts, { workspaceId: input.workspaceId, predictionId: input.providerPredictionId, outputIndex, intentId: input.intent.id, leaseOwner: owner, leaseEpoch: claimed.receipt.leaseEpoch }, this.now);
      try {
      const head = await this.fetcher(url, { method: "HEAD", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15_000) }); if (!head.ok || !isAllowedArtifactUrl(head.url || url, this.allowedHosts)) throw new Error("REPLICATE_OUTPUT_FETCH_FAILED");
      const declared = Number(head.headers.get("content-length") ?? 0); if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_BYTES) throw new Error("REPLICATE_OUTPUT_TOO_LARGE"); const contentType = head.headers.get("content-type")?.split(";")[0]?.trim() || (input.intent.outputContract.mediaType === "video" ? "video/mp4" : "image/png");
      if ((input.intent.outputContract.mediaType === "video" && !contentType.startsWith("video/")) || (input.intent.outputContract.mediaType === "image" && !contentType.startsWith("image/"))) throw new Error("REPLICATE_OUTPUT_CONTRACT_MISMATCH");
      const [recovered] = await getDb().select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.storageKey, claimed.receipt.storageKey), isNull(assets.deletedAt))).limit(1); const recoveredMetadata = recovered?.metadata && typeof recovered.metadata === "object" && !Array.isArray(recovered.metadata) ? recovered.metadata as Record<string, unknown> : null;
      if (recovered && recoveredMetadata?.uploadState === "ready" && recoveredMetadata.providerPredictionId === input.providerPredictionId && recoveredMetadata.providerOutputIndex === outputIndex && typeof recovered.checksum === "string" && recovered.width && recovered.height && recovered.sizeBytes) { await lease.assertOwned(); const ready = await this.receipts.complete({ workspaceId: input.workspaceId, predictionId: input.providerPredictionId, outputIndex, intentId: input.intent.id, leaseOwner: owner, leaseEpoch: claimed.receipt.leaseEpoch, assetId: recovered.id, mimeType: recovered.mimeType ?? contentType, sizeBytes: recovered.sizeBytes, width: recovered.width, height: recovered.height, durationSeconds: typeof recoveredMetadata.durationSecondsExact === "number" ? recoveredMetadata.durationSecondsExact : null, fps: typeof recoveredMetadata.fps === "number" ? recoveredMetadata.fps : null, contentDigest: recovered.checksum as `sha256:${string}`, at: this.now() }); artifactIds.push(ready.assetId!); continue; }
      const directory = await mkdtemp(join(tmpdir(), "node-banana-artifact-")); const path = join(directory, `output-${outputIndex}.${extension(contentType)}`);
      try {
        const downloaded = await download(this.fetcher, url, path, declared, this.allowedHosts); await lease.assertOwned(); const decoded = await probe(path, input.intent.outputContract.mediaType); validateDecodedArtifact(input.intent.outputContract, decoded); const metadata = recordMetadata(input.intent, input.providerPredictionId, outputIndex, downloaded.digest, decoded.durationSeconds, decoded.fps);
        const pending = await recordPendingS3AssetWithQuota({ workspaceId: input.workspaceId, userId: input.intent.createdByUserId, projectId: null, type: assetType, storageBucket: process.env.S3_BUCKET_NAME || null, storageKey: claimed.receipt.storageKey, mimeType: contentType, originalFileName: `${input.providerPredictionId}-${outputIndex}.${extension(contentType)}`, expectedSizeBytes: downloaded.sizeBytes, metadata });
        await streamUploadToS3({ key: claimed.receipt.storageKey, body: createReadStream(path), contentType, contentLength: downloaded.sizeBytes }); await lease.assertOwned(); await finalizeAssetUpload({ workspaceId: input.workspaceId, assetId: pending.id, uploadState: "ready", sizeBytes: downloaded.sizeBytes, checksum: downloaded.digest, mimeType: contentType, width: decoded.width, height: decoded.height, durationSeconds: decoded.durationSeconds === null ? null : Math.round(decoded.durationSeconds), metadata });
        const ready = await this.receipts.complete({ workspaceId: input.workspaceId, predictionId: input.providerPredictionId, outputIndex, intentId: input.intent.id, leaseOwner: owner, leaseEpoch: claimed.receipt.leaseEpoch, assetId: pending.id, mimeType: contentType, sizeBytes: downloaded.sizeBytes, width: decoded.width, height: decoded.height, durationSeconds: decoded.durationSeconds, fps: decoded.fps, contentDigest: downloaded.digest, at: this.now() }); artifactIds.push(ready.assetId!);
      } finally { await rm(directory, { recursive: true, force: true }); }
      } finally { lease.stop(); }
    }
    return { artifactIds };
  }
}
