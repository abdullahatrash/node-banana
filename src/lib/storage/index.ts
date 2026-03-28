import { buildAssetObjectKey, createPresignedUpload, isS3Configured } from "./s3";

export type StorageBackend = "local" | "s3";

export function getStorageBackend(): StorageBackend {
  const configured = process.env.STORAGE_BACKEND?.toLowerCase();
  if (configured === "s3") return "s3";
  return "local";
}

export function canUseS3Storage(): boolean {
  return getStorageBackend() === "s3" && isS3Configured();
}

/**
 * Returns true when the app should use cloud storage (R2/S3 + DB) instead of local filesystem.
 * Alias for canUseS3Storage — named for clarity at call sites.
 */
export function isCloudMode(): boolean {
  return canUseS3Storage();
}

export {
  buildAssetObjectKey,
  createPresignedUpload,
  isS3Configured,
};

