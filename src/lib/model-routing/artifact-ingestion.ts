import { buildAssetObjectKey, streamUploadToS3 } from "@/lib/storage";
import { finalizeAssetUpload, recordPendingS3AssetWithQuota } from "@/lib/studio/repository";
import type { CanonicalArtifactIngestionPort } from "./replicate-contract";

const MAX_BYTES = 500 * 1024 * 1024;
function outputUrls(output: unknown): string[] {
  const values = typeof output === "string" ? [output] : Array.isArray(output) ? output : [];
  return values.filter((value): value is string => typeof value === "string").slice(0, 8);
}
function extension(contentType: string) { if (contentType.includes("webm")) return "webm"; if (contentType.includes("video")) return "mp4"; if (contentType.includes("jpeg")) return "jpg"; if (contentType.includes("webp")) return "webp"; return "png"; }

/** Streams trusted Replicate delivery outputs into canonical Workspace storage. */
export class S3CanonicalArtifactIngestion implements CanonicalArtifactIngestionPort {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly allowedHosts = (process.env.REPLICATE_OUTPUT_HOSTS ?? "replicate.delivery").split(",").map((item) => item.trim()).filter(Boolean)) {}
  async ingest(input: Parameters<CanonicalArtifactIngestionPort["ingest"]>[0]) {
    const urls = outputUrls(input.output);
    if (!urls.length) throw new Error("REPLICATE_OUTPUT_UNSUPPORTED");
    const artifactIds: string[] = [];
    for (const value of urls) {
      const url = new URL(value);
      if (url.protocol !== "https:" || !this.allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("REPLICATE_OUTPUT_HOST_NOT_ALLOWED");
      const response = await this.fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (!response.ok || !response.body) throw new Error("REPLICATE_OUTPUT_FETCH_FAILED");
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) throw new Error("REPLICATE_OUTPUT_TOO_LARGE");
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || (input.intent.capability.includes("video") ? "video/mp4" : "image/png");
      const assetType = contentType.startsWith("video/") ? "video" as const : "image" as const;
      const key = buildAssetObjectKey({ workspaceId: input.workspaceId, projectId: null, assetType, fileExtension: extension(contentType) });
      const pending = await recordPendingS3AssetWithQuota({ workspaceId: input.workspaceId, userId: input.intent.createdByUserId, projectId: null, type: assetType, storageBucket: process.env.S3_BUCKET_NAME || null, storageKey: key, mimeType: contentType, originalFileName: `${input.providerPredictionId}.${extension(contentType)}`, expectedSizeBytes: declared || MAX_BYTES });
      try {
        const uploaded = await streamUploadToS3({ key, body: response.body, contentType, contentLength: declared || undefined });
        if (uploaded.sizeBytes <= 0 || uploaded.sizeBytes > MAX_BYTES) throw new Error("REPLICATE_OUTPUT_SIZE_INVALID");
        await finalizeAssetUpload({ workspaceId: input.workspaceId, assetId: pending.id, uploadState: "ready", sizeBytes: uploaded.sizeBytes, mimeType: contentType });
        artifactIds.push(pending.id);
      } catch (error) {
        await finalizeAssetUpload({ workspaceId: input.workspaceId, assetId: pending.id, uploadState: "failed", mimeType: contentType, error: "REPLICATE_ARTIFACT_INGEST_FAILED" }).catch(() => {});
        throw error;
      }
    }
    return { artifactIds };
  }
}
