import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export type IngestedAssetType = "image" | "video" | "audio" | "document" | "model3d" | "workflow";

export interface AssetMediaEvidence {
  checksum: `sha256:${string}`;
  width?: number;
  height?: number;
  durationSeconds?: number;
  metadata?: { dimensionEvidence: "server-media-probe/v1" };
}

function assertMediaMimeType(assetType: IngestedAssetType, mimeType: string): void {
  if (assetType === "image" && !mimeType.startsWith("image/")) throw new Error("ASSET_IMAGE_CONTENT_TYPE_INVALID");
  if (assetType === "video" && !["video/mp4", "video/webm", "video/quicktime"].includes(mimeType)) throw new Error("ASSET_VIDEO_FORMAT_UNSUPPORTED");
  if (assetType === "document" && !["application/pdf", "application/json", "text/plain"].includes(mimeType)) throw new Error("ASSET_DOCUMENT_FORMAT_UNSUPPORTED");
}

async function inspectImage(source: Buffer | string): Promise<Omit<AssetMediaEvidence, "checksum">> {
  const result = await sharp(source, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
  if (!result.width || !result.height) throw new Error("ASSET_IMAGE_DECODE_FAILED");
  return { width: result.width, height: result.height, metadata: { dimensionEvidence: "server-media-probe/v1" } };
}

async function inspectVideo(source: Buffer | string): Promise<Omit<AssetMediaEvidence, "checksum">> {
  const { ALL_FORMATS, BlobSource, FilePathSource, Input } = await import("mediabunny");
  const media = new Input({
    formats: ALL_FORMATS,
    source: typeof source === "string"
      ? new FilePathSource(source)
      : new BlobSource(new Blob([new Uint8Array(source)])),
  });
  try {
    const track = await media.getPrimaryVideoTrack();
    const duration = await media.computeDuration();
    if (!track || !track.displayWidth || !track.displayHeight || !Number.isFinite(duration) || duration <= 0) throw new Error("ASSET_VIDEO_DECODE_FAILED");
    return { width: track.displayWidth, height: track.displayHeight, durationSeconds: Math.max(1, Math.round(duration)), metadata: { dimensionEvidence: "server-media-probe/v1" } };
  } finally {
    media.dispose();
  }
}

async function inspectDecodedMedia(assetType: IngestedAssetType, mimeType: string, source: Buffer | string) {
  assertMediaMimeType(assetType, mimeType);
  if (assetType === "image") return inspectImage(source);
  if (assetType === "video") return inspectVideo(source);
  return {};
}

export async function collectBufferedAssetEvidence(input: { assetType: IngestedAssetType; mimeType: string; bytes: Buffer }): Promise<AssetMediaEvidence> {
  const checksum = `sha256:${createHash("sha256").update(input.bytes).digest("hex")}` as const;
  return { checksum, ...await inspectDecodedMedia(input.assetType, input.mimeType, input.bytes) };
}

export async function collectFileAssetEvidence(input: { assetType: IngestedAssetType; mimeType: string; path: string; checksum: `sha256:${string}` }): Promise<AssetMediaEvidence> {
  if (!/^sha256:[a-f0-9]{64}$/.test(input.checksum)) throw new Error("ASSET_CHECKSUM_INVALID");
  return { checksum: input.checksum, ...await inspectDecodedMedia(input.assetType, input.mimeType, input.path) };
}

export async function collectStreamedAssetEvidence(input: {
  assetType: IngestedAssetType;
  mimeType: string;
  body: AsyncIterable<Uint8Array>;
  maximumBytes: number;
}): Promise<AssetMediaEvidence & { sizeBytes: number }> {
  const directory = await mkdtemp(join(tmpdir(), "node-banana-asset-evidence-"));
  const path = join(directory, "asset-upload");
  const file = await open(path, "wx");
  const checksum = createHash("sha256");
  let sizeBytes = 0;

  try {
    for await (const sourceChunk of input.body) {
      const chunk = Buffer.from(sourceChunk);
      sizeBytes += chunk.byteLength;
      if (sizeBytes > input.maximumBytes) throw new Error("ASSET_SIZE_LIMIT_EXCEEDED");
      checksum.update(chunk);
      await file.write(chunk);
    }
    if (sizeBytes === 0) throw new Error("ASSET_CONTENT_EMPTY");
    await file.close();
    const digest = `sha256:${checksum.digest("hex")}` as const;
    return { sizeBytes, ...await collectFileAssetEvidence({ assetType: input.assetType, mimeType: input.mimeType, path, checksum: digest }) };
  } finally {
    await file.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}
