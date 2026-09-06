import { z } from "zod";
import { createPublicKey, verify } from "node:crypto";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { isNineSixteenDimensions } from "./aspect-ratio";
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
  { provider: "replicate", model: "wan-video/wan-2.7-videoedit", label: "Wan 2.7 Video Edit", capabilities: ["video_to_video"], quality: "premium", ...shared, aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.10 }, lane: "canary", qualification: unqualified },
  { provider: "replicate", model: "meta/meta-llama-3-8b-instruct", label: "Llama 3 8B Copy", capabilities: ["text_generation"], quality: "standard", ...shared, aspectRatios: [], priceUsd: { basis: "run", amount: 0 }, lane: "brand", qualification: unqualified },
  { provider: "replicate", model: "black-forest-labs/flux-2-klein-4b", label: "FLUX.2 Klein 4B", capabilities: ["text_to_image", "image_to_image"], quality: "standard", ...shared, aspectRatios: ["9:16", "1:1", "16:9"], priceUsd: { basis: "components", components: [{ basis: "input_megapixel", amount: 0.001 }, { basis: "output_megapixel", amount: 0.001 }] }, lane: "brand", qualification: unqualified },
];

const inputKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const parameterValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as `sha256:${string}`);
const url = z.string().url().refine((value) => value.startsWith("https://"), "Evidence URLs must use HTTPS");
const safetyContractSchema = z.union([
  z.object({ mode: z.literal("provider_input").optional(), parameterKey: inputKey, safeValue: parameterValue }).strict(),
  z.object({ mode: z.literal("provider_managed"), parameterKey: z.null(), safeValue: z.null(), evidenceSourceUrl: url, evidenceDigest: digest }).strict(),
]);
const executionPriceUsdSchema = z.discriminatedUnion("basis", [
  z.object({ basis: z.enum(["image", "second", "run"]), amount: z.number().positive().max(100) }).strict(),
  z.object({ basis: z.literal("components"), components: z.array(z.object({ basis: z.enum(["input_megapixel", "output_megapixel"]), amount: z.number().positive().max(100) }).strict()).min(1).max(2) }).strict().superRefine((price, context) => {
    if (new Set(price.components.map((component) => component.basis)).size !== price.components.length) context.addIssue({ code: "custom", message: "Pricing component bases must be unique." });
  }),
]);
export const modelQualificationAttestationSchema = z.object({
  schema: z.literal("model-execution-qualification/v1"), id: z.string().min(8).max(200), revision: z.number().int().positive(), provider: z.literal("replicate"), model: z.string().min(1).max(200),
  endpoint: z.enum(["versioned", "official"]), version: z.string().min(3).max(200), inputSchemaDigest: digest,
  capabilities: z.array(z.enum(["text_generation","text_to_image","image_to_image","text_to_video","image_to_video","video_to_video"])).min(1), contentLanguages: z.array(z.enum(["ar","en","mixed"])).min(1), arabicVarieties: z.array(z.enum(["msa","gulf","egyptian","levantine","maghrebi","other"])), verifiedRegions: z.array(z.string().min(1)).min(1), executionModes: z.array(z.enum(["sync","async"])).min(1),
  executionPriceUsd: executionPriceUsdSchema, maxQuantity: z.number().positive().max(10_000), cancelAfterSeconds: z.number().int().min(60).max(86_400), outputShape: z.object({ width: z.number().int().positive().max(16_384).nullable(), height: z.number().int().positive().max(16_384).nullable(), fps: z.number().positive().max(240).nullable() }).strict(), inputContract: z.object({ promptKey: inputKey, aspectRatioKey: inputKey.nullable(), quantityKey: inputKey.nullable(), imageKey: inputKey.nullable(), imageMode: z.enum(["single", "array"]), safety: safetyContractSchema.nullable(), lockedParameters: z.record(inputKey, parameterValue) }).strict().superRefine((contract, context) => {
    const mapped = [contract.promptKey, contract.aspectRatioKey, contract.quantityKey, contract.imageKey, contract.safety?.parameterKey].filter((value): value is string => Boolean(value));
    if (new Set(mapped).size !== mapped.length) context.addIssue({ code: "custom", message: "Provider input keys must be distinct." });
    if (mapped.some((key) => key in contract.lockedParameters && key !== contract.safety?.parameterKey)) context.addIssue({ code: "custom", message: "Dynamic provider input keys must not collide with locked parameters." });
  }),
  license: z.object({ name: z.string().min(1).max(200), commercialUse: z.literal(true), derivativeUse: z.boolean(), sourceUrl: url, digest }).strict(),
  pricingSource: z.object({ sourceUrl: url, digest, checkedAt: z.string().datetime({ offset: true }) }).strict(),
  qualificationRun: z.object({ id: z.string().min(8).max(200), digest, completedAt: z.string().datetime({ offset: true }) }).strict(),
  issuedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.endpoint === "official" && value.version !== value.model) context.addIssue({ code: "custom", message: "Official model qualifications must use the stable owner/name identifier as their version." });
  const textOnly = value.capabilities.length === 1 && value.capabilities[0] === "text_generation";
  if (textOnly) {
    if (value.outputShape.width !== null || value.outputShape.height !== null || value.outputShape.fps !== null || value.inputContract.aspectRatioKey !== null || value.inputContract.imageKey !== null || value.executionPriceUsd.basis !== "run" || value.maxQuantity !== 1) context.addIssue({ code: "custom", message: "Text qualification must pin a single-run, text-only contract." });
  } else if (!value.outputShape.width || !value.outputShape.height || !isNineSixteenDimensions(value.outputShape.width, value.outputShape.height) || !value.inputContract.aspectRatioKey || !value.inputContract.safety) context.addIssue({ code: "custom", message: "Media qualification must pin provider-documented 9:16 output dimensions and safety controls." });
  if (value.inputContract.safety?.parameterKey && value.inputContract.lockedParameters[value.inputContract.safety.parameterKey] !== value.inputContract.safety.safeValue) context.addIssue({ code: "custom", message: "The exact provider-safe value must be locked." });
});
const qualificationSchema = z.object({ version: z.literal(1), qualifications: z.array(z.object({ attestation: modelQualificationAttestationSchema, signature: z.object({ algorithm: z.literal("ed25519"), keyId: z.string().min(1).max(100), value: z.string().min(40).max(500) }).strict() }).strict()).max(100) }).strict();
const keySchema = z.record(z.string().min(1).max(100), z.string().min(40).max(10_000));

