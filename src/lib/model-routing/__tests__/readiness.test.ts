import { describe, expect, it } from "vitest";
import { buildGenerationReadiness, projectManagedGenerationReadiness } from "../readiness";

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

  it("projects only the gates required for managed execution", () => {
    const result = projectManagedGenerationReadiness({
      schema: "generation-readiness/v1",
      qualifiedModelCount: 1,
      qualifiedCapabilities: ["text_to_image", "image_to_image"],
      gates: {
        acceptedBrand: true,
        canonicalMediaStorage: true,
        processingRegion: false,
        byokCredential: false,
        managedCredential: false,
        managedCreditRate: true,
      },
    });

    expect(result).toEqual({
      ready: false,
      blockers: ["processingRegion", "managedCredential"],
      qualifiedCapabilities: ["text_to_image", "image_to_image"],
    });
  });

  it("requires at least one qualified capability before managed execution is ready", () => {
    const result = projectManagedGenerationReadiness({
      schema: "generation-readiness/v1",
      qualifiedModelCount: 0,
      qualifiedCapabilities: [],
      gates: {
        acceptedBrand: true,
        canonicalMediaStorage: true,
        processingRegion: true,
        byokCredential: false,
        managedCredential: true,
        managedCreditRate: true,
      },
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(["qualifiedModel"]);
  });
});
