import { describe, expect, it } from "vitest";
import { buildGenerationReadiness } from "../readiness";

describe("generation readiness projection", () => {
  it("counts only qualified models and returns capabilities in canonical order", () => {
    const result = buildGenerationReadiness({
      catalog: [
        { capabilities: ["video_to_video", "text_to_video"], qualification: { status: "qualified" } },
        { capabilities: ["text_generation", "text_to_video"], qualification: { status: "qualified" } },
        { capabilities: ["text_to_image"], qualification: { status: "unqualified" } },
      ],
      acceptedBrand: true,
      canonicalMediaStorage: true,
      processingRegion: true,
      byokCredential: false,
      managedCredential: true,
      managedCreditRate: true,
    });

    expect(result).toEqual({
      schema: "generation-readiness/v1",
      qualifiedModelCount: 2,
      qualifiedCapabilities: ["text_generation", "text_to_video", "video_to_video"],
      gates: {
        acceptedBrand: true,
        canonicalMediaStorage: true,
        processingRegion: true,
        byokCredential: false,
        managedCredential: true,
        managedCreditRate: true,
      },
    });
  });

  it("does not infer readiness from unqualified catalog entries", () => {
    const result = buildGenerationReadiness({
      catalog: [{ capabilities: ["text_to_image", "image_to_image"], qualification: { status: "unqualified" } }],
      acceptedBrand: false,
      canonicalMediaStorage: false,
      processingRegion: false,
      byokCredential: false,
      managedCredential: false,
      managedCreditRate: false,
    });

    expect(result.qualifiedModelCount).toBe(0);
    expect(result.qualifiedCapabilities).toEqual([]);
    expect(Object.values(result.gates)).toEqual([false, false, false, false, false, false]);
  });
});
