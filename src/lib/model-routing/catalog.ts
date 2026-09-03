import { z } from "zod";
import type { ExactModelRef, ModelDescriptor } from "./types";

const shared = { contentLanguages: ["ar", "en", "mixed"] as const, arabicVarieties: ["msa", "gulf", "egyptian", "levantine", "maghrebi", "other"] as const, verifiedRegions: ["replicate-us"] as const, executionModes: ["async"] as const };
const unqualified = { status: "unqualified", reason: "IMMUTABLE_VERSION_AND_SCHEMA_NOT_CONFIGURED" } as const;

/** Discovery defaults only. Execution requires a server-configured immutable version and schema digest. */
export const CURATED_MODELS: readonly ModelDescriptor[] = [
  { provider: "replicate", model: "prunaai/p-image", label: "P-Image preview", capabilities: ["text_to_image"], quality: "preview", ...shared, aspectRatios: ["9:16", "1:1", "16:9"], priceUsd: { basis: "image", amount: 0.005 }, lane: "preview", qualification: unqualified },
  { provider: "replicate", model: "prunaai/p-image-edit", label: "P-Image Edit", capabilities: ["image_to_image"], quality: "preview", ...shared, aspectRatios: ["9:16", "1:1", "16:9"], priceUsd: { basis: "image", amount: 0.01 }, lane: "preview", qualification: unqualified },
  { provider: "replicate", model: "google/nano-banana-2", label: "Nano Banana 2", capabilities: ["text_to_image", "image_to_image"], quality: "standard", ...shared, aspectRatios: ["9:16", "1:1", "16:9"], priceUsd: { basis: "image", amount: 0.067 }, lane: "brand", qualification: unqualified },
  { provider: "replicate", model: "black-forest-labs/flux-2-pro", label: "FLUX 2 Pro", capabilities: ["text_to_image", "image_to_image"], quality: "premium", ...shared, aspectRatios: ["9:16", "1:1", "16:9"], priceUsd: { basis: "image", amount: 0.08 }, lane: "brand", qualification: unqualified },
  { provider: "replicate", model: "prunaai/p-video", label: "P-Video preview", capabilities: ["text_to_video", "image_to_video"], quality: "preview", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.005 }, lane: "preview", qualification: unqualified },
  { provider: "replicate", model: "google/veo-3.1-lite", label: "Veo 3.1 Lite", capabilities: ["text_to_video", "image_to_video"], quality: "standard", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.05 }, lane: "final", qualification: unqualified },
  { provider: "replicate", model: "bytedance/seedance-2.0", label: "Seedance 2", capabilities: ["text_to_video", "image_to_video"], quality: "premium", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.12 }, lane: "canary", qualification: unqualified },
  { provider: "replicate", model: "kwaivgi/kling-v3-omni-video", label: "Kling v3 Omni", capabilities: ["text_to_video", "image_to_video", "video_to_video"], quality: "premium", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.14 }, lane: "canary", qualification: unqualified },
  { provider: "replicate", model: "wan-video/wan-2.7-videoedit", label: "Wan 2.7 Video Edit", capabilities: ["video_to_video"], quality: "premium", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.09 }, lane: "canary", qualification: unqualified },
];

const inputKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const parameterValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
const qualificationSchema = z.record(z.string(), z.object({ endpoint: z.literal("versioned"), version: z.string().min(8).max(200), inputSchemaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), executionPriceUsd: z.object({ basis: z.enum(["image", "second", "run"]), amount: z.number().positive().max(100) }).strict(), maxQuantity: z.number().positive().max(10_000), outputShape: z.object({ width: z.number().int().positive().max(16_384), height: z.number().int().positive().max(16_384), fps: z.number().positive().max(240).nullable() }).strict().refine((shape) => shape.width * 16 === shape.height * 9, "Output shape must be exact 9:16"), inputContract: z.object({ promptKey: inputKey, aspectRatioKey: inputKey, quantityKey: inputKey.nullable(), imageKey: inputKey.nullable(), imageMode: z.enum(["single", "array"]), safety: z.object({ parameterKey: inputKey, safeValue: parameterValue }).strict(), lockedParameters: z.record(inputKey, parameterValue) }).strict() }).strict().superRefine((value, context) => { if (value.inputContract.lockedParameters[value.inputContract.safety.parameterKey] !== value.inputContract.safety.safeValue) context.addIssue({ code: "custom", message: "The exact provider-safe value must be locked." }); }));
export function configuredCatalog(raw = process.env.REPLICATE_MODEL_QUALIFICATIONS_JSON): readonly ModelDescriptor[] {
  if (!raw) return CURATED_MODELS;
  let parsed: z.infer<typeof qualificationSchema>;
  try { parsed = qualificationSchema.parse(JSON.parse(raw)); } catch { return CURATED_MODELS; }
  return CURATED_MODELS.map((item) => { const value = parsed[`${item.provider}:${item.model}`]; return value ? { ...item, qualification: { status: "qualified" as const, endpoint: value.endpoint, version: value.version, inputSchemaDigest: value.inputSchemaDigest as `sha256:${string}`, executionPriceUsd: value.executionPriceUsd, maxQuantity: value.maxQuantity, outputShape: value.outputShape, inputContract: value.inputContract } } : item; });
}
export function exactModelRef(model: ModelDescriptor): ExactModelRef | null { return model.qualification.status === "qualified" ? { provider: model.provider, model: model.model, version: model.qualification.version, inputSchemaDigest: model.qualification.inputSchemaDigest } : null; }
export function findCuratedModel(ref: ExactModelRef, catalog = configuredCatalog()): ModelDescriptor | null { return catalog.find((item) => item.provider === ref.provider && item.model === ref.model && item.qualification.status === "qualified" && item.qualification.version === ref.version && item.qualification.inputSchemaDigest === ref.inputSchemaDigest) ?? null; }
