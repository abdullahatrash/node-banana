import {
  abortMultipartUpload,
  buildAssetObjectKey,
  buildCdnDownloadUrl,
  completeMultipartUpload,
  copyObjectInS3,
  createMultipartUpload,
  createPresignedDownload,
  createPresignedUpload,
  deleteObjectFromS3,
  listObjectsInS3,
  objectExistsInS3,
  presignUploadPart,
  putObjectToS3,
  streamUploadToS3,
  isS3Configured,
} from "./s3";

export type StorageBackend = "local" | "s3";
const CLOUD_MODE_STORAGE_KEY = "node-banana-cloud-mode";
let runtimeCloudModeOverride: boolean | null = null;

export function getStorageBackend(): StorageBackend {
  const configured = process.env.STORAGE_BACKEND?.toLowerCase();
  if (configured === "s3") return "s3";
  return "local";
}

export function canUseS3Storage(): boolean {
  return getStorageBackend() === "s3" && isS3Configured();
}

/**
 * Allows client code to cache server-detected cloud mode.
 * This avoids relying on server-only env vars in browser bundles.
 */
export function setRuntimeCloudModeOverride(value: boolean | null): void {
  runtimeCloudModeOverride = value;
  if (typeof window === "undefined") return;

  if (value === null) {
    window.localStorage.removeItem(CLOUD_MODE_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(CLOUD_MODE_STORAGE_KEY, value ? "true" : "false");
}

function getStoredClientCloudMode(): boolean | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(CLOUD_MODE_STORAGE_KEY);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return null;
}

/**
 * Returns true when the app should use cloud storage (R2/S3 + DB) instead of local filesystem.
 * Alias for canUseS3Storage — named for clarity at call sites.
 */
export function isCloudMode(): boolean {
  if (typeof window !== "undefined") {
    if (runtimeCloudModeOverride !== null) {
      return runtimeCloudModeOverride;
    }

    const storedClientMode = getStoredClientCloudMode();
    if (storedClientMode !== null) {
      return storedClientMode;
    }
  }

  return canUseS3Storage();
}

export {
  abortMultipartUpload,
  buildAssetObjectKey,
  buildCdnDownloadUrl,
  completeMultipartUpload,
  copyObjectInS3,
  createMultipartUpload,
  createPresignedDownload,
  createPresignedUpload,
  deleteObjectFromS3,
  listObjectsInS3,
  objectExistsInS3,
  presignUploadPart,
  putObjectToS3,
  streamUploadToS3,
  isS3Configured,
};
