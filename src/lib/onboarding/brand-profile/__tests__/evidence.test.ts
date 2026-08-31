import { describe, expect, it } from "vitest";
import type { BrandProfileV1 } from "../../schemas";
import { buildEvidenceCatalog, validateProfileEvidence } from "../evidence";

describe("brand profile evidence", () => {
  it("creates deterministic hashes without changing the original language", () => {
    const first = buildEvidenceCatalog("source_1", "نص عربي موثوق.\n\nEnglish evidence.");
    const second = buildEvidenceCatalog("source_1", "نص عربي موثوق.\n\nEnglish evidence.");

    expect(first).toEqual(second);
    expect(first[0].excerpt).toBe("نص عربي موثوق.");
    expect(first[0].excerptHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects references that were not in the catalog", () => {
    const catalog = buildEvidenceCatalog("source_1", "Allowed evidence.");
    const profile: BrandProfileV1 = {
      schemaVersion: 1,
      contentLanguage: "en",
      identity: { companyName: "Brand", coreIdentity: "Identity", logoAssetId: null },
      offering: ["Offering"],
      audiences: [{ name: "Audience", description: "Description", weight: 100 }],
      problems: [],
      benefits: [],
      differentiators: [],
      mission: "Mission",
      positioning: "Positioning",
      ownedSpace: "Space",
      businessModel: "b2b",
      categories: ["saas"],
      voice: { descriptors: ["clear"], do: [], doNot: [] },
      prohibitedClaims: [],
      prohibitedTopics: [],
      competitors: [],
      contentAngles: [],
      uncertainties: ["Review this profile."],
      evidence: [{ sourceId: "source_1", excerptHash: `sha256:${"0".repeat(64)}` }],
      sourceIds: ["source_1"],
    };

    expect(validateProfileEvidence(profile, catalog)).toContainEqual(
      expect.stringContaining("unknown excerpt reference"),
    );
  });
});
