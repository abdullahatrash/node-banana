import { resolveAssetRefsInPayload } from "@/app/api/generate/assetResolver";
import { resolveInferenceKeyOptional } from "@/lib/byok/resolveInferenceKey";
import {
  buildAssetObjectKey,
  buildCdnDownloadUrl,
  createPresignedDownload,
  putObjectToS3,
} from "@/lib/storage/s3";
import { recordAsset } from "@/lib/studio/repository";

import type { ProviderKeyResolver, RunnerDeps } from "./types";

/**
 * Per-request provider keys, sourced from headers / tool input (BYOK header
 * pass-through). `google` and `gemini` are treated as the same Gemini key.
 */
export interface ProviderKeys {
  gemini?: string | null;
  google?: string | null;
  openai?: string | null;
  anthropic?: string | null;
}

/**
 * Enrich per-request (header/tool-input) keys with the BYOK stack's resolution
 * order — header override → workspace vault — via `resolveInferenceKeyOptional`.
 *
 * This is the integration swap the #132 PR body flagged as a follow-up: now that
 * the BYOK vault (`resolveProviderKey`) exists, the runner's key seam consults
 * it instead of relying on header pass-through alone. It stays async and runs at
 * the call site (which has async context + `workspaceId`) so the synchronous
 * `ProviderKeyResolver` contract the runner consumes is unchanged: callers
 * pre-resolve here, then hand the enriched keys to `makeRequestKeyResolver`.
 * A provider that resolves to `null` here surfaces later as the typed
 * `byok_key_missing` error from `assertProviderKeys` — never a server-env key.
 */
export async function resolveRequestKeys(
  headerKeys: ProviderKeys,
  workspaceId: string | null,
): Promise<ProviderKeys> {
  const [gemini, openai, anthropic] = await Promise.all([
    resolveInferenceKeyOptional({
      headerKey: headerKeys.gemini ?? headerKeys.google ?? null,
      workspaceId,
      provider: "gemini",
    }),
    resolveInferenceKeyOptional({
      headerKey: headerKeys.openai ?? null,
      workspaceId,
      provider: "openai",
    }),
    resolveInferenceKeyOptional({
      headerKey: headerKeys.anthropic ?? null,
      workspaceId,
      provider: "anthropic",
    }),
  ]);
  return { gemini, google: gemini, openai, anthropic };
}

/**
 * Build the single key-resolution seam from per-request keys. Keys are expected
 * to have already been through `resolveRequestKeys` (header → workspace vault),
 * so this stays a pure synchronous lookup the runner can call per node.
 */
export function makeRequestKeyResolver(keys: ProviderKeys): ProviderKeyResolver {
  return (provider: string) => {
    switch (provider) {
      case "gemini":
      case "google":
        return keys.gemini ?? keys.google ?? null;
      case "openai":
        return keys.openai ?? null;
      case "anthropic":
        return keys.anthropic ?? null;
      default:
        return null;
    }
  };
}

function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    return { mimeType: "image/png", bytes: Buffer.from(dataUrl, "base64") };
  }
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

interface DefaultDepsOptions {
  workspaceId: string;
  projectId: string;
  userId: string;
  keys: ProviderKeys;
  onProgress?: RunnerDeps["onProgress"];
}

/**
 * Wire the runner to the same provider and asset code the HTTP routes use.
 * Generated images are persisted as real workspace assets via `recordAsset`
 * (the existing save path), so a run's outputs are addressable asset ids/urls.
 */
export function defaultRunnerDeps(options: DefaultDepsOptions): RunnerDeps {
  const { workspaceId, projectId, userId, keys } = options;

  return {
    resolveKey: makeRequestKeyResolver(keys),

    async generateImage() {
      throw new Error("WORKFLOW_ADMITTED_IMAGE_GENERATION_UNAVAILABLE");
    },

    async generateText() {
      throw new Error("WORKFLOW_ADMITTED_TEXT_GENERATION_UNAVAILABLE");
    },

    async saveImageAsset(args) {
      const { mimeType, bytes } = parseDataUrl(args.dataUrl);
      const key = buildAssetObjectKey({
        workspaceId,
        projectId,
        assetType: "image",
        fileExtension: extensionForMime(mimeType),
      });
      await putObjectToS3({ key, body: bytes, contentType: mimeType });
      const asset = await recordAsset({
        workspaceId,
        userId,
        projectId,
        type: "image",
        storageProvider: "r2",
        storageKey: key,
        mimeType,
        sizeBytes: bytes.byteLength,
        metadata: { uploadState: "ready", source: "workflow-run", nodeId: args.nodeId },
      });
      let url = buildCdnDownloadUrl({ key });
      if (!url) {
        url = (await createPresignedDownload({ key })).downloadUrl;
      }
      return { assetId: asset.id, url };
    },

    async resolveImageRef(ref) {
      const { images } = await resolveAssetRefsInPayload({
        images: [ref],
        workspaceId,
      });
      return images[0];
    },

    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  };
}
