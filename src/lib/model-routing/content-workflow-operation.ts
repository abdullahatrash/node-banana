import { z } from "zod";
import { WorkflowOperationRegistry } from "@/lib/agent-runtime/workflows/operation-registry";
import { CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";
import { contentFormatDefinition } from "@/lib/product-surfaces/content-format-definition";

const definitions = CONTENT_FORMATS.filter((format) => format !== "custom_upload").map((format) => {
  const workflow = contentFormatDefinition(format).execution.workflow!;
  return { identity: workflow.operation, lifecycle: "active" as const, inputs: Object.fromEntries(["guard", ...workflow.inputs].map((name) => [name, { kind: "text" as const, required: true }])), outputs: { receipt: "text" as const }, config: z.object({}).strict(), credentialRequirements: {}, retryBounds: { maxAttempts: 1, maxInitialMs: 0, maxBackoffMs: 0, maxMultiplier: 1, maxTotalDelayMs: 0 } };
});
const registry = new WorkflowOperationRegistry(definitions);
export const CONTENT_GENERATION_DISPATCH_OPERATIONS = definitions.map((definition) => registry.get(definition.identity)!);
export function contentGenerationDispatchOperation(identity: string) { return registry.get(identity); }
