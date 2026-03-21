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

export {
  buildAssetObjectKey,
  createPresignedUpload,
  isS3Configured,
};

