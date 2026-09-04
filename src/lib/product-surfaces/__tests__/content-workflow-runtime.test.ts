import { describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { CONTENT_FORMATS } from "../definitions";
import { CONTENT_FORMAT_DEFINITIONS } from "../content-format-definition";
import { ContentGenerationWorkflowService, ContentWorkflowRuntimeError, type ContentWorkflowRuntimePort } from "../content-workflow-runtime";
import type { GenerationIntent, ModelDescriptor } from "@/lib/model-routing/types";
import { contentProviderPromptFromWorkflowInputs } from "../content-generation-recipe";

const modelRef = { provider: "replicate" as const, model: "qualified/model", version: "version_123", inputSchemaDigest: `sha256:${"a".repeat(64)}` };

function fixture(format: Exclude<(typeof CONTENT_FORMATS)[number], "custom_upload">) {
  const definition = CONTENT_FORMAT_DEFINITIONS[format];
  const capability = definition.execution.capability!;
  const sourceAssetIds = definition.sourceSlots.flatMap((slot, slotIndex) => Array.from({ length: slot.minimum }, (_, index) => `asset_${slotIndex}_${index}`));
  const workflowInputs = { format, script: `script:${format}`, prompt: `prompt:${format}`, speaker: `speaker:${format}`, scene: `scene:${format}`, captionStyle: "brand", personaId: definition.controls.includes("persona") ? "persona_1" : null, mediaSetIds: definition.controls.includes("media_sets") ? ["set_1"] : [], themeRevisionRefs: definition.controls.includes("theme") ? [{ themeId: "theme_1", revision: 2 }] : [], orderedSources: sourceAssetIds.map((assetId, index) => ({ assetId, type: definition.sourceSlots[index]?.type ?? definition.sourceSlots[0]?.type ?? "image", slotKey: definition.sourceSlots[index]?.key ?? definition.sourceSlots[0]?.key ?? "images", slotOrdinal: index })), durationSeconds: 5, aspectRatio: "9:16" as const, contentLanguage: "ar" as const, arabicVariety: "gulf" as const };
  const policyUnsigned = { schema: "content-model-policy/v1" as const, id: definition.execution.modelPolicy!.id, revision: 3, format, region: "replicate-us" as const, defaultModel: modelRef, compatibleModels: [modelRef], overrides: { mode: "explicit_exact_allowlist" as const, allowedFields: ["model"] as const, requireRequote: true as const } };
  const modelPolicy = { id: policyUnsigned.id, revision: 3, qualifiedModelsOnly: true as const, digest: canonicalDigest(policyUnsigned), region: "replicate-us", defaultModel: modelRef, compatibleModels: [modelRef], overrideMode: "explicit_exact_allowlist" as const };
  const unsigned = {
    schema: "content-format-execution-binding/v1" as const,
    contentPiece: { id: `piece_${format}`, revision: 2, digest: `sha256:${"b".repeat(64)}` as const },
    formatDefinition: { id: definition.id, revision: definition.revision, digest: `sha256:${"c".repeat(64)}` as const },
    workflow: { ...definition.execution.workflow!, inputs: [...definition.execution.workflow!.inputs] }, modelPolicy, workflowInputs,
    inputArtifactIds: sourceAssetIds, providerInputArtifactIds: sourceAssetIds,
  };
  const prompt = contentProviderPromptFromWorkflowInputs(workflowInputs);
  const intent = {
    id: `intent_${format}`, workspaceId: "workspace_1", createdByUserId: "user_1", promptDigest: canonicalDigest(prompt),
    selectedModel: modelRef, capability, contentLanguage: "ar", arabicVariety: "gulf",
    outputContract: { mediaType: "video", aspectRatio: "9:16" }, quote: { quantity: 5 }, rights: { sourceAssetIds },
    contentExecution: { ...unsigned, digest: canonicalDigest(unsigned) }, regionAdmission: { region: "replicate-us" },
  } as unknown as GenerationIntent;
  const descriptor = {
    provider: "replicate", model: modelRef.model, label: "Qualified", capabilities: [capability], quality: "standard",
    contentLanguages: ["ar", "en", "mixed"], arabicVarieties: ["msa", "gulf", "egyptian", "levantine", "maghrebi"], verifiedRegions: ["replicate-us"], executionModes: ["async"], aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.01 }, lane: "final",
    qualification: { status: "qualified", endpoint: "versioned", version: modelRef.version, inputSchemaDigest: modelRef.inputSchemaDigest, executionPriceUsd: { basis: "second", amount: 0.01 }, maxQuantity: 60, cancelAfterSeconds: 600, outputShape: { width: 1080, height: 1920, fps: 30 }, inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: "duration", imageKey: "image", imageMode: "array", safety: { parameterKey: "safety", safeValue: true }, lockedParameters: { safety: true } }, evidence: {} },
  } as unknown as ModelDescriptor;
  return { definition, intent, descriptor, sourceAssetIds, prompt };
}

