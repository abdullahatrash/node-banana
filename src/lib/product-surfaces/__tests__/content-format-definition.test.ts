import { describe, expect, it } from "vitest";
import { CONTENT_FORMATS } from "../definitions";
import { allContentFormatDefinitionsComplete, contentFormatDefinition } from "../content-format-definition";

describe("versioned Content Format Definitions", () => {
  it("completely governs every observed format including Custom", () => {
    expect(CONTENT_FORMATS).toHaveLength(12);
    expect(allContentFormatDefinitionsComplete()).toBe(true);
    expect(new Set(CONTENT_FORMATS.map((format) => contentFormatDefinition(format).id)).size).toBe(12);
  });

  it.each(CONTENT_FORMATS)("pins workflow, model policy, quote, proof, and editor behavior for %s", (format) => {
    const definition = contentFormatDefinition(format);
    expect(definition).toMatchObject({
      schema: "content-format-definition/v1",
      format,
      revision: 4,
      status: "active",
      languages: { unsupportedFallback: "block" },
      layout: { aspectRatios: ["9:16"], approximatePreview: true },
      managedQuote: { acceptance: "explicit_before_admission" },
      renderProof: { schema: "content-render-proof/v2", required: true },
      editorHandoff: { enabled: true, requiresPassedRenderProof: true },
    });
    if (format === "custom_upload") expect(definition.execution).toMatchObject({ strategy: "canonical_upload", workflow: null, modelPolicy: null });
    else expect(definition.execution).toMatchObject({ strategy: "admitted_generation", workflow: { revisionId: "builtin-2026-09-04-4", operation: `runtime.dispatch_content_${format}@1` }, modelPolicy: { revision: 4, qualifiedModelsOnly: true } });
  });

  it("keeps format-specific controls and provider inputs in the definition", () => {
    expect(contentFormatDefinition("talking_head_ugc").requiredControls).toEqual(expect.arrayContaining(["persona", "speaker", "scene", "captions"]));
    expect(contentFormatDefinition("green_screen_meme").sourceSlots).toEqual([
      expect.objectContaining({ type: "image", providerInputIndex: null }),
      expect.objectContaining({ type: "video", providerInputIndex: 1 }),
    ]);
    expect(contentFormatDefinition("slideshow").sourceSlots[0]).toMatchObject({ type: "image", minimum: 1, maximum: 20 });
    expect(contentFormatDefinition("slideshow").execution.workflow?.inputs).toEqual(expect.arrayContaining(["mediaSetRevisions", "themeInstructions"]));
  });
});
