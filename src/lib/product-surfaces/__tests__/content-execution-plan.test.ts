import { describe, expect, it } from "vitest";
import { CONTENT_FORMATS } from "../definitions";
import { allContentFormatsHaveExecutionPlans, contentExecutionPlan, contentProviderSourceIds, validateContentExecutionInput } from "../content-execution-plan";

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
    expect(contentProviderSourceIds("green_screen_meme", ["background-image", "source-video"])).toEqual(["source-video"]);
  });

  it("rejects wrong order, missing source, and inactive persona", () => {
    expect(validateContentExecutionInput({ format: "green_screen_meme", sources: [{ id: "v", type: "video" }, { id: "i", type: "image" }], personaState: null })).toMatchObject({ ok: false, code: "CONTENT_SOURCE_TYPE_INVALID" });
    expect(validateContentExecutionInput({ format: "slideshow", sources: [], personaState: null })).toMatchObject({ ok: false, code: "CONTENT_SOURCE_CARDINALITY_INVALID" });
    expect(validateContentExecutionInput({ format: "character_swap", sources: [{ id: "v", type: "video" }], personaState: "suspended" })).toMatchObject({ ok: false, code: "CONTENT_PERSONA_REQUIRED" });
  });

  it("accepts the definition-owned Slideshow source range without widening other formats", () => {
    expect(validateContentExecutionInput({ format: "slideshow", sources: Array.from({ length: 20 }, (_, index) => ({ id: `image-${index}`, type: "image" })), personaState: null })).toEqual({ ok: true });
    expect(validateContentExecutionInput({ format: "slideshow", sources: Array.from({ length: 21 }, (_, index) => ({ id: `image-${index}`, type: "image" })), personaState: null })).toMatchObject({ ok: false, code: "CONTENT_SOURCE_CARDINALITY_INVALID" });
  });
});
