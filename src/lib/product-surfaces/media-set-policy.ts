export const DEMO_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const DEMO_VIDEO_MAX_DURATION_SECONDS = 30;
export const MEDIA_SET_PURPOSES = ["general", "demo_videos"] as const;
export type MediaSetPurpose = (typeof MEDIA_SET_PURPOSES)[number];

export interface MediaSetAssetEvidence {
  id: string;
  type: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  checksum: string | null;
  metadata: Record<string, unknown> | null;
}

export type MediaSetAssetIssue =
  | "MEDIA_SET_ASSET_NOT_AVAILABLE"
  | "DEMO_VIDEO_TYPE_INVALID"
  | "DEMO_VIDEO_FORMAT_INVALID"
  | "DEMO_VIDEO_SIZE_INVALID"
  | "DEMO_VIDEO_DURATION_INVALID";

export function mediaSetAssetIssue(purpose: MediaSetPurpose, asset: MediaSetAssetEvidence): MediaSetAssetIssue | null {
  if (asset.metadata?.uploadState !== "ready" || !/^sha256:[a-f0-9]{64}$/.test(asset.checksum ?? "")) return "MEDIA_SET_ASSET_NOT_AVAILABLE";
  if (purpose !== "demo_videos") return null;
  if (asset.type !== "video") return "DEMO_VIDEO_TYPE_INVALID";
  if (!asset.mimeType || !["video/mp4", "video/quicktime"].includes(asset.mimeType.toLowerCase())) return "DEMO_VIDEO_FORMAT_INVALID";
  if (!Number.isSafeInteger(asset.sizeBytes) || (asset.sizeBytes ?? 0) <= 0 || (asset.sizeBytes ?? 0) > DEMO_VIDEO_MAX_BYTES) return "DEMO_VIDEO_SIZE_INVALID";
  if (!Number.isInteger(asset.durationSeconds) || (asset.durationSeconds ?? 0) <= 0 || (asset.durationSeconds ?? 0) > DEMO_VIDEO_MAX_DURATION_SECONDS) return "DEMO_VIDEO_DURATION_INVALID";
  return null;
}
