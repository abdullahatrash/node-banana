import { describe, expect, it } from "vitest";
import { CONTENT_FORMATS } from "../definitions";
import { CONTENT_FORMAT_DEFINITIONS } from "../content-format-definition";
import { buildContentGenerationRecipe, ContentGenerationRecipeError } from "../content-generation-recipe";

const definitionDigest = `sha256:${"a".repeat(64)}` as const;

function fixture(format: Exclude<(typeof CONTENT_FORMATS)[number], "custom_upload">) {
  const definition = CONTENT_FORMAT_DEFINITIONS[format];
  const sources = definition.sourceSlots.flatMap((slot, slotIndex) => Array.from({ length: slot.minimum }, (_, index) => ({ id: `${slot.key}-${slotIndex}-${index}`, type: slot.type })));
  const payload = {
    format,
    formatDefinition: { id: definition.id, revision: definition.revision, digest: definitionDigest },
    contentLanguage: "ar",
    arabicVariety: "gulf",
    prompt: "إطلاق المنتج",
    script: "نص الحملة",
    aspectRatio: "9:16",
    durationSeconds: definition.duration.defaultSeconds,
    captionStyle: definition.captions.required ? "brand" : "",
    speaker: "مقدّم",
    scene: "استوديو",
    sourceAssetIds: sources.map((source) => source.id),
    personaId: definition.requiredControls.includes("persona") ? "persona_1" : null,
    mediaSetIds: [], themeRevisionRefs: [], validationIssues: [], candidateArtifactIds: [], candidates: [], renderProofStatus: "not_requested",
  };
  return { definition, sources, payload };
}

describe("Content generation recipes", () => {
  it.each(CONTENT_FORMATS.filter((format) => format !== "custom_upload"))("binds %s to its exact Workflow Revision, Model Policy, and ordered inputs", (format) => {
    const { definition, sources, payload } = fixture(format as Exclude<typeof format, "custom_upload">);
    const recipe = buildContentGenerationRecipe({ contentPieceId: `piece_${format}`, contentPieceRevision: 7, contentPiecePayload: payload, definition, definitionDigest, sourceTypes: new Map(sources.map((source) => [source.id, source.type])) });
    expect(recipe).toMatchObject({
      contentPiece: { id: `piece_${format}`, revision: 7 },
      formatDefinition: { id: definition.id, revision: definition.revision, digest: definitionDigest },
      workflow: definition.execution.workflow,
      modelPolicy: { id: definition.execution.modelPolicy!.id, revision: definition.execution.modelPolicy!.revision, qualifiedModelsOnly: true },
      inputArtifactIds: payload.sourceAssetIds,
    });
    expect(recipe.providerInputArtifactIds).toEqual(sources.filter((_source, index) => definition.sourceSlots.flatMap((slot, slotIndex) => Array.from({ length: slot.minimum }, () => slot.providerInputIndex === null ? -1 : slotIndex))[index] !== -1).map((source) => source.id));
    expect(recipe.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("keeps Custom on the canonical import lifecycle", () => {
    const definition = CONTENT_FORMAT_DEFINITIONS.custom_upload;
    expect(() => buildContentGenerationRecipe({ contentPieceId: "piece_custom", contentPieceRevision: 1, contentPiecePayload: { ...fixture("wall_of_text").payload, format: "custom_upload", formatDefinition: { id: definition.id, revision: definition.revision, digest: definitionDigest } }, definition, definitionDigest, sourceTypes: new Map() })).toThrowError(expect.objectContaining<Partial<ContentGenerationRecipeError>>({ code: "CONTENT_CANONICAL_IMPORT_REQUIRED" }));
  });
});
