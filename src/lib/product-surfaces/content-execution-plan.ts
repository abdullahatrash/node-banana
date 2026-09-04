import type { GenerationCapability } from "@/lib/model-routing/types";
import { CONTENT_FORMATS, type ContentFormat } from "./definitions";
import { CONTENT_FORMAT_DEFINITIONS } from "./content-format-definition";

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
export const CONTENT_EXECUTION_PLANS = Object.fromEntries(CONTENT_FORMATS.map((format) => {
  const definition = CONTENT_FORMAT_DEFINITIONS[format];
  const sourceTypes = definition.sourceSlots.flatMap((slot) => Array.from({ length: slot.minimum }, () => slot.type));
  const providerSourceIndex = definition.sourceSlots.findIndex((slot) => slot.providerInputIndex !== null);
  return [format, {
    strategy: definition.execution.strategy,
    capability: definition.execution.capability,
    sourceTypes,
    providerSourceIndex: providerSourceIndex < 0 ? null : providerSourceIndex,
    requiresPersona: definition.requiredControls.includes("persona"),
  }];
})) as unknown as Record<ContentFormat, ContentExecutionPlan>;

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
  const slots = CONTENT_FORMAT_DEFINITIONS[input.format].sourceSlots;
  const minimum = slots.reduce((sum, slot) => sum + slot.minimum, 0);
  const maximum = slots.reduce((sum, slot) => sum + slot.maximum, 0);
  if (input.sources.length < minimum || input.sources.length > maximum) return { ok: false, code: "CONTENT_SOURCE_CARDINALITY_INVALID" };
  if (slots.length === 1 && input.sources.some((source) => source.type !== slots[0]!.type)) return { ok: false, code: "CONTENT_SOURCE_TYPE_INVALID" };
  if (slots.length > 1 && input.sources.some((source, index) => source.type !== slots[index]?.type)) return { ok: false, code: "CONTENT_SOURCE_TYPE_INVALID" };
  if (plan.requiresPersona && input.personaState !== "active") return { ok: false, code: "CONTENT_PERSONA_REQUIRED" };
  return { ok: true };
}

export function allContentFormatsHaveExecutionPlans(): boolean {
  return CONTENT_FORMATS.every((format) => Boolean(CONTENT_EXECUTION_PLANS[format]));
}
