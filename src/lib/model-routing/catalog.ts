import type { ModelDescriptor } from "./types";

const schema = (hex: string) => `sha256:${hex.padEnd(64, "0")}` as const;
const shared = { contentLanguages: ["ar", "en", "mixed"] as const, arabicVarieties: ["msa", "gulf", "egyptian", "levantine", "maghrebi", "other"] as const, verifiedRegions: ["replicate-us"] as const, executionModes: ["async"] as const };

/** Pinned curation snapshot. Updating a model/version/schema is a reviewed code change. */
export const CURATED_MODELS: readonly ModelDescriptor[] = [
  { provider: "replicate", model: "prunaai/p-image", version: "pinned-2026-09", inputSchemaDigest: schema("01"), label: "P-Image preview", capabilities: ["text_to_image"], quality: "preview", ...shared, aspectRatios: ["9:16", "1:1", "16:9"], priceUsd: { basis: "image", amount: 0.005 }, lane: "preview" },
  { provider: "replicate", model: "prunaai/p-image-edit", version: "pinned-2026-09", inputSchemaDigest: schema("02"), label: "P-Image Edit", capabilities: ["image_to_image"], quality: "preview", ...shared, aspectRatios: ["9:16", "1:1", "16:9"], priceUsd: { basis: "image", amount: 0.01 }, lane: "preview" },
  { provider: "replicate", model: "google/nano-banana-2", version: "pinned-2026-09", inputSchemaDigest: schema("03"), label: "Nano Banana 2", capabilities: ["text_to_image", "image_to_image"], quality: "standard", ...shared, aspectRatios: ["9:16", "1:1", "16:9"], priceUsd: { basis: "image", amount: 0.067 }, lane: "brand" },
  { provider: "replicate", model: "black-forest-labs/flux-2-pro", version: "pinned-2026-09", inputSchemaDigest: schema("04"), label: "FLUX 2 Pro", capabilities: ["text_to_image", "image_to_image"], quality: "premium", ...shared, aspectRatios: ["9:16", "1:1", "16:9"], priceUsd: { basis: "image", amount: 0.08 }, lane: "brand" },
  { provider: "replicate", model: "prunaai/p-video", version: "pinned-2026-09", inputSchemaDigest: schema("05"), label: "P-Video preview", capabilities: ["text_to_video", "image_to_video"], quality: "preview", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.005 }, lane: "preview" },
  { provider: "replicate", model: "google/veo-3.1-lite", version: "pinned-2026-09", inputSchemaDigest: schema("06"), label: "Veo 3.1 Lite", capabilities: ["text_to_video", "image_to_video"], quality: "standard", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.05 }, lane: "final" },
  { provider: "replicate", model: "bytedance/seedance-2", version: "pinned-2026-09", inputSchemaDigest: schema("07"), label: "Seedance 2", capabilities: ["text_to_video", "image_to_video"], quality: "premium", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.12 }, lane: "canary" },
  { provider: "replicate", model: "kwaivgi/kling-v3-omni", version: "pinned-2026-09", inputSchemaDigest: schema("08"), label: "Kling v3 Omni", capabilities: ["text_to_video", "image_to_video", "video_to_video"], quality: "premium", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.14 }, lane: "canary" },
  { provider: "replicate", model: "wan-video/wan-2.7-videoedit", version: "pinned-2026-09", inputSchemaDigest: schema("09"), label: "Wan 2.7 Video Edit", capabilities: ["video_to_video"], quality: "premium", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.09 }, lane: "canary" },
];

export function findCuratedModel(ref: Pick<ModelDescriptor, "provider" | "model" | "version" | "inputSchemaDigest">): ModelDescriptor | null { return CURATED_MODELS.find((item) => item.provider === ref.provider && item.model === ref.model && item.version === ref.version && item.inputSchemaDigest === ref.inputSchemaDigest) ?? null; }
