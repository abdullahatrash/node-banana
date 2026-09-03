import { CURATED_MODELS, exactModelRef, findCuratedModel } from "../catalog";
import type { ExactModelRef, ModelDescriptor } from "../types";

export const QUALIFIED_TEST_MODELS: readonly ModelDescriptor[] = CURATED_MODELS.map((model, index) => ({
  ...model,
  qualification: {
    status: "qualified" as const,
    endpoint: index % 2 ? "official_model" as const : "versioned" as const,
    version: `test-immutable-version-${index}`,
    inputSchemaDigest: `sha256:${(index + 1).toString(16).padStart(64, "0")}` as `sha256:${string}`,
  },
}));

export const testRef = (index: number): ExactModelRef => exactModelRef(QUALIFIED_TEST_MODELS[index]!)!;
export const resolveTestModel = (ref: ExactModelRef) => findCuratedModel(ref, QUALIFIED_TEST_MODELS);