export function configuredCatalog(raw = process.env.REPLICATE_MODEL_QUALIFICATIONS_JSON, rawKeys = process.env.MODEL_QUALIFICATION_PUBLIC_KEYS_JSON, at = new Date()): readonly ModelDescriptor[] {
  if (!raw || !rawKeys) return CURATED_MODELS;
  let parsed: z.infer<typeof qualificationSchema>; let keys: z.infer<typeof keySchema>;
  try { parsed = qualificationSchema.parse(JSON.parse(raw)); keys = keySchema.parse(JSON.parse(rawKeys)); } catch { return CURATED_MODELS; }
  return CURATED_MODELS.map((item) => {
    const signed = parsed.qualifications.find((candidate) => candidate.attestation.provider === item.provider && candidate.attestation.model === item.model);
    if (!signed) return item;
    const value = signed.attestation; const issuedAt = new Date(value.issuedAt); const expiresAt = new Date(value.expiresAt); const publicKey = keys[signed.signature.keyId];
    const exactCapabilities = value.capabilities.every((capability) => item.capabilities.includes(capability)) && item.capabilities.every((capability) => value.capabilities.includes(capability));
    const exactLanguages = value.contentLanguages.every((language) => item.contentLanguages.includes(language)); const exactVarieties = value.arabicVarieties.every((variety) => item.arabicVarieties.includes(variety));
    let authentic = false;
    try { authentic = Boolean(publicKey) && verify(null, Buffer.from(canonicalJson(value)), createPublicKey(publicKey), Buffer.from(signed.signature.value, "base64url")); } catch { authentic = false; }
    if (!authentic || issuedAt > at || expiresAt <= at || expiresAt.getTime() - issuedAt.getTime() > 90 * 24 * 60 * 60_000 || !exactCapabilities || !exactLanguages || !exactVarieties || !value.verifiedRegions.includes("replicate-us") || !value.executionModes.includes("async")) return item;
    const evidence = { id: value.id, revision: value.revision, digest: canonicalDigest(value) as `sha256:${string}`, issuedAt, expiresAt, signingKeyId: signed.signature.keyId, license: { ...value.license, digest: value.license.digest as `sha256:${string}` }, pricingSource: { ...value.pricingSource, digest: value.pricingSource.digest as `sha256:${string}`, checkedAt: new Date(value.pricingSource.checkedAt) }, qualificationRun: { ...value.qualificationRun, digest: value.qualificationRun.digest as `sha256:${string}`, completedAt: new Date(value.qualificationRun.completedAt) } };
    return { ...item, contentLanguages: value.contentLanguages, arabicVarieties: value.arabicVarieties, verifiedRegions: value.verifiedRegions, executionModes: value.executionModes, qualification: { status: "qualified" as const, endpoint: value.endpoint, version: value.version, inputSchemaDigest: value.inputSchemaDigest as `sha256:${string}`, executionPriceUsd: value.executionPriceUsd, maxQuantity: value.maxQuantity, cancelAfterSeconds: value.cancelAfterSeconds, outputShape: value.outputShape, inputContract: value.inputContract, evidence } };
  });
}
export function exactModelRef(model: ModelDescriptor): ExactModelRef | null { return model.qualification.status === "qualified" ? { provider: model.provider, model: model.model, version: model.qualification.version, inputSchemaDigest: model.qualification.inputSchemaDigest } : null; }
export function findCuratedModel(ref: ExactModelRef, catalog = configuredCatalog()): ModelDescriptor | null { return catalog.find((item) => item.provider === ref.provider && item.model === ref.model && item.qualification.status === "qualified" && item.qualification.version === ref.version && item.qualification.inputSchemaDigest === ref.inputSchemaDigest) ?? null; }
