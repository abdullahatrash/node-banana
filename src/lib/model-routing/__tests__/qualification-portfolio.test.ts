import { describe, expect, it } from "vitest";
import { CURATED_MODELS } from "../catalog";
import {
  REQUIRED_REPLICATE_PORTFOLIO_CAPABILITIES,
  validateReplicateQualificationPortfolio,
} from "../qualification-portfolio";
import type { QualificationRunnerInput, QualificationSmokeCase } from "../qualification-runner";

const at = new Date("2026-09-05T12:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const sourceUrl = "https://assets.example.com/owned-source.png";

function plan(
  modelName: string,
  cases: QualificationSmokeCase[],
  price: { basis: "run" | "image" | "second"; amount: number },
): QualificationRunnerInput {
  const model = CURATED_MODELS.find((candidate) => candidate.model === modelName);
  if (!model) throw new Error(`missing fixture model ${modelName}`);
  const textOnly = model.capabilities.length === 1 && model.capabilities[0] === "text_generation";
  const needsImage = model.capabilities.some((capability) =>
    ["image_to_image", "image_to_video", "video_to_video"].includes(capability),
  );
  const imageKey = needsImage ? "image" : null;
  return {
    signingKeyId: "qualification-key",
    runId: `qualification-${modelName.replaceAll("/", "-")}`,
    attestation: {
      schema: "model-execution-qualification/v1",
      id: `qualification-${modelName.replaceAll("/", "-")}`,
      revision: 1,
      provider: "replicate",
      model: modelName,
      endpoint: "official",
      version: modelName,
      inputSchemaDigest: digest("a"),
      capabilities: [...model.capabilities],
      contentLanguages: ["ar", "en"],
      arabicVarieties: ["msa", "gulf"],
      verifiedRegions: ["replicate-us"],
      executionModes: ["async"],
      executionPriceUsd: price,
      maxQuantity: textOnly ? 1 : 10,
      cancelAfterSeconds: 900,
      outputShape: textOnly
        ? { width: null, height: null, fps: null }
        : { width: 720, height: 1280, fps: model.capabilities.some((capability) => capability.includes("video")) ? 24 : null },
      inputContract: textOnly
        ? { promptKey: "prompt", aspectRatioKey: null, quantityKey: null, imageKey: null, imageMode: "single", safety: null, lockedParameters: {} }
        : { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey, imageMode: "single", safety: { parameterKey: "safety_filter", safeValue: true }, lockedParameters: { safety_filter: true } },
      license: { name: "Reviewed commercial license", commercialUse: true, derivativeUse: true, sourceUrl: "https://replicate.com/terms", digest: digest("b") },
      pricingSource: { sourceUrl: "https://replicate.com/pricing", digest: digest("c"), checkedAt: "2026-09-05T10:00:00.000Z" },
      qualificationRun: { id: `pending-${modelName.replaceAll("/", "-")}`, digest: digest("d"), completedAt: "2026-09-05T10:00:00.000Z" },
      issuedAt: "2026-09-05T10:00:00.000Z",
      expiresAt: "2026-10-05T10:00:00.000Z",
    },
    cases,
  };
}

function smokeCase(
  id: string,
  capability: QualificationSmokeCase["capability"],
  contentLanguage: "ar" | "en",
  lifecycle: "complete" | "cancel",
  billableQuantity = 1,
): QualificationSmokeCase {
  const needsImage = ["image_to_image", "image_to_video", "video_to_video"].includes(capability);
  return {
    id,
    capability,
    contentLanguage,
    arabicVariety: contentLanguage === "ar" ? "msa" : null,
    prompt: contentLanguage === "ar" ? "أنشئ محتوى أصليًا للعلامة" : "Create original brand content",
    input: needsImage ? { image: sourceUrl } : {},
    billableQuantity,
    brandReference: { assetId: "owned-brand-reference", digest: digest("e"), url: "https://assets.example.com/brand.png" },
    lifecycle,
  };
}

function completePortfolio(priceMultiplier = 1) {
  return [
    plan("meta/meta-llama-3-8b-instruct", [
      smokeCase("copy-ar", "text_generation", "ar", "complete"),
      smokeCase("copy-en", "text_generation", "en", "cancel"),
      smokeCase("copy-gulf", "text_generation", "ar", "complete"),
    ], { basis: "run", amount: 0.001 * priceMultiplier }),
    plan("prunaai/p-image", [
      smokeCase("image-ar", "text_to_image", "ar", "complete"),
      smokeCase("image-en", "text_to_image", "en", "cancel"),
      smokeCase("image-gulf", "text_to_image", "ar", "complete"),
    ], { basis: "image", amount: 0.005 * priceMultiplier }),
    plan("prunaai/p-image-edit", [
      smokeCase("remix-ar", "image_to_image", "ar", "complete"),
      smokeCase("remix-en", "image_to_image", "en", "cancel"),
      smokeCase("remix-gulf", "image_to_image", "ar", "complete"),
    ], { basis: "image", amount: 0.01 * priceMultiplier }),
    plan("prunaai/p-video", [
      smokeCase("video-ar", "text_to_video", "ar", "complete"),
      smokeCase("video-remix-en", "image_to_video", "en", "cancel"),
      smokeCase("video-remix-ar", "image_to_video", "ar", "complete"),
    ], { basis: "second", amount: 0.005 * priceMultiplier }),
  ];
}

describe("Replicate qualification portfolio preflight", () => {
  it("proves the complete Arabic-first launch portfolio fits under one ceiling", () => {
    const result = validateReplicateQualificationPortfolio(completePortfolio(), at);
    expect(result.requiredCapabilities).toEqual(REQUIRED_REPLICATE_PORTFOLIO_CAPABILITIES);
    expect(result.coveredCapabilities).toEqual(expect.arrayContaining([...REQUIRED_REPLICATE_PORTFOLIO_CAPABILITIES]));
    expect(result.estimatedMaximumSpendUsd).toBe(0.063);
    expect(result.remainingHeadroomUsd).toBe(0.337);
  });

  it("rejects a partial portfolio even when every individual plan is valid", () => {
    expect(() => validateReplicateQualificationPortfolio(completePortfolio().slice(0, 3), at))
      .toThrow("QUALIFICATION_PORTFOLIO_CAPABILITY_REQUIRED:text_to_video");
  });

  it("rejects duplicate executions and an aggregate that reaches the account ceiling", () => {
    const plans = completePortfolio();
    expect(() => validateReplicateQualificationPortfolio([...plans, plans[0]!], at))
      .toThrow("QUALIFICATION_PORTFOLIO_RUN_ID_DUPLICATE");
    expect(() => validateReplicateQualificationPortfolio(completePortfolio(7), at))
      .toThrow("QUALIFICATION_PORTFOLIO_BUDGET_CAP_EXCEEDED");
  });
});
