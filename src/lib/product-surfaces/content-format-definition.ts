import { ARABIC_VARIETIES, CONTENT_FORMATS, type ContentFormat } from "./definitions";
import type { GenerationCapability } from "@/lib/model-routing/types";

export type ContentControl = "script" | "prompt" | "source_images" | "source_video" | "persona" | "app_capture" | "speaker" | "scene" | "captions" | "media_sets" | "theme";
export type ContentSourceSlot = { key: "images" | "video" | "app_capture"; type: "image" | "video"; minimum: number; maximum: number; providerInputIndex: number | null };

export interface ContentFormatDefinition {
  schema: "content-format-definition/v1";
  id: `content-format:${ContentFormat}`;
  revision: number;
  format: ContentFormat;
  status: "active";
  controls: readonly ContentControl[];
  requiredControls: readonly ContentControl[];
  sourceSlots: readonly ContentSourceSlot[];
  languages: { content: readonly ("ar" | "en" | "mixed")[]; arabicVarieties: typeof ARABIC_VARIETIES; unsupportedFallback: "block" };
  layout: { aspectRatios: readonly ["9:16"]; defaultAspectRatio: "9:16"; approximatePreview: true; safeAreaPreset: "short-form-v1" };
  duration: { minimumSeconds: number; maximumSeconds: number; defaultSeconds: number };
  captions: { required: boolean; styles: readonly ("brand" | "minimal" | "bold" | "karaoke")[]; bidiProofRequired: true; fontFallback: "block" };
  execution: {
    strategy: "admitted_generation" | "canonical_upload";
    capability: Extract<GenerationCapability, "text_to_video" | "image_to_video" | "video_to_video"> | null;
    workflow: { id: string; revisionId: string } | null;
    modelPolicy: { id: string; revision: number; qualifiedModelsOnly: true; advancedOverrides: "compatible_only" } | null;
  };
  managedQuote: { required: boolean; acceptance: "explicit_before_admission"; maximumQuantity: number };
  renderProof: { required: true; schema: "content-render-proof/v1" | "content-render-proof/v2"; verifies: readonly ["fonts", "bidi", "captions", "timing", "safe_areas"] };
  editorHandoff: { enabled: true; routeTemplate: "/editor/{assetId}"; requiresPassedRenderProof: true };
  outputs: readonly ["candidate_asset", "immutable_content_revision", "lineage_receipt"];
}

const IMAGE = (maximum = 1): ContentSourceSlot => ({ key: "images", type: "image", minimum: 1, maximum, providerInputIndex: 0 });
const VIDEO: ContentSourceSlot = { key: "video", type: "video", minimum: 1, maximum: 1, providerInputIndex: 0 };
const BACKGROUND: ContentSourceSlot = { key: "images", type: "image", minimum: 1, maximum: 1, providerInputIndex: null };
const APP_CAPTURE: ContentSourceSlot = { key: "app_capture", type: "image", minimum: 1, maximum: 1, providerInputIndex: 0 };

function define(format: ContentFormat, input: {
  controls: readonly ContentControl[];
  requiredControls: readonly ContentControl[];
  sourceSlots: readonly ContentSourceSlot[];
  capability: ContentFormatDefinition["execution"]["capability"];
  captions?: boolean;
  duration?: readonly [number, number, number];
}): ContentFormatDefinition {
  const generated = input.capability !== null;
  const duration = input.duration ?? [4, 60, 15];
  return {
    schema: "content-format-definition/v1",
    id: `content-format:${format}`,
    revision: 2,
    format,
    status: "active",
    controls: input.controls,
    requiredControls: input.requiredControls,
    sourceSlots: input.sourceSlots,
    languages: { content: ["ar", "en", "mixed"], arabicVarieties: ARABIC_VARIETIES, unsupportedFallback: "block" },
    layout: { aspectRatios: ["9:16"], defaultAspectRatio: "9:16", approximatePreview: true, safeAreaPreset: "short-form-v1" },
    duration: { minimumSeconds: duration[0], maximumSeconds: duration[1], defaultSeconds: duration[2] },
    captions: { required: input.captions ?? true, styles: ["brand", "minimal", "bold", "karaoke"], bidiProofRequired: true, fontFallback: "block" },
    execution: {
      strategy: generated ? "admitted_generation" : "canonical_upload",
      capability: input.capability,
      workflow: generated ? { id: `tasmeemai_content_${format}`, revisionId: "builtin-2026-09-04-2" } : null,
      modelPolicy: generated ? { id: `content.${format}.v2`, revision: 2, qualifiedModelsOnly: true, advancedOverrides: "compatible_only" } : null,
    },
    managedQuote: { required: generated, acceptance: "explicit_before_admission", maximumQuantity: 60 },
    renderProof: { required: true, schema: "content-render-proof/v2", verifies: ["fonts", "bidi", "captions", "timing", "safe_areas"] },
    editorHandoff: { enabled: true, routeTemplate: "/editor/{assetId}", requiresPassedRenderProof: true },
    outputs: ["candidate_asset", "immutable_content_revision", "lineage_receipt"],
  };
}

