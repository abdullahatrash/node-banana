import { CURATED_MODELS, exactModelRef, findCuratedModel } from "../catalog";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { ExactModelRef, ImmutableBrandContext, ModelDescriptor } from "../types";
import type { GenerationRegionAuthority } from "../generation-region";

export const QUALIFIED_TEST_MODELS: readonly ModelDescriptor[] = CURATED_MODELS.map((model, index) => ({
  ...model,
  qualification: {
    status: "qualified" as const,
    endpoint: "versioned" as const,
    version: `test-immutable-version-${index}`,
    inputSchemaDigest: `sha256:${(index + 1).toString(16).padStart(64, "0")}` as `sha256:${string}`,
    executionPriceUsd: { basis: model.priceUsd.basis, amount: model.priceUsd.basis === "second" ? 0.05 : model.priceUsd.amount },
    maxQuantity: 30,
    cancelAfterSeconds: 900,
    outputShape: { width: 1080, height: 1920, fps: model.capabilities.some((capability) => capability.endsWith("video")) ? 30 : null },
    inputContract: { promptKey: "prompt", brandContextKey: "brand_context", aspectRatioKey: "aspect_ratio", quantityKey: "duration", imageKey: "image", imageMode: "single" as const, safety: { parameterKey: "disable_safety_checker", safeValue: false }, lockedParameters: { disable_safety_checker: false, draft: false, resolution: "1080p", audio: false } },
    evidence: {
      id: `qualification-${index}`, revision: 1,
      digest: `sha256:${(index + 20).toString(16).padStart(64, "0")}` as `sha256:${string}`,
      issuedAt: new Date("2026-09-01T00:00:00.000Z"), expiresAt: new Date("2026-12-01T00:00:00.000Z"), signingKeyId: "test-key",
      license: { name: "Test commercial license", commercialUse: true, derivativeUse: true, sourceUrl: "https://example.com/license", digest: `sha256:${"a".repeat(64)}` as `sha256:${string}` },
      pricingSource: { sourceUrl: "https://example.com/pricing", digest: `sha256:${"b".repeat(64)}` as `sha256:${string}`, checkedAt: new Date("2026-09-01T00:00:00.000Z") },
      qualificationRun: { id: `qualification-run-${index}`, digest: `sha256:${"c".repeat(64)}` as `sha256:${string}`, completedAt: new Date("2026-09-01T00:00:00.000Z") },
    },
  },
}));

export const testRef = (index: number): ExactModelRef => exactModelRef(QUALIFIED_TEST_MODELS[index]!)!;
export const testQualification = (index: number) => {
  const model = QUALIFIED_TEST_MODELS[index];
  if (!model || model.qualification.status !== "qualified") throw new Error(`Test model ${index} is not qualified`);
  const evidence = model.qualification.evidence;
  return { id: evidence.id, revision: evidence.revision, digest: evidence.digest, expiresAt: evidence.expiresAt };
};
export const resolveTestModel = (ref: ExactModelRef) => findCuratedModel(ref, QUALIFIED_TEST_MODELS);
export const testOutputContract = (index: number, quantity = 8) => {
  const model = QUALIFIED_TEST_MODELS[index];
  if (!model || model.qualification.status !== "qualified") throw new Error(`Test model ${index} is not qualified`);
  return {
    mediaType: model.capabilities.includes("text_generation") ? "text" as const : model.capabilities.some((capability) => capability.endsWith("video")) ? "video" as const : "image" as const,
    aspectRatio: model.capabilities.includes("text_generation") ? null : "9:16" as const,
    width: model.qualification.outputShape.width,
    height: model.qualification.outputShape.height,
    durationSeconds: model.capabilities.some((capability) => capability.endsWith("video")) ? quantity : null,
    fps: model.qualification.outputShape.fps,
    safetyParameterKey: model.qualification.inputContract.safety?.parameterKey ?? null,
    safetyValue: model.qualification.inputContract.safety?.safeValue ?? null,
    lockedParametersDigest: canonicalDigest(model.qualification.inputContract.lockedParameters) as `sha256:${string}`,
  };
};
export const TEST_RIGHTS = { snapshotId: "rights", revision: 1, digest: `sha256:${"d".repeat(64)}` as `sha256:${string}`, basis: "owned" as const, permittedRemix: "transform" as const, evidence: [], sourceAssetIds: [] };
export const TEST_REMIX_BRIEF = { preserve: ["brand palette"], transform: ["composition"], avoid: ["logos from source"] };
export const TEST_CREDENTIAL_REF = { id: "provider-key-1", provider: "replicate" as const, updatedAt: "2026-09-03T00:00:00.000Z" };
export const TEST_REGION_ADMISSION = { policyId: "active", policyVersion: 1, evidenceDigest: `sha256:${"9".repeat(64)}` as `sha256:${string}`, region: "replicate-us", routeId: "provider:replicate", evidenceExpiresAt: new Date("2026-09-10T00:00:00.000Z") };
export const ALLOWING_TEST_REGION_AUTHORITY: GenerationRegionAuthority = { admit: async () => ({ kind: "admitted", evidence: structuredClone(TEST_REGION_ADMISSION) }), revalidate: async () => ({ kind: "admitted" }) };

export const testBrand = (profileId = "brand", revision = 1, acceptedAt = new Date("2026-09-01T00:00:00.000Z"), profileDigest = `sha256:${"a".repeat(64)}` as `sha256:${string}`) => {
  const value = {
    schema: "brand-context/v1" as const, profileId, revision, acceptedAt, contentLanguage: "mixed" as const,
    identity: { companyName: "Test brand", coreIdentity: "Trusted creative studio" }, offering: ["Creative services"],
    audiences: [{ name: "Creators", description: "MENA creators", weight: 1 }], benefits: ["Clear stories"], differentiators: ["Arabic-first"], positioning: "Useful and precise",
    voice: { descriptors: ["warm"], do: ["be clear"], doNot: ["make unsupported claims"] }, palette: ["#123456"],
    constraints: { prohibitedClaims: ["guaranteed results"], prohibitedTopics: [] }, contentAngles: ["practical education"], referenceAssets: [],
  };
  const context: ImmutableBrandContext = { ...value, digest: canonicalDigest(value) as `sha256:${string}` };
  return { profileId, revision, digest: profileDigest, acceptedAt, context };
};
