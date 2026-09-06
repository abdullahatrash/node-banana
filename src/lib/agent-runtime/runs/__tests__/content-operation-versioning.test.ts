import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/model-routing/execute-admitted-generation", () => ({
  executeAdmittedGeneration: vi.fn(async () => ({ ok: true, status: 202, result: { kind: "accepted", operation: { id: "operation_1", state: "waiting_provider" }, provider: { state: "waiting_provider" } } })),
}));

import { canonicalJson } from "@/lib/agent-tools/canonical";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "@/lib/agent-runtime/workflows";
import { contentGenerationDispatchOperation } from "@/lib/model-routing/content-workflow-operation";
import { WorkflowRunExecutorRegistry } from "../executors";
import { contentFormatDefinition } from "@/lib/product-surfaces/content-format-definition";

const currentInputs = contentFormatDefinition("slideshow").execution.workflow!.inputs;
const v3Inputs = ["recipe", "durationSeconds", "aspectRatio", "contentLanguage", "arabicVariety", "orderedSources", "script", "prompt", "captionStyle", "mediaSetIds", "themeRevisionRefs"];

describe("Content Workflow operation versioning", () => {
  it.each([{ label: "v3", identity: "runtime.dispatch_content_slideshow@1", inputs: v3Inputs }, { label: "v4", identity: "runtime.dispatch_content_slideshow@1", inputs: currentInputs }, { label: "v5", identity: "runtime.dispatch_content_slideshow@2", inputs: currentInputs }])("resolves and executes the exact $label contract", async ({ identity, inputs: workflowInputNames }) => {
    const operation = contentGenerationDispatchOperation(identity, workflowInputNames)!;
    const boundary = { invoke: vi.fn(async () => { throw new Error("provider boundary must not run"); }) };
    const registry = WorkflowRunExecutorRegistry.createProduction(GOLDEN_WORKFLOW_OPERATION_REGISTRY, { text: boundary, image: boundary });
    const executor = registry.get(operation.identity, operation.contractDigest)!;
    const names = Object.keys(operation.inputs).filter((name) => name !== "guard" && name !== "recipe");
    const workflowInputs = Object.fromEntries(names.map((name) => [name, `${name}-value`]));
    const request = canonicalJson({ workspaceId: "workspace_1", userId: "user_1", role: "owner", planTier: "pro", intentId: "intent_1", prompt: "prompt", sourceAssetIds: [], idempotencyKey: "provider-run-1", workflowInputs });
    const inputs = { recipe: { textContent: request }, guard: { textContent: "guard" }, ...Object.fromEntries(names.map((name) => [name, { textContent: `${name}-value` }])) };
    const result = await executor.execute({ workspaceId: "workspace_1", runId: "run_1", step: { operation: { identity, contractDigest: operation.contractDigest }, inputs: Object.fromEntries(Object.keys(operation.inputs).map((name) => [name, {}])) }, inputs } as never);
    expect(result).toMatchObject({ kind: "generated", providerOperationRef: "intent_1" });
  });

  it("keeps v3, v4, and v5 contract digests distinct while preserving both historical @1 executors", () => {
    const v3 = contentGenerationDispatchOperation("runtime.dispatch_content_slideshow@1", v3Inputs)!;
    const v4 = contentGenerationDispatchOperation("runtime.dispatch_content_slideshow@1", currentInputs)!;
    const v5 = contentGenerationDispatchOperation("runtime.dispatch_content_slideshow@2", currentInputs)!;
    expect(v3.identity).toBe(v4.identity); expect(v3.contractDigest).not.toBe(v4.contractDigest);
    expect(v4.identity).not.toBe(v5.identity); expect(v4.contractDigest).not.toBe(v5.contractDigest);
  });
});