function runtime() {
  const port: ContentWorkflowRuntimePort = {
    ensureRevision: vi.fn(async () => undefined),
    start: vi.fn(async (input) => ({ run: { id: `run_${input.workflowId}`, workflowId: input.workflowId, workflowRevisionId: input.revisionId, state: "accepted" as const, startSnapshotDigest: `sha256:${"d".repeat(64)}`, acceptedAt: new Date().toISOString() }, inspect: { capability: "workflow_runs.get@1" as const, input: { workflowId: input.workflowId, runId: `run_${input.workflowId}` } }, events: { capability: "workflow_run_events.list@1" as const, input: { workflowId: input.workflowId, runId: `run_${input.workflowId}`, cursor: "cursor" } } })),
    bind: vi.fn(async () => undefined),
  };
  return port;
}

describe("pinned Content Workflow execution", () => {
  it("starts the exact canonical Workflow Revision for every generated format and preserves ordered inputs", async () => {
    const generated = CONTENT_FORMATS.filter((format) => format !== "custom_upload");
    const workflowSignatures = new Set<string>();
    expect(generated).toHaveLength(11);
    for (const format of generated) {
      const value = fixture(format);
      const port = runtime();
      await new ContentGenerationWorkflowService(port).start({ workspaceId: "workspace_1", userId: "user_1", authContextId: "auth_1", role: "owner", planTier: "pro", ...value, idempotencyKey: `execute-${format}`, servicePrincipalId: "agent_content", serviceKeyId: "key_content" });
      expect(port.start).toHaveBeenCalledOnce();
      const call = vi.mocked(port.start).mock.calls[0]![0];
      expect([call.workflowId, call.revisionId]).toEqual([value.definition.execution.workflow!.id, value.definition.execution.workflow!.revisionId]);
      const request = JSON.parse(call.inputs.recipe as string);
      expect(request.orderedInputArtifactIds).toEqual(value.sourceAssetIds);
      expect(request.selectedModel).toEqual(modelRef);
      expect(request.modelPolicy).toEqual(value.intent.contentExecution!.modelPolicy);
      expect(Object.keys(call.inputs).sort()).toEqual([...value.definition.execution.workflow!.inputs].sort());
      expect(call.inputs.script ?? "").toBe(value.definition.execution.workflow!.inputs.includes("script") ? value.intent.contentExecution!.workflowInputs.script : "");
      expect(call.inputs.speaker ?? "").toBe(value.definition.execution.workflow!.inputs.includes("speaker") ? value.intent.contentExecution!.workflowInputs.speaker : "");
      expect(JSON.parse(call.inputs.orderedSources as string)).toEqual(value.intent.contentExecution!.workflowInputs.orderedSources);
      workflowSignatures.add(`${value.definition.execution.workflow!.operation}:${Object.keys(call.inputs).sort().join(",")}`);
    }
    expect(workflowSignatures.size).toBe(11);
  });

  it("keeps Custom on canonical import and rejects a model outside the exact policy", async () => {
    const generated = fixture("slideshow");
    const port = runtime();
    const incompatible = { ...generated.descriptor, model: "other/model" };
    await expect(new ContentGenerationWorkflowService(port).start({ workspaceId: "workspace_1", userId: "user_1", authContextId: "auth_1", role: "owner", planTier: "pro", ...generated, descriptor: incompatible, idempotencyKey: "execute-slideshow", servicePrincipalId: "agent", serviceKeyId: "key" })).rejects.toMatchObject({ code: "CONTENT_MODEL_POLICY_MODEL_NOT_QUALIFIED" });
    const custom = CONTENT_FORMAT_DEFINITIONS.custom_upload;
    await expect(new ContentGenerationWorkflowService(port).start({ workspaceId: "workspace_1", userId: "user_1", authContextId: "auth_1", role: "owner", planTier: "pro", intent: generated.intent, definition: custom, descriptor: generated.descriptor, prompt: generated.prompt, sourceAssetIds: generated.sourceAssetIds, idempotencyKey: "execute-custom", servicePrincipalId: "agent", serviceKeyId: "key" })).rejects.toBeInstanceOf(ContentWorkflowRuntimeError);
    expect(port.start).not.toHaveBeenCalled();
  });
});
