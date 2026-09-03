import { describe, expect, it } from "vitest";
import { configuredCatalog, CURATED_MODELS, exactModelRef, findCuratedModel } from "../catalog";

describe("model qualification catalog", () => {
  it("publishes curated discovery defaults as non-executable", () => {
    expect(CURATED_MODELS).not.toHaveLength(0);
    expect(CURATED_MODELS.every((model) => model.qualification.status === "unqualified")).toBe(true);
    expect(CURATED_MODELS.map(JSON.stringify).join("\n")).not.toContain("pinned-2026");
    expect(CURATED_MODELS.map(JSON.stringify).join("\n")).not.toMatch(/sha256:0{50,}/);
  });

  it("qualifies only exact server-configured immutable evidence", () => {
    const model = CURATED_MODELS[0]!;
    const digest = `sha256:${"a1".repeat(32)}`;
    const catalog = configuredCatalog(JSON.stringify({ [`${model.provider}:${model.model}`]: { endpoint: "official_model", version: "operator-reviewed-version-1", inputSchemaDigest: digest } }));
    const ref = exactModelRef(catalog[0]!);
    expect(ref).not.toBeNull();
    expect(findCuratedModel(ref!, catalog)).toBe(catalog[0]);
    expect(exactModelRef(catalog[1]!)).toBeNull();
  });
});
