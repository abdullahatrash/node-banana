import { getObjectFromS3 } from "@/lib/storage/s3";
import { getAsset } from "@/lib/studio/repository";

const ASSET_ID_PREFIX = "asset_";

function isAssetIdRef(value: string): boolean {
  return value.startsWith(ASSET_ID_PREFIX);
}

/**
 * Resolve a single asset ID to a base64 data URL by fetching from S3.
 */
async function resolveAssetRef(
  assetId: string,
  workspaceId: string,
): Promise<string> {
  const asset = await getAsset(workspaceId, assetId);
  if (!asset?.storageKey) {
    throw new Error(`Asset not found: ${assetId}`);
  }
  const { body, contentType } = await getObjectFromS3({ key: asset.storageKey });
  const mimeType = contentType || asset.mimeType || "image/png";
  return `data:${mimeType};base64,${body.toString("base64")}`;
}

/**
 * Resolve any asset_xxx references in the images array and dynamicInputs
 * back to base64 data URLs by fetching from R2/S3.
 *
 * Non-asset strings (base64 data URLs, text) pass through unchanged.
 */
export async function resolveAssetRefsInPayload(params: {
  images?: string[];
  dynamicInputs?: Record<string, unknown>;
  workspaceId: string;
}): Promise<{
  images: string[];
  dynamicInputs: Record<string, unknown>;
}> {
  const { workspaceId } = params;
  const images = params.images || [];
  const dynamicInputs = params.dynamicInputs || {};

  // Resolve images array
  const resolvedImages = await Promise.all(
    images.map((img) =>
      isAssetIdRef(img) ? resolveAssetRef(img, workspaceId) : Promise.resolve(img),
    ),
  );

  // Resolve dynamicInputs values that are asset refs
  const resolvedDynamicInputs: Record<string, unknown> = {};
  const dynamicEntries = Object.entries(dynamicInputs);

  await Promise.all(
    dynamicEntries.map(async ([key, value]) => {
      if (typeof value === "string" && isAssetIdRef(value)) {
        resolvedDynamicInputs[key] = await resolveAssetRef(value, workspaceId);
      } else if (Array.isArray(value)) {
        resolvedDynamicInputs[key] = await Promise.all(
          value.map((v) =>
            typeof v === "string" && isAssetIdRef(v)
              ? resolveAssetRef(v, workspaceId)
              : Promise.resolve(v),
          ),
        );
      } else {
        resolvedDynamicInputs[key] = value;
      }
    }),
  );

  return { images: resolvedImages, dynamicInputs: resolvedDynamicInputs };
}
