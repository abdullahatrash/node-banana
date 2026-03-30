import { isCloudMode } from "@/lib/storage";
import { ingestStudioAsset } from "@/lib/studio/client";

const ASSET_ID_PREFIX = "asset_";

function isAssetIdRef(value: string): boolean {
  return value.startsWith(ASSET_ID_PREFIX);
}

function isDataUrl(value: string): boolean {
  return value.startsWith("data:image/") || value.startsWith("data:video/");
}

/**
 * In cloud mode, uploads base64 data URL images to R2 and returns asset IDs.
 * In local mode, returns inputs unchanged (pass-through).
 *
 * Deduplicates within a single call — identical data URLs are uploaded once.
 * On upload failure for an individual image, falls back to the original base64.
 */
export async function uploadImagesToR2(params: {
  images: string[];
  dynamicInputs?: Record<string, unknown>;
  projectId?: string | null;
}): Promise<{
  images: string[];
  dynamicInputs: Record<string, unknown>;
}> {
  const dynamicInputs = params.dynamicInputs || {};

  if (!isCloudMode()) {
    return { images: params.images, dynamicInputs };
  }

  // Dedup cache: data URL → promise of asset ID (prevents concurrent duplicate uploads)
  const inflightUploads = new Map<string, Promise<string>>();

  function uploadOne(value: string): Promise<string> {
    // Already an asset ref — no upload needed
    if (isAssetIdRef(value)) return Promise.resolve(value);
    // Not a data URL — pass through (text, URLs, etc.)
    if (!isDataUrl(value)) return Promise.resolve(value);

    // Return existing in-flight promise for same data URL
    const inflight = inflightUploads.get(value);
    if (inflight) return inflight;

    const uploadPromise = ingestStudioAsset({
      projectId: params.projectId,
      assetType: "image",
      sourceDataUrl: value,
    })
      .then((result) => result.assetId)
      .catch((err) => {
        console.error("Failed to upload image to R2, falling back to base64:", err);
        return value;
      });

    inflightUploads.set(value, uploadPromise);
    return uploadPromise;
  }

  // Upload images array
  const resolvedImages = await Promise.all(params.images.map(uploadOne));

  // Upload data URL values in dynamicInputs
  const resolvedDynamicInputs: Record<string, unknown> = {};
  await Promise.all(
    Object.entries(dynamicInputs).map(async ([key, value]) => {
      if (typeof value === "string") {
        resolvedDynamicInputs[key] = await uploadOne(value);
      } else if (Array.isArray(value)) {
        resolvedDynamicInputs[key] = await Promise.all(
          value.map((v) => (typeof v === "string" ? uploadOne(v) : v)),
        );
      } else {
        resolvedDynamicInputs[key] = value;
      }
    }),
  );

  return { images: resolvedImages, dynamicInputs: resolvedDynamicInputs };
}
