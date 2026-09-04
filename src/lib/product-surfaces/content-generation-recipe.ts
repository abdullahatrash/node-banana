import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import type { GenerationCapability, GenerationIntent } from "@/lib/model-routing/types";
import { contentPieceSchema, type ContentFormat } from "./definitions";
import { contentProviderSourceIds, contentSourceSlotAssignment } from "./content-execution-plan";
import type { ContentFormatDefinition } from "./content-format-definition";
import type { ContentModelPolicy } from "./content-model-policy";
import { compileThemeInstructions, type ResolvedMediaSetRevision, type ResolvedThemeRevision } from "./content-execution-resources";

export class ContentGenerationRecipeError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function buildContentGenerationRecipe(input: {
  contentPieceId: string;
  contentPieceRevision: number;
  contentPiecePayload: unknown;
  definition: ContentFormatDefinition;
  definitionDigest: `sha256:${string}`;
  sourceTypes: Map<string, string>;
  modelPolicy: ContentModelPolicy;
  resources?: { mediaSets: ResolvedMediaSetRevision[]; themes: ResolvedThemeRevision[]; orderedAssetIds: string[] };
}): NonNullable<GenerationIntent["contentExecution"]> {
  const payload = contentPieceSchema.parse(input.contentPiecePayload);
  if (payload.formatDefinition?.id !== input.definition.id || payload.formatDefinition.revision !== input.definition.revision || payload.formatDefinition.digest !== input.definitionDigest) throw new ContentGenerationRecipeError("CONTENT_FORMAT_DEFINITION_STALE");
  if (input.definition.execution.strategy !== "admitted_generation" || !input.definition.execution.workflow || !input.definition.execution.modelPolicy || !input.definition.execution.capability) throw new ContentGenerationRecipeError("CONTENT_CANONICAL_IMPORT_REQUIRED");
  if (input.definition.renderProof.schema !== "content-render-proof/v2") throw new ContentGenerationRecipeError("CONTENT_RENDER_PROOF_V2_REQUIRED");
  const resourceMediaRefs = (input.resources?.mediaSets ?? []).map(({ mediaSetId, revision, digest }) => ({ mediaSetId, revision, digest }));
  const resourceThemeRefs = (input.resources?.themes ?? []).map(({ themeId, revision, digest }) => ({ themeId, revision, digest }));
  if (canonicalDigest(resourceMediaRefs) !== canonicalDigest(payload.mediaSetRevisionRefs) || canonicalDigest(resourceThemeRefs) !== canonicalDigest(payload.themeRevisionRefs)) throw new ContentGenerationRecipeError("CONTENT_RESOURCE_BINDING_STALE");
  const orderedSources = payload.sourceAssetIds.map((id) => ({ id, type: input.sourceTypes.get(id) ?? "missing" }));
  const assignment = contentSourceSlotAssignment(input.definition, orderedSources);
  if (!assignment || payload.aspectRatio !== "9:16") throw new ContentGenerationRecipeError("CONTENT_EXECUTION_INPUTS_MISMATCH");
  const providerInputArtifactIds = contentProviderSourceIds(payload.format, orderedSources, input.definition);
  const value = {
    schema: "content-format-execution-binding/v1" as const,
    contentPiece: { id: input.contentPieceId, revision: input.contentPieceRevision, digest: canonicalDigest(payload) as `sha256:${string}` },
    formatDefinition: { id: input.definition.id, revision: input.definition.revision, digest: input.definitionDigest },
    workflow: { id: input.definition.execution.workflow.id, revisionId: input.definition.execution.workflow.revisionId, operation: input.definition.execution.workflow.operation, inputs: [...input.definition.execution.workflow.inputs] },
    modelPolicy: { id: input.modelPolicy.id, revision: input.modelPolicy.revision, qualifiedModelsOnly: true as const, digest: input.modelPolicy.digest, region: input.modelPolicy.region, defaultModel: input.modelPolicy.defaultModel, compatibleModels: input.modelPolicy.compatibleModels, overrideMode: input.modelPolicy.overrides.mode },
    workflowInputs: { format: payload.format, script: payload.script ?? "", prompt: payload.prompt ?? "", speaker: payload.speaker ?? "", scene: payload.scene ?? "", captionStyle: payload.captionStyle ?? "", personaId: payload.personaId, mediaSetRevisions: input.resources?.mediaSets ?? [], themeInstructions: compileThemeInstructions(input.resources?.themes ?? []), orderedSources: orderedSources.map((source, index) => ({ assetId: source.id, type: source.type, slotKey: input.definition.sourceSlots[assignment[index]!]!.key, slotOrdinal: assignment.slice(0, index + 1).filter((slot) => slot === assignment[index]).length - 1 })), durationSeconds: payload.durationSeconds, aspectRatio: "9:16" as const, contentLanguage: payload.contentLanguage, arabicVariety: payload.arabicVariety },
    inputArtifactIds: input.resources?.orderedAssetIds ?? [...payload.sourceAssetIds],
    providerInputArtifactIds,
  };
  return { ...value, digest: canonicalDigest(value) as `sha256:${string}` };
}

