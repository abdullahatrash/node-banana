import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import type { WorkflowRunAcceptedDto } from "@/lib/agent-runtime/runs/types";
import type { ContentFormatDefinition } from "./content-format-definition";
import type { GenerationIntent, ModelDescriptor } from "@/lib/model-routing/types";
import { contentModelAllowed, validateContentModelPolicy, type ContentModelPolicy } from "./content-model-policy";
import { contentProviderPromptFromWorkflowInputs } from "./content-generation-recipe";

export class ContentWorkflowRuntimeError extends Error {
  constructor(readonly code: string) { super(code); }
}

export interface ContentWorkflowRuntimePort {
  ensureRevision(input: { workspaceId: string; definition: ContentFormatDefinition }): Promise<void>;
  start(input: {
    workspaceId: string; workflowId: string; revisionId: string; inputs: Record<string, unknown>;
    idempotencyKey: string; servicePrincipalId: string; serviceKeyId: string;
  }): Promise<WorkflowRunAcceptedDto>;
  bind(input: {
    workspaceId: string; intent: GenerationIntent; run: WorkflowRunAcceptedDto["run"];
    initiatedByUserId: string; initiatingAuthContextDigest: `sha256:${string}`;
  }): Promise<void>;
}

export function assertContentModelPolicy(input: {
  definition: ContentFormatDefinition; intent: GenerationIntent; descriptor: ModelDescriptor; policy?: ContentModelPolicy;
}): void {
  const { definition, intent, descriptor } = input;
  const policy = definition.execution.modelPolicy;
  if (!policy || policy.id !== `content.${definition.format}.v${definition.revision}` || policy.revision !== definition.revision || !policy.qualifiedModelsOnly) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_UNAVAILABLE");
  if (!intent.contentExecution?.modelPolicy.compatibleModels.some((model) => model.provider === intent.selectedModel.provider && model.model === intent.selectedModel.model && model.version === intent.selectedModel.version && model.inputSchemaDigest === intent.selectedModel.inputSchemaDigest)) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_MODEL_NOT_ALLOWED");
  if (intent.regionAdmission.region !== intent.contentExecution.modelPolicy.region) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_REGION_MISMATCH");
  if (input.policy && (!validateContentModelPolicy(input.policy) || input.policy.digest !== intent.contentExecution?.modelPolicy.digest || !contentModelAllowed(input.policy, intent.selectedModel))) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_MODEL_NOT_ALLOWED");
  if (input.policy && intent.regionAdmission.region !== input.policy.region) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_REGION_MISMATCH");
  if (descriptor.qualification.status !== "qualified" || descriptor.provider !== intent.selectedModel.provider || descriptor.model !== intent.selectedModel.model || descriptor.qualification.version !== intent.selectedModel.version || descriptor.qualification.inputSchemaDigest !== intent.selectedModel.inputSchemaDigest) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_MODEL_NOT_QUALIFIED");
  if (!descriptor.capabilities.includes(intent.capability) || !descriptor.contentLanguages.includes(intent.contentLanguage) || (intent.arabicVariety && !descriptor.arabicVarieties.includes(intent.arabicVariety))) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_INCOMPATIBLE");
  if (intent.outputContract.mediaType !== "text" && (!descriptor.aspectRatios.includes("9:16") || intent.outputContract.aspectRatio !== "9:16")) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_OUTPUT_CONTRACT_MISMATCH");
  if (intent.quote.quantity > descriptor.qualification.maxQuantity) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_QUANTITY_EXCEEDED");
}

export class ContentGenerationWorkflowService {
  constructor(private readonly runtime: ContentWorkflowRuntimePort) {}

