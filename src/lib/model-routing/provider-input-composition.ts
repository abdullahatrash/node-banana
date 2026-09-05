import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import type { ExactModelRef, GenerationCapability, ImmutableBrandContext, ModelExecutionQualification } from "./types";

export const BRAND_PROMPT_COMPOSITION_VERSION = "tasmeemai-brand-prompt/v1" as const;
export const BRAND_MEDIA_COMPOSITION_VERSION = "tasmeemai-brand-media/v1" as const;

type QualifiedContract = Extract<ModelExecutionQualification, { status: "qualified" }>["inputContract"];

export type ProviderCompositionEvidence = {
  schema: "provider-input-composition/v1";
  promptVersion: typeof BRAND_PROMPT_COMPOSITION_VERSION;
  mediaVersion: typeof BRAND_MEDIA_COMPOSITION_VERSION;
  rawPromptDigest: `sha256:${string}`;
  brandContextDigest: `sha256:${string}`;
  composedPromptDigest: `sha256:${string}`;
  sourceAssetIds: string[];
  brandReferenceAssets: Array<{ assetId: string; digest: `sha256:${string}`; kind: "logo" }>;
  providerMediaAssetIds: string[];
  brandMediaDisposition: "provider_input" | "prompt_context" | "provider_input_and_prompt_context";
  model: ExactModelRef;
  capability: GenerationCapability;
  contractDigest: `sha256:${string}`;
  digest: `sha256:${string}`;
};

type BrandPromptContext = Pick<ImmutableBrandContext,
  "schema" | "profileId" | "revision" | "contentLanguage" | "identity" | "offering" | "audiences" |
  "benefits" | "differentiators" | "positioning" | "voice" | "palette" | "constraints" | "contentAngles" |
  "referenceAssets" | "digest"
>;

function digest(value: unknown) {
  return canonicalDigest(value) as `sha256:${string}`;
}

export function providerMediaPlan(input: { sourceAssetIds: string[]; brand: BrandPromptContext; contract: QualifiedContract; capability: GenerationCapability }) {
  const brandIds = input.brand.referenceAssets.map((asset) => asset.assetId);
  if (!input.contract.imageKey) return { providerMediaAssetIds: [] as string[], brandMediaDisposition: "prompt_context" as const };
  if (input.capability === "text_to_image" || input.capability === "text_to_video" || input.capability === "text_generation") {
    return { providerMediaAssetIds: [] as string[], brandMediaDisposition: "prompt_context" as const };
  }
  if (input.contract.imageMode === "array") return { providerMediaAssetIds: [...input.sourceAssetIds, ...brandIds], brandMediaDisposition: "provider_input" as const };
  if (input.sourceAssetIds.length) return { providerMediaAssetIds: [input.sourceAssetIds[0]!], brandMediaDisposition: "prompt_context" as const };
  return {
    providerMediaAssetIds: brandIds.slice(0, 1),
    brandMediaDisposition: brandIds.length > 1
      ? "provider_input_and_prompt_context" as const
      : brandIds.length
        ? "provider_input" as const
        : "prompt_context" as const,
  };
}

/** Brand context is composed into the prompt instead of being assigned to a
 * guessed provider-native field. The caller's prompt remains the exact prefix. */
export function composeBrandPrompt(rawPrompt: string, brand: BrandPromptContext) {
  const context = canonicalJson({
    schema: BRAND_PROMPT_COMPOSITION_VERSION,
    brand: {
      profileId: brand.profileId,
      revision: brand.revision,
      contentLanguage: brand.contentLanguage,
      identity: brand.identity,
      offering: brand.offering,
      audiences: brand.audiences,
      benefits: brand.benefits,
      differentiators: brand.differentiators,
      positioning: brand.positioning,
      voice: brand.voice,
      palette: brand.palette,
      constraints: brand.constraints,
      contentAngles: brand.contentAngles,
      referenceAssets: brand.referenceAssets,
      contextDigest: brand.digest,
    },
  });
  return `${rawPrompt}\n\n[TASMEEMAI_BRAND_CONTEXT_V1]\n${context}`;
}

