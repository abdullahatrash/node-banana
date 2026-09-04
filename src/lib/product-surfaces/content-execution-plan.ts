import type { GenerationCapability } from "@/lib/model-routing/types";
import { CONTENT_FORMATS, type ContentFormat } from "./definitions";
import { CONTENT_FORMAT_DEFINITIONS } from "./content-format-definition";
import type { ContentFormatDefinition } from "./content-format-definition";

export type ContentSourceType = "image" | "video";

export interface ContentExecutionPlan {
  strategy: "admitted_generation" | "canonical_upload";
  capability: Extract<GenerationCapability, "text_to_video" | "image_to_video" | "video_to_video"> | null;
  sourceTypes: readonly ContentSourceType[];
  providerSourceIndex: number | null;
  requiresPersona: boolean;
}

export function contentSourceSlotAssignment(
  definition: ContentFormatDefinition,
  sources: ReadonlyArray<{ type: string }>,
): number[] | null {
  const visit = (slotIndex: number, sourceIndex: number, assigned: number[]): number[] | null => {
    if (slotIndex === definition.sourceSlots.length) return sourceIndex === sources.length ? assigned : null;
    const slot = definition.sourceSlots[slotIndex]!;
    for (let count = slot.minimum; count <= slot.maximum; count++) {
      if (sourceIndex + count > sources.length) break;
      if (sources.slice(sourceIndex, sourceIndex + count).some((source) => source.type !== slot.type)) continue;
      const result = visit(slotIndex + 1, sourceIndex + count, [...assigned, ...Array.from({ length: count }, () => slotIndex)]);
      if (result) return result;
    }
    return null;
  };
  return visit(0, 0, []);
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

export function contentExecutionPlan(format: ContentFormat, definition: ContentFormatDefinition = CONTENT_FORMAT_DEFINITIONS[format]): ContentExecutionPlan {
  if (definition.format !== format) throw new Error("CONTENT_FORMAT_DEFINITION_MISMATCH");
  const providerSourceIndex = definition.sourceSlots.findIndex((slot) => slot.providerInputIndex !== null);
  return {
    strategy: definition.execution.strategy,
    capability: definition.execution.capability,
    sourceTypes: definition.sourceSlots.flatMap((slot) => Array.from({ length: slot.minimum }, () => slot.type)),
    providerSourceIndex: providerSourceIndex < 0 ? null : providerSourceIndex,
    requiresPersona: definition.requiredControls.includes("persona"),
  };
}

export function contentProviderSourceIds(format: ContentFormat, sources: Array<{ id: string; type: string }>, definition?: ContentFormatDefinition): string[] {
  const resolved = definition ?? CONTENT_FORMAT_DEFINITIONS[format];
  const assignment = contentSourceSlotAssignment(resolved, sources);
  if (!assignment) return [];
  return sources.filter((_source, index) => resolved.sourceSlots[assignment[index]!]!.providerInputIndex !== null).map((source) => source.id);
}

export function validateContentExecutionInput(input: {
  format: ContentFormat;
  sources: Array<{ id: string; type: string }>;
  personaState: string | null;
  definition?: ContentFormatDefinition;
}): { ok: true } | { ok: false; code: "CONTENT_SOURCE_CARDINALITY_INVALID" | "CONTENT_SOURCE_TYPE_INVALID" | "CONTENT_PERSONA_REQUIRED" } {
  const definition = input.definition ?? CONTENT_FORMAT_DEFINITIONS[input.format];
  const plan = contentExecutionPlan(input.format, definition);
  const slots = definition.sourceSlots;
  const minimum = slots.reduce((sum, slot) => sum + slot.minimum, 0);
  const maximum = slots.reduce((sum, slot) => sum + slot.maximum, 0);
  if (input.sources.length < minimum || input.sources.length > maximum) return { ok: false, code: "CONTENT_SOURCE_CARDINALITY_INVALID" };
  if (!contentSourceSlotAssignment(definition, input.sources)) return { ok: false, code: "CONTENT_SOURCE_TYPE_INVALID" };
  if (plan.requiresPersona && input.personaState !== "active") return { ok: false, code: "CONTENT_PERSONA_REQUIRED" };
  return { ok: true };
}

export function allContentFormatsHaveExecutionPlans(): boolean {
  return CONTENT_FORMATS.every((format) => Boolean(CONTENT_EXECUTION_PLANS[format]));
}
