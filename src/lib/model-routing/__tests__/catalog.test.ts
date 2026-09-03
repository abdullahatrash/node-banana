import { describe, expect, it } from "vitest";
import { configuredCatalog, CURATED_MODELS, exactModelRef, findCuratedModel } from "../catalog";

describe("model qualification catalog", () => {
  it("publishes curated discovery defaults as non-executable", () => {
    expect(CURATED_MODELS).not.toHaveLength(0);
    expect(CURATED_MODELS.every((model) => model.qualification.status === "unqualified")).toBe(true);
    expect(CURATED_MODELS.map((model) => JSON.stringify(model)).join("\n")).not.toContain("pinned-2026");
    expect(CURATED_MODELS.map((model) => JSON.stringify(model)).join("\n")).not.toMatch(/sha256:0{50,}/);
  });

  it("qualifies only exact server-configured immutable evidence", () => {
    const model = CURATED_MODELS[0]!;
    const digest = `sha256:${"a1".repeat(32)}`;
    const catalog = configuredCatalog(JSON.stringify({ [`${model.provider}:${model.model}`]: { endpoint: "official_model", version: "operator-reviewed-version-1", inputSchemaDigest: digest, executionPriceUsd: { basis: "image", amount: 0.123 }, maxQuantity: 4, inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: null, imageMode: "single", safety: { parameterKey: "safety_filter", safeValue: true }, lockedParameters: { safety_filter: true, mode: "standard", resolution: "1080p" } } } }));
    const ref = exactModelRef(catalog[0]!);
    expect(ref).not.toBeNull();
    expect(findCuratedModel(ref!, catalog)).toBe(catalog[0]);
    expect(exactModelRef(catalog[1]!)).toBeNull();
  });

  it("rejects qualification that does not lock safety filtering on", () => {
    const model = CURATED_MODELS[0]!;
    const raw = JSON.stringify({ [`${model.provider}:${model.model}`]: { endpoint: "versioned", version: "operator-reviewed-version-1", inputSchemaDigest: `sha256:${"ab".repeat(32)}`, executionPriceUsd: { basis: "image", amount: 0.1 }, maxQuantity: 1, inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: null, imageMode: "single", safety: { parameterKey: "safety_filter", safeValue: true }, lockedParameters: { safety_filter: false } } } });
    expect(configuredCatalog(raw).every((item) => item.qualification.status === "unqualified")).toBe(true);
  });
  it("accepts negative safety keys only at their exact safe value", () => {
    const model = CURATED_MODELS[0]!;
    const configured = configuredCatalog(JSON.stringify({ [`${model.provider}:${model.model}`]: { endpoint: "versioned", version: "operator-reviewed-version-1", inputSchemaDigest: `sha256:${"cd".repeat(32)}`, executionPriceUsd: { basis: "image", amount: 0.1 }, maxQuantity: 1, inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: null, imageMode: "single", safety: { parameterKey: "disable_safety_filter", safeValue: false }, lockedParameters: { disable_safety_filter: false } } } }));
    expect(configured[0]?.qualification.status).toBe("qualified");
  });
});