export function createProviderCompositionEvidence(input: {
  rawPrompt: string;
  brand: BrandPromptContext;
  sourceAssetIds: string[];
  model: ExactModelRef;
  capability: GenerationCapability;
  contract: QualifiedContract;
}): ProviderCompositionEvidence {
  const composedPrompt = composeBrandPrompt(input.rawPrompt, input.brand);
  const mediaPlan = providerMediaPlan(input);
  const evidenceWithoutDigest = {
    schema: "provider-input-composition/v1" as const,
    promptVersion: BRAND_PROMPT_COMPOSITION_VERSION,
    mediaVersion: BRAND_MEDIA_COMPOSITION_VERSION,
    rawPromptDigest: digest(input.rawPrompt),
    brandContextDigest: input.brand.digest,
    composedPromptDigest: digest(composedPrompt),
    sourceAssetIds: [...input.sourceAssetIds],
    brandReferenceAssets: input.brand.referenceAssets.map((asset) => ({ ...asset })),
    ...mediaPlan,
    model: structuredClone(input.model),
    capability: input.capability,
    contractDigest: digest(input.contract),
  };
  return { ...evidenceWithoutDigest, digest: digest(evidenceWithoutDigest) };
}

export function composeQualifiedProviderInput(input: {
  rawPrompt: string;
  brand: BrandPromptContext;
  sourceAssetIds: string[];
  sourceUrls: string[];
  brandReferenceUrls: Array<{ assetId: string; url: string }>;
  model: ExactModelRef;
  capability: GenerationCapability;
  contract: QualifiedContract;
  aspectRatio: "9:16" | null;
  quantity: number;
  baseInput?: Record<string, unknown>;
}) {
  if (input.sourceAssetIds.length !== input.sourceUrls.length) throw new Error("PROVIDER_SOURCE_BINDING_MISMATCH");
  if (input.brand.referenceAssets.length !== input.brandReferenceUrls.length || input.brandReferenceUrls.some((item, index) => item.assetId !== input.brand.referenceAssets[index]?.assetId)) throw new Error("PROVIDER_BRAND_MEDIA_BINDING_MISMATCH");
  const mappedKeys = [input.contract.promptKey, input.contract.aspectRatioKey, input.contract.quantityKey, input.contract.imageKey, input.contract.safety?.parameterKey].filter((value): value is string => Boolean(value));
  if (new Set(mappedKeys).size !== mappedKeys.length || mappedKeys.some((key) => key in input.contract.lockedParameters && key !== input.contract.safety?.parameterKey)) throw new Error("PROVIDER_INPUT_KEY_COLLISION");
  const providerInput: Record<string, unknown> = { ...structuredClone(input.baseInput ?? {}), ...structuredClone(input.contract.lockedParameters) };
  for (const key of mappedKeys) delete providerInput[key];
  providerInput[input.contract.promptKey] = composeBrandPrompt(input.rawPrompt, input.brand);
  if (input.contract.aspectRatioKey && input.aspectRatio) providerInput[input.contract.aspectRatioKey] = input.aspectRatio;
  if (input.contract.quantityKey) providerInput[input.contract.quantityKey] = input.quantity;
  const mediaPlan = providerMediaPlan(input);
  if (input.contract.imageKey && mediaPlan.providerMediaAssetIds.length) {
    const urls = new Map([
      ...input.sourceAssetIds.map((assetId, index) => [assetId, input.sourceUrls[index]!] as const),
      ...input.brandReferenceUrls.map((item) => [item.assetId, item.url] as const),
    ]);
    const media = mediaPlan.providerMediaAssetIds.map((assetId) => urls.get(assetId));
    if (media.some((url) => !url)) throw new Error("PROVIDER_MEDIA_BINDING_MISMATCH");
    providerInput[input.contract.imageKey] = input.contract.imageMode === "array" ? media : media[0];
  }
  if (input.contract.safety?.parameterKey) providerInput[input.contract.safety.parameterKey] = input.contract.safety.safeValue;
  const evidence = createProviderCompositionEvidence(input);
  return { providerInput, evidence, providerInputDigest: digest(providerInput) };
}
