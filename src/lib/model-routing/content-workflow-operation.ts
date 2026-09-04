import { z } from "zod";
import { WorkflowOperationRegistry } from "@/lib/agent-runtime/workflows/operation-registry";
import { CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";
import { contentFormatDefinition } from "@/lib/product-surfaces/content-format-definition";

const currentDefinitions = CONTENT_FORMATS.filter((format) => format !== "custom_upload").map((format) => {
  const workflow = contentFormatDefinition(format).execution.workflow!;
  return { identity: workflow.operation, lifecycle: "active" as const, inputs: Object.fromEntries(["guard", ...workflow.inputs].map((name) => [name, { kind: "text" as const, required: true }])), outputs: { receipt: "text" as const }, config: z.object({}).strict(), credentialRequirements: {}, retryBounds: { maxAttempts: 1, maxInitialMs: 0, maxBackoffMs: 0, maxMultiplier: 1, maxTotalDelayMs: 0 } };
});
const V3_INPUTS = {
  slideshow: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "captionStyle", "mediaSetIds", "themeRevisionRefs"],
  wall_of_text: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "captionStyle", "themeRevisionRefs"],
  video_hook_demo: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "scene", "captionStyle", "themeRevisionRefs"],
  speaking_hook_demo: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "speaker", "scene", "captionStyle", "themeRevisionRefs"],
  talking_head_ugc: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "speaker", "scene", "captionStyle", "personaId", "mediaSetIds", "themeRevisionRefs"],
  green_screen_meme: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "captionStyle", "themeRevisionRefs"],
  talking_head_green_screen: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "speaker", "captionStyle", "personaId", "themeRevisionRefs"],
  product_spokesperson: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "speaker", "scene", "captionStyle", "personaId", "mediaSetIds", "themeRevisionRefs"],
  green_screen_mobile_app: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "captionStyle", "themeRevisionRefs"],
  claymation: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "captionStyle", "mediaSetIds", "themeRevisionRefs"],
  character_swap: ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "prompt", "captionStyle", "personaId"],
} as const;
const historicalDefinitions = Object.entries(V3_INPUTS).map(([format, inputs]) => ({
  identity: `runtime.dispatch_content_${format}@1`, lifecycle: "deprecated" as const,
  inputs: Object.fromEntries(["guard", ...inputs].map((name) => [name, { kind: "text" as const, required: true }])),
  outputs: { receipt: "text" as const }, config: z.object({}).strict(), credentialRequirements: {},
  retryBounds: { maxAttempts: 1, maxInitialMs: 0, maxBackoffMs: 0, maxMultiplier: 1, maxTotalDelayMs: 0 },
}));
const v4Definitions = currentDefinitions.map((definition) => ({ ...definition, identity: definition.identity.replace(/@2$/, "@1"), lifecycle: "deprecated" as const }));
const definitions = [...historicalDefinitions, ...v4Definitions, ...currentDefinitions];
export const CONTENT_GENERATION_DISPATCH_OPERATIONS = [...new Map(definitions.map((definition) => {
  const operation = new WorkflowOperationRegistry([definition]).get(definition.identity)!;
  return [`${operation.identity}\u0000${operation.contractDigest}`, operation] as const;
})).values()];
export function contentGenerationDispatchOperation(identity: string, workflowInputs?: readonly string[]) {
  const candidates = CONTENT_GENERATION_DISPATCH_OPERATIONS.filter((operation) => operation.identity === identity);
  if (candidates.length === 1) return candidates[0];
  if (!workflowInputs) return undefined;
  const expected = ["guard", ...workflowInputs];
  return candidates.find((operation) => canonicalInputNames(operation.inputs, expected));
}

function canonicalInputNames(inputs: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(inputs);
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}
