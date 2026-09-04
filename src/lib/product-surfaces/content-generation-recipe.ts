import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { GenerationCapability, GenerationIntent } from "@/lib/model-routing/types";
import { contentPieceSchema, type ContentFormat } from "./definitions";
import { contentProviderSourceIds } from "./content-execution-plan";
import type { ContentFormatDefinition } from "./content-format-definition";

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
}): NonNullable<GenerationIntent["contentExecution"]> {
  const payload = contentPieceSchema.parse(input.contentPiecePayload);
  if (payload.formatDefinition?.id !== input.definition.id || payload.formatDefinition.revision !== input.definition.revision || payload.formatDefinition.digest !== input.definitionDigest) throw new ContentGenerationRecipeError("CONTENT_FORMAT_DEFINITION_STALE");
  if (input.definition.execution.strategy !== "admitted_generation" || !input.definition.execution.workflow || !input.definition.execution.modelPolicy || !input.definition.execution.capability) throw new ContentGenerationRecipeError("CONTENT_CANONICAL_IMPORT_REQUIRED");
  if (input.definition.renderProof.schema !== "content-render-proof/v2") throw new ContentGenerationRecipeError("CONTENT_RENDER_PROOF_V2_REQUIRED");
  const orderedSources = payload.sourceAssetIds.map((id) => ({ id, type: input.sourceTypes.get(id) ?? "missing" }));
  const providerInputArtifactIds = contentProviderSourceIds(payload.format, orderedSources, input.definition);
  const value = {
    schema: "content-format-execution-binding/v1" as const,
    contentPiece: { id: input.contentPieceId, revision: input.contentPieceRevision, digest: canonicalDigest(payload) as `sha256:${string}` },
    formatDefinition: { id: input.definition.id, revision: input.definition.revision, digest: input.definitionDigest },
    workflow: { ...input.definition.execution.workflow },
    modelPolicy: { id: input.definition.execution.modelPolicy.id, revision: input.definition.execution.modelPolicy.revision, qualifiedModelsOnly: true as const },
    inputArtifactIds: [...payload.sourceAssetIds],
    providerInputArtifactIds,
  };
  return { ...value, digest: canonicalDigest(value) as `sha256:${string}` };
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
  if (canonicalDigest(input.recipe.inputArtifactIds) !== canonicalDigest(input.payload.sourceAssetIds) || canonicalDigest(input.recipe.providerInputArtifactIds) !== canonicalDigest(input.sourceAssetIds)) throw new ContentGenerationRecipeError("CONTENT_EXECUTION_INPUTS_MISMATCH");
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
    && input.recipe.modelPolicy.id === input.definition.execution.modelPolicy?.id
    && input.recipe.modelPolicy.revision === input.definition.execution.modelPolicy?.revision
    && input.definition.execution.modelPolicy?.qualifiedModelsOnly === true
    && input.definition.execution.capability === input.capability
    && canonicalDigest(input.recipe.inputArtifactIds) === canonicalDigest(input.rightsSourceAssetIds)
    && canonicalDigest(input.recipe.providerInputArtifactIds) === canonicalDigest(input.providerSourceAssetIds);
}