export const CONTENT_FORMAT_DEFINITIONS = {
  slideshow: define("slideshow", { controls: ["script", "prompt", "source_images", "captions", "media_sets", "theme"], requiredControls: ["script", "source_images", "captions"], sourceSlots: [IMAGE(20)], capability: "image_to_video" }),
  wall_of_text: define("wall_of_text", { controls: ["script", "prompt", "source_video", "captions", "theme"], requiredControls: ["script", "source_video", "captions"], sourceSlots: [VIDEO], capability: "video_to_video" }),
  video_hook_demo: define("video_hook_demo", { controls: ["script", "prompt", "source_video", "captions", "scene", "theme"], requiredControls: ["script", "source_video", "captions"], sourceSlots: [VIDEO], capability: "video_to_video" }),
  speaking_hook_demo: define("speaking_hook_demo", { controls: ["script", "prompt", "source_video", "speaker", "scene", "captions", "theme"], requiredControls: ["script", "source_video", "speaker", "captions"], sourceSlots: [VIDEO], capability: "video_to_video" }),
  talking_head_ugc: define("talking_head_ugc", { controls: ["script", "prompt", "persona", "speaker", "scene", "captions", "media_sets", "theme"], requiredControls: ["script", "persona", "speaker", "scene", "captions"], sourceSlots: [], capability: "text_to_video" }),
  green_screen_meme: define("green_screen_meme", { controls: ["script", "prompt", "source_images", "source_video", "captions", "theme"], requiredControls: ["script", "source_images", "source_video", "captions"], sourceSlots: [BACKGROUND, { ...VIDEO, providerInputIndex: 1 }], capability: "video_to_video" }),
  talking_head_green_screen: define("talking_head_green_screen", { controls: ["script", "prompt", "persona", "source_video", "speaker", "captions", "theme"], requiredControls: ["script", "persona", "source_video", "captions"], sourceSlots: [VIDEO], capability: "video_to_video" }),
  product_spokesperson: define("product_spokesperson", { controls: ["script", "prompt", "persona", "source_images", "speaker", "scene", "captions", "media_sets", "theme"], requiredControls: ["script", "persona", "source_images", "speaker", "captions"], sourceSlots: [IMAGE(8)], capability: "image_to_video" }),
  green_screen_mobile_app: define("green_screen_mobile_app", { controls: ["script", "prompt", "app_capture", "captions", "theme"], requiredControls: ["script", "app_capture", "captions"], sourceSlots: [APP_CAPTURE], capability: "image_to_video" }),
  claymation: define("claymation", { controls: ["script", "prompt", "source_images", "captions", "media_sets", "theme"], requiredControls: ["script", "source_images", "captions"], sourceSlots: [IMAGE(8)], capability: "image_to_video" }),
  character_swap: define("character_swap", { controls: ["prompt", "source_video", "persona", "captions"], requiredControls: ["source_video", "persona"], sourceSlots: [VIDEO], capability: "video_to_video", captions: false }),
  custom_upload: define("custom_upload", { controls: ["source_video", "captions", "theme"], requiredControls: ["source_video"], sourceSlots: [VIDEO], capability: null, captions: false }),
} as const satisfies Record<ContentFormat, ContentFormatDefinition>;

export function contentFormatDefinition(format: ContentFormat): ContentFormatDefinition {
  return CONTENT_FORMAT_DEFINITIONS[format];
}

export function allContentFormatDefinitionsComplete(): boolean {
  return CONTENT_FORMATS.every((format) => {
    const definition = contentFormatDefinition(format);
    return definition.format === format
      && definition.revision > 0
      && definition.layout.aspectRatios.includes("9:16")
      && definition.renderProof.verifies.length === 5
      && definition.outputs.length === 3
      && (definition.execution.strategy === "canonical_upload" || Boolean(definition.execution.workflow && definition.execution.modelPolicy));
  });
}
