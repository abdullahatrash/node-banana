import { describe, expect, it } from "vitest";

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { composeQualifiedProviderInput } from "../provider-input-composition";
import type { GenerationCapability, ImmutableBrandContext, ModelExecutionQualification } from "../types";
import { testBrand, testRef } from "./fixtures";

type Contract = Extract<ModelExecutionQualification, { status: "qualified" }>["inputContract"];

const reference = { assetId: "brand-logo", digest: `sha256:${"7".repeat(64)}` as const, kind: "logo" as const };
const sourceUrl = "https://workspace.invalid/source.png";
const brandUrl = "https://workspace.invalid/brand-logo.png";

function brandWithReference(): ImmutableBrandContext {
  const base = testBrand().context;
  const { digest: _ignored, ...undigested } = base;
  const value = { ...undigested, referenceAssets: [reference] };
  return { ...value, digest: canonicalDigest(value) as `sha256:${string}` };
}

function contract(imageMode: "single" | "array", imageKey: string | null = "image"): Contract {
  return {
    promptKey: "prompt",
    aspectRatioKey: "aspect_ratio",
    quantityKey: "duration",
    imageKey,
    imageMode,
    safety: { parameterKey: "disable_safety_checker", safeValue: false },
    lockedParameters: { disable_safety_checker: false, resolution: "1080p" },
  };
}

function compose(capability: GenerationCapability, input: { mode: "single" | "array"; source?: boolean }) {
  const brand = brandWithReference();
  return composeQualifiedProviderInput({
    rawPrompt: "Keep this original prompt unchanged.",
    brand,
    sourceAssetIds: input.source ? ["source-asset"] : [],
    sourceUrls: input.source ? [sourceUrl] : [],
    brandReferenceUrls: [{ assetId: reference.assetId, url: brandUrl }],
    model: testRef(0),
    capability,
    contract: contract(input.mode),
    aspectRatio: "9:16",
    quantity: 8,
  });
}

describe("qualified provider input composition", () => {
  it("conditions text-to-image on Brand reference media without replacing the prompt", () => {
    const result = compose("text_to_image", { mode: "single" });
    expect(result.providerInput).toMatchObject({ image: brandUrl, aspect_ratio: "9:16" });
    expect(result.providerInput.prompt).toMatch(/^Keep this original prompt unchanged\.\n\n\[TASMEEMAI_BRAND_CONTEXT_V1\]/);
    expect(result.providerInput).not.toHaveProperty("brand_context");
    expect(result.evidence).toMatchObject({ providerMediaAssetIds: [reference.assetId], brandMediaDisposition: "provider_input" });
  });

  it("gives the user source the single image slot and carries Brand evidence in prompt context for image-to-image", () => {
    const result = compose("image_to_image", { mode: "single", source: true });
    expect(result.providerInput.image).toBe(sourceUrl);
    expect(result.providerInput.prompt).toContain(reference.assetId);
    expect(result.providerInput.prompt).toContain(reference.digest);
    expect(result.evidence).toMatchObject({ providerMediaAssetIds: ["source-asset"], brandMediaDisposition: "prompt_context" });
  });

  it("conditions text-to-video on Brand media and pins the 9:16 input", () => {
    const result = compose("text_to_video", { mode: "array" });
    expect(result.providerInput).toMatchObject({ image: [brandUrl], aspect_ratio: "9:16", duration: 8 });
    expect(result.evidence.capability).toBe("text_to_video");
  });

  it("orders remix media before Brand media for image-to-video and is deterministic", () => {
    const first = compose("image_to_video", { mode: "array", source: true });
    const second = compose("image_to_video", { mode: "array", source: true });
    expect(first.providerInput.image).toEqual([sourceUrl, brandUrl]);
    expect(first.evidence.providerMediaAssetIds).toEqual(["source-asset", reference.assetId]);
    expect(first.providerInputDigest).toBe(second.providerInputDigest);
    expect(first.evidence.digest).toBe(second.evidence.digest);
  });

  it("fails closed when provider-native input mappings collide", () => {
    const brand = brandWithReference();
    expect(() => composeQualifiedProviderInput({
      rawPrompt: "Prompt",
      brand,
      sourceAssetIds: [],
      sourceUrls: [],
      brandReferenceUrls: [{ assetId: reference.assetId, url: brandUrl }],
      model: testRef(0),
      capability: "text_to_image",
      contract: { ...contract("single"), aspectRatioKey: "prompt" },
      aspectRatio: "9:16",
      quantity: 1,
    })).toThrow("PROVIDER_INPUT_KEY_COLLISION");
  });
});