export function contentProviderPrompt(payloadValue: unknown, resources?: { mediaSets: ResolvedMediaSetRevision[]; themes: ResolvedThemeRevision[] }): string {
  const payload = contentPieceSchema.parse(payloadValue);
  return contentProviderPromptFromWorkflowInputs({ format: payload.format, script: payload.script ?? "", prompt: payload.prompt ?? "", speaker: payload.speaker ?? "", scene: payload.scene ?? "", captionStyle: payload.captionStyle ?? "", personaId: payload.personaId, mediaSetRevisions: resources?.mediaSets ?? [], themeInstructions: compileThemeInstructions(resources?.themes ?? []), orderedSources: payload.sourceAssetIds.map((assetId) => ({ assetId })), durationSeconds: payload.durationSeconds, aspectRatio: "9:16", contentLanguage: payload.contentLanguage, arabicVariety: payload.arabicVariety });
}

export function contentProviderPromptFromWorkflowInputs(input: Pick<NonNullable<GenerationIntent["contentExecution"]>["workflowInputs"], "format" | "script" | "prompt" | "speaker" | "scene" | "captionStyle" | "personaId" | "mediaSetRevisions" | "themeInstructions" | "durationSeconds" | "aspectRatio" | "contentLanguage" | "arabicVariety"> & { orderedSources: Array<{ assetId: string }> }): string {
  return canonicalJson({ schema: "content-provider-controls/v2", format: input.format, script: input.script, prompt: input.prompt, speaker: input.speaker, scene: input.scene, captionStyle: input.captionStyle, personaId: input.personaId, mediaSetRevisions: input.mediaSetRevisions, themeInstructions: input.themeInstructions, orderedSourceAssetIds: input.orderedSources.map((source) => source.assetId), durationSeconds: input.durationSeconds, aspectRatio: input.aspectRatio, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety });
}

export function assertContentGenerationRequest(input: {
  recipe: NonNullable<GenerationIntent["contentExecution"]>;
  format: ContentFormat;
  definition: ContentFormatDefinition;
  capability: GenerationCapability;
  sourceAssetIds: string[];
  personaId: string | null;
  payload: ReturnType<typeof contentPieceSchema.parse>;
}) {
  if (input.definition.format !== input.format || input.definition.execution.capability !== input.capability) throw new ContentGenerationRecipeError("CONTENT_EXECUTION_CAPABILITY_MISMATCH");
  if (canonicalDigest(input.recipe.inputArtifactIds) !== canonicalDigest(input.sourceAssetIds) || input.recipe.providerInputArtifactIds.some((id) => !input.sourceAssetIds.includes(id))) throw new ContentGenerationRecipeError("CONTENT_EXECUTION_INPUTS_MISMATCH");
  if ((input.payload.personaId ?? null) !== input.personaId) throw new ContentGenerationRecipeError("CONTENT_EXECUTION_PERSONA_MISMATCH");
}

export function validateContentGenerationRecipe(input: {
  recipe: NonNullable<GenerationIntent["contentExecution"]>;
  definition: ContentFormatDefinition;
  capability: GenerationCapability;
  rightsSourceAssetIds: string[];
  providerSourceAssetIds: string[];
}) {
  const { digest, ...unsigned } = input.recipe;
  return digest === canonicalDigest(unsigned)
    && input.recipe.formatDefinition.id === input.definition.id
    && input.recipe.formatDefinition.revision === input.definition.revision
    && input.recipe.workflow.id === input.definition.execution.workflow?.id
    && input.recipe.workflow.revisionId === input.definition.execution.workflow?.revisionId
    && input.recipe.workflow.operation === input.definition.execution.workflow?.operation
    && canonicalDigest(input.recipe.workflow.inputs) === canonicalDigest(input.definition.execution.workflow?.inputs)
    && input.recipe.modelPolicy.id === input.definition.execution.modelPolicy?.id
    && input.recipe.modelPolicy.revision === input.definition.execution.modelPolicy?.revision
    && input.definition.execution.modelPolicy?.qualifiedModelsOnly === true
    && input.recipe.modelPolicy.digest === canonicalDigest({ schema: "content-model-policy/v1", id: input.recipe.modelPolicy.id, revision: input.recipe.modelPolicy.revision, format: input.definition.format, region: input.recipe.modelPolicy.region, defaultModel: input.recipe.modelPolicy.defaultModel, compatibleModels: input.recipe.modelPolicy.compatibleModels, overrides: { mode: input.recipe.modelPolicy.overrideMode, allowedFields: ["model"], requireRequote: true } })
    && input.definition.execution.capability === input.capability
    && canonicalDigest(input.recipe.inputArtifactIds) === canonicalDigest(input.rightsSourceAssetIds)
    && canonicalDigest(input.recipe.providerInputArtifactIds) === canonicalDigest(input.providerSourceAssetIds);
}
