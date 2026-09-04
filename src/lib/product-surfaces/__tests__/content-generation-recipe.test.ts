import { describe, expect, it } from "vitest";
import { CONTENT_FORMATS } from "../definitions";
import { CONTENT_FORMAT_DEFINITIONS } from "../content-format-definition";
import { buildContentGenerationRecipe, ContentGenerationRecipeError } from "../content-generation-recipe";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { ContentModelPolicy } from "../content-model-policy";
import { mediaSetMembershipDigest } from "../content-execution-resources";

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
  const model = { provider: "replicate" as const, model: "qualified/model", version: "version_1", inputSchemaDigest: `sha256:${"d".repeat(64)}` };
  const unsigned = { schema: "content-model-policy/v1" as const, id: definition.execution.modelPolicy!.id, revision: definition.execution.modelPolicy!.revision, format, region: "replicate-us" as const, defaultModel: model, compatibleModels: [model], overrides: { mode: "explicit_exact_allowlist" as const, allowedFields: ["model"] as const, requireRequote: true as const } };
  const modelPolicy = { ...unsigned, digest: canonicalDigest(unsigned) } as ContentModelPolicy;
  return { definition, sources, payload, modelPolicy };
}

describe("Content generation recipes", () => {
  it.each(CONTENT_FORMATS.filter((format) => format !== "custom_upload"))("binds %s to its exact Workflow Revision, Model Policy, and ordered inputs", (format) => {
    const { definition, sources, payload, modelPolicy } = fixture(format as Exclude<typeof format, "custom_upload">);
    const recipe = buildContentGenerationRecipe({ contentPieceId: `piece_${format}`, contentPieceRevision: 7, contentPiecePayload: payload, definition, definitionDigest, sourceTypes: new Map(sources.map((source) => [source.id, source.type])), modelPolicy });
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
    expect(() => buildContentGenerationRecipe({ contentPieceId: "piece_custom", contentPieceRevision: 1, contentPiecePayload: { ...fixture("wall_of_text").payload, format: "custom_upload", formatDefinition: { id: definition.id, revision: definition.revision, digest: definitionDigest } }, definition, definitionDigest, sourceTypes: new Map(), modelPolicy: fixture("wall_of_text").modelPolicy })).toThrowError(expect.objectContaining<Partial<ContentGenerationRecipeError>>({ code: "CONTENT_CANONICAL_IMPORT_REQUIRED" }));
  });

  it("binds ordered Media Set membership and licensed Theme instructions into the workflow recipe", () => {
    const { definition, sources, payload, modelPolicy } = fixture("slideshow");
    const mediaDigest = mediaSetMembershipDigest({ mediaSetId: "set_1", revision: 5, orderedAssetIds: ["asset_set_2", "asset_set_1"] });
    const themeDocument = { schema: "content-theme/v1" as const, visual: { stylePrompt: "Warm editorial", palette: ["#112233"], avoid: ["unlicensed marks"] }, captions: { style: "brand", fontFamilies: ["Noto Sans Arabic"], position: "bottom" as const, bidi: "native" as const } };
    const themeDigest = canonicalDigest(themeDocument) as `sha256:${string}`;
    const recipe = buildContentGenerationRecipe({
      contentPieceId: "piece_slideshow", contentPieceRevision: 2,
      contentPiecePayload: { ...payload, mediaSetIds: ["set_1"], mediaSetRevisionRefs: [{ mediaSetId: "set_1", revision: 5, digest: mediaDigest }], themeRevisionRefs: [{ themeId: "theme_1", revision: 3, digest: themeDigest }] },
      definition, definitionDigest, sourceTypes: new Map([...sources.map((source) => [source.id, source.type] as const), ["asset_set_2", "image"], ["asset_set_1", "image"]]), modelPolicy,
      resources: { mediaSets: [{ mediaSetId: "set_1", revision: 5, digest: mediaDigest, orderedAssetIds: ["asset_set_2", "asset_set_1"] }], themes: [{ themeId: "theme_1", revision: 3, digest: themeDigest, document: themeDocument, licenseEvidenceIds: ["license_1"] }], orderedAssetIds: [...payload.sourceAssetIds, "asset_set_2", "asset_set_1"] },
    });
    expect(recipe.inputArtifactIds).toEqual([...payload.sourceAssetIds, "asset_set_2", "asset_set_1"]);
    expect(recipe.workflowInputs.mediaSetRevisions[0]).toMatchObject({ digest: mediaDigest, orderedAssetIds: ["asset_set_2", "asset_set_1"] });
    expect(recipe.workflowInputs.themeInstructions[0]).toMatchObject({ digest: themeDigest, visual: themeDocument.visual, captions: themeDocument.captions, licenseEvidenceIds: ["license_1"] });
  });
});
