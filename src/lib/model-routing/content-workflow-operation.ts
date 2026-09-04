import { z } from "zod";
import { WorkflowOperationRegistry } from "@/lib/agent-runtime/workflows/operation-registry";

export const CONTENT_GENERATION_DISPATCH_IDENTITY = "runtime.dispatch_admitted_generation@1";

const registry = new WorkflowOperationRegistry([{
  identity: CONTENT_GENERATION_DISPATCH_IDENTITY,
  lifecycle: "active",
  inputs: { request: { kind: "text", required: true }, guard: { kind: "text", required: true } },
  outputs: { receipt: "text" },
  config: z.object({}).strict(),
  credentialRequirements: {},
  retryBounds: { maxAttempts: 1, maxInitialMs: 0, maxBackoffMs: 0, maxMultiplier: 1, maxTotalDelayMs: 0 },
}]);

export const CONTENT_GENERATION_DISPATCH_OPERATION = registry.get(CONTENT_GENERATION_DISPATCH_IDENTITY)!;
