import { describe, expect, it } from "vitest";
import { CONTENT_FORMATS } from "../definitions";
import { allContentFormatsHaveExecutionPlans, contentExecutionPlan, contentProviderSourceIds, validateContentExecutionInput } from "../content-execution-plan";
import { contentFormatDefinition } from "../content-format-definition";

describe("Content Format execution plans", () => {
  it("covers all twelve formats with governed execution", () => {
    expect(CONTENT_FORMATS).toHaveLength(12);
    expect(allContentFormatsHaveExecutionPlans()).toBe(true);
    expect(CONTENT_FORMATS.filter((format) => contentExecutionPlan(format).strategy === "admitted_generation")).toHaveLength(11);
    expect(contentExecutionPlan("custom_upload")).toMatchObject({ strategy: "canonical_upload", capability: null });
  });

  it.each([
    ["slideshow", "image_to_video", ["image"], 0],
    ["wall_of_text", "video_to_video", ["video"], 0],
    ["video_hook_demo", "video_to_video", ["video"], 0],
    ["speaking_hook_demo", "video_to_video", ["video"], 0],
    ["talking_head_ugc", "text_to_video", [], null],
    ["green_screen_meme", "video_to_video", ["image", "video"], 1],
    ["talking_head_green_screen", "video_to_video", ["video"], 0],
    ["product_spokesperson", "image_to_video", ["image"], 0],
    ["green_screen_mobile_app", "image_to_video", ["image"], 0],
    ["claymation", "image_to_video", ["image"], 0],
    ["character_swap", "video_to_video", ["video"], 0],
  ] as const)("maps %s to its exact provider capability", (format, capability, sourceTypes, providerIndex) => {
    expect(contentExecutionPlan(format)).toMatchObject({ capability, sourceTypes, providerSourceIndex: providerIndex });
  });

  it("retains supplementary green-screen inputs while sending only the primary video", () => {
    expect(contentProviderSourceIds("green_screen_meme", [{ id: "background-image", type: "image" }, { id: "source-video", type: "video" }])).toEqual(["source-video"]);
  });

  it("rejects wrong order, missing source, and inactive persona", () => {
    expect(validateContentExecutionInput({ format: "green_screen_meme", sources: [{ id: "v", type: "video" }, { id: "i", type: "image" }], personaState: null })).toMatchObject({ ok: false, code: "CONTENT_SOURCE_TYPE_INVALID" });
    expect(validateContentExecutionInput({ format: "slideshow", sources: [], personaState: null })).toMatchObject({ ok: false, code: "CONTENT_SOURCE_CARDINALITY_INVALID" });
    expect(validateContentExecutionInput({ format: "character_swap", sources: [{ id: "v", type: "video" }], personaState: "suspended" })).toMatchObject({ ok: false, code: "CONTENT_PERSONA_REQUIRED" });
  });

  it("accepts the definition-owned Slideshow source range without widening other formats", () => {
    expect(validateContentExecutionInput({ format: "slideshow", sources: Array.from({ length: 2 }, (_, index) => ({ id: `image-${index}`, type: "image" })), personaState: null })).toEqual({ ok: true });
    expect(validateContentExecutionInput({ format: "slideshow", sources: Array.from({ length: 20 }, (_, index) => ({ id: `image-${index}`, type: "image" })), personaState: null })).toEqual({ ok: true });
    expect(contentProviderSourceIds("slideshow", Array.from({ length: 20 }, (_, index) => ({ id: `image-${index}`, type: "image" })))).toHaveLength(20);
    expect(validateContentExecutionInput({ format: "slideshow", sources: Array.from({ length: 21 }, (_, index) => ({ id: `image-${index}`, type: "image" })), personaState: null })).toMatchObject({ ok: false, code: "CONTENT_SOURCE_CARDINALITY_INVALID" });
  });

  it.each(["product_spokesperson", "claymation"] as const)("preserves all eight ordered inputs for %s", (format) => {
    const sources = Array.from({ length: 8 }, (_, index) => ({ id: `${format}-${index}`, type: "image" }));
    expect(validateContentExecutionInput({ format, sources, personaState: format === "product_spokesperson" ? "active" : null })).toEqual({ ok: true });
    expect(contentProviderSourceIds(format, sources)).toEqual(sources.map((source) => source.id));
  });

  it("derives runtime source validation and provider routing from the supplied pinned definition", () => {
    const pinned = {
      ...contentFormatDefinition("slideshow"),
      revision: 9,
      sourceSlots: [{ key: "video" as const, type: "video" as const, minimum: 1, maximum: 1, providerInputIndex: 0 }],
      execution: { ...contentFormatDefinition("slideshow").execution, capability: "video_to_video" as const },
    };
    expect(contentExecutionPlan("slideshow", pinned)).toMatchObject({ capability: "video_to_video", sourceTypes: ["video"] });
    expect(validateContentExecutionInput({ format: "slideshow", definition: pinned, sources: [{ id: "video", type: "video" }], personaState: null })).toEqual({ ok: true });
    expect(contentProviderSourceIds("slideshow", [{ id: "video", type: "video" }], pinned)).toEqual(["video"]);
  });
});
