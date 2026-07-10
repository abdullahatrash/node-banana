import { resolveAssetRefsInPayload } from "@/app/api/generate/assetResolver";
import { generateWithGemini } from "@/app/api/generate/providers/gemini";
import { generateLlmText } from "@/app/api/llm/core";
import {
  buildAssetObjectKey,
  buildCdnDownloadUrl,
  createPresignedDownload,
  putObjectToS3,
} from "@/lib/storage/s3";
import { recordAsset } from "@/lib/studio/repository";
import type { LLMModelType, ModelType } from "@/types";

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
 * Build the single key-resolution seam from per-request keys. This is the
 * documented injection point: a later merge swaps this for `resolveInferenceKey`
 * (header → workspace vault → typed error) without touching the runner.
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

    async generateImage(args) {
      const response = await generateWithGemini(
        `run-${projectId}`,
        args.apiKey,
        args.prompt,
        args.images,
        args.model as ModelType,
        args.aspectRatio,
        args.resolution,
      );
      const body = (await response.json()) as {
        success: boolean;
        image?: string;
        error?: string;
      };
      if (!body.success || !body.image) {
        throw new Error(body.error || "Image generation failed");
      }
      return { dataUrl: body.image };
    },

    async generateText(args) {
      const text = await generateLlmText({
        provider: args.provider,
        model: args.model as LLMModelType,
        prompt: args.prompt,
        images: args.images,
        temperature: args.temperature,
        maxTokens: args.maxTokens,
        keys: {
          google: keys.gemini ?? keys.google ?? null,
          openai: keys.openai ?? null,
          anthropic: keys.anthropic ?? null,
        },
      });
      return { text };
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
