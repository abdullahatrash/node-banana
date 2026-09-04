import type { GenerationCapability } from "@/lib/model-routing/types";
import { CONTENT_FORMATS, type ContentFormat } from "./definitions";

export type ContentSourceType = "image" | "video";

export interface ContentExecutionPlan {
  strategy: "admitted_generation" | "canonical_upload";
  capability: Extract<GenerationCapability, "text_to_video" | "image_to_video" | "video_to_video"> | null;
  sourceTypes: readonly ContentSourceType[];
  providerSourceIndex: number | null;
  requiresPersona: boolean;
}

/**
 * The format contract distinguishes all retained render inputs from the one
 * primary input supported by the qualified generation capability.
 */
export const CONTENT_EXECUTION_PLANS = {
  slideshow: { strategy: "admitted_generation", capability: "image_to_video", sourceTypes: ["image"], providerSourceIndex: 0, requiresPersona: false },
  wall_of_text: { strategy: "admitted_generation", capability: "video_to_video", sourceTypes: ["video"], providerSourceIndex: 0, requiresPersona: false },
  video_hook_demo: { strategy: "admitted_generation", capability: "video_to_video", sourceTypes: ["video"], providerSourceIndex: 0, requiresPersona: false },
  speaking_hook_demo: { strategy: "admitted_generation", capability: "video_to_video", sourceTypes: ["video"], providerSourceIndex: 0, requiresPersona: false },
  talking_head_ugc: { strategy: "admitted_generation", capability: "text_to_video", sourceTypes: [], providerSourceIndex: null, requiresPersona: true },
  green_screen_meme: { strategy: "admitted_generation", capability: "video_to_video", sourceTypes: ["image", "video"], providerSourceIndex: 1, requiresPersona: false },
  talking_head_green_screen: { strategy: "admitted_generation", capability: "video_to_video", sourceTypes: ["video"], providerSourceIndex: 0, requiresPersona: true },
  product_spokesperson: { strategy: "admitted_generation", capability: "image_to_video", sourceTypes: ["image"], providerSourceIndex: 0, requiresPersona: true },
  green_screen_mobile_app: { strategy: "admitted_generation", capability: "image_to_video", sourceTypes: ["image"], providerSourceIndex: 0, requiresPersona: false },
  claymation: { strategy: "admitted_generation", capability: "image_to_video", sourceTypes: ["image"], providerSourceIndex: 0, requiresPersona: false },
  character_swap: { strategy: "admitted_generation", capability: "video_to_video", sourceTypes: ["video"], providerSourceIndex: 0, requiresPersona: true },
  custom_upload: { strategy: "canonical_upload", capability: null, sourceTypes: ["video"], providerSourceIndex: null, requiresPersona: false },
} as const satisfies Record<ContentFormat, ContentExecutionPlan>;

export function contentExecutionPlan(format: ContentFormat): ContentExecutionPlan {
  return CONTENT_EXECUTION_PLANS[format];
}

export function contentProviderSourceIds(format: ContentFormat, sourceAssetIds: string[]): string[] {
  const plan = contentExecutionPlan(format);
  return plan.providerSourceIndex === null ? [] : [sourceAssetIds[plan.providerSourceIndex]!];
}

export function validateContentExecutionInput(input: {
  format: ContentFormat;
  sources: Array<{ id: string; type: string }>;
  personaState: string | null;
}): { ok: true } | { ok: false; code: "CONTENT_SOURCE_CARDINALITY_INVALID" | "CONTENT_SOURCE_TYPE_INVALID" | "CONTENT_PERSONA_REQUIRED" } {
  const plan = contentExecutionPlan(input.format);
  if (input.sources.length !== plan.sourceTypes.length) return { ok: false, code: "CONTENT_SOURCE_CARDINALITY_INVALID" };
  if (input.sources.some((source, index) => source.type !== plan.sourceTypes[index])) return { ok: false, code: "CONTENT_SOURCE_TYPE_INVALID" };
  if (plan.requiresPersona && input.personaState !== "active") return { ok: false, code: "CONTENT_PERSONA_REQUIRED" };
  return { ok: true };
}

export function allContentFormatsHaveExecutionPlans(): boolean {
  return CONTENT_FORMATS.every((format) => Boolean(CONTENT_EXECUTION_PLANS[format]));
}