  async start(input: {
    workspaceId: string; userId: string; authContextId: string; role: string; planTier: string;
    intent: GenerationIntent; definition: ContentFormatDefinition; descriptor: ModelDescriptor;
    prompt: string; sourceAssetIds: string[]; idempotencyKey: string;
    servicePrincipalId: string; serviceKeyId: string;
  }): Promise<WorkflowRunAcceptedDto> {
    const binding = input.intent.contentExecution;
    if (!binding || input.definition.execution.strategy !== "admitted_generation" || !input.definition.execution.workflow) throw new ContentWorkflowRuntimeError("CONTENT_CANONICAL_IMPORT_REQUIRED");
    if (input.definition.renderProof.schema !== "content-render-proof/v2") throw new ContentWorkflowRuntimeError("CONTENT_RENDER_PROOF_V2_REQUIRED");
    if (input.intent.workspaceId !== input.workspaceId || input.intent.createdByUserId !== input.userId) throw new ContentWorkflowRuntimeError("CONTENT_WORKFLOW_FORBIDDEN");
    if (canonicalDigest(input.prompt) !== input.intent.promptDigest || canonicalDigest(input.sourceAssetIds) !== canonicalDigest(input.intent.rights.sourceAssetIds)) throw new ContentWorkflowRuntimeError("CONTENT_WORKFLOW_INPUT_MISMATCH");
    if (contentProviderPromptFromWorkflowInputs(binding.workflowInputs) !== input.prompt) throw new ContentWorkflowRuntimeError("CONTENT_PROVIDER_CONTROLS_MISMATCH");
    if (binding.workflow.id !== input.definition.execution.workflow.id || binding.workflow.revisionId !== input.definition.execution.workflow.revisionId || binding.workflow.operation !== input.definition.execution.workflow.operation || canonicalDigest(binding.workflow.inputs) !== canonicalDigest(input.definition.execution.workflow.inputs) || binding.formatDefinition.id !== input.definition.id || binding.formatDefinition.revision !== input.definition.revision) throw new ContentWorkflowRuntimeError("CONTENT_WORKFLOW_REVISION_MISMATCH");
    assertContentModelPolicy({ definition: input.definition, intent: input.intent, descriptor: input.descriptor, policy: { schema: "content-model-policy/v1", id: binding.modelPolicy.id, revision: binding.modelPolicy.revision, format: input.definition.format, region: binding.modelPolicy.region as "replicate-us", defaultModel: binding.modelPolicy.defaultModel as ContentModelPolicy["defaultModel"], compatibleModels: binding.modelPolicy.compatibleModels as ContentModelPolicy["compatibleModels"], overrides: { mode: binding.modelPolicy.overrideMode, allowedFields: ["model"], requireRequote: true }, digest: binding.modelPolicy.digest } });
    await this.runtime.ensureRevision({ workspaceId: input.workspaceId, definition: input.definition });
    const request = canonicalJson({
      schema: "content-workflow-generation-request/v1", workspaceId: input.workspaceId,
      userId: input.userId, role: input.role, planTier: input.planTier, intentId: input.intent.id,
      contentPiece: binding.contentPiece, formatDefinition: binding.formatDefinition, workflow: binding.workflow,
      modelPolicy: binding.modelPolicy, selectedModel: input.intent.selectedModel, contentExecutionDigest: binding.digest,
      workflowInputs: binding.workflowInputs,
      prompt: input.prompt, sourceAssetIds: input.sourceAssetIds, orderedInputArtifactIds: binding.inputArtifactIds,
      providerInputArtifactIds: binding.providerInputArtifactIds, idempotencyKey: `${input.idempotencyKey}:provider`,
    });
    const encode = (value: unknown) => typeof value === "string" ? value : canonicalJson(value);
    const typedInputs = Object.fromEntries(input.definition.execution.workflow.inputs.map((name) => [name, name === "recipe" ? request : encode(binding.workflowInputs[name as keyof typeof binding.workflowInputs] ?? null)]));
    const accepted = await this.runtime.start({
      workspaceId: input.workspaceId, workflowId: binding.workflow.id, revisionId: binding.workflow.revisionId,
      inputs: typedInputs, idempotencyKey: `${input.idempotencyKey}:workflow`,
      servicePrincipalId: input.servicePrincipalId, serviceKeyId: input.serviceKeyId,
    });
    await this.runtime.bind({
      workspaceId: input.workspaceId, intent: input.intent, run: accepted.run, initiatedByUserId: input.userId,
      initiatingAuthContextDigest: canonicalDigest({ authContextId: input.authContextId }) as `sha256:${string}`,
    });
    return accepted;
  }
}
