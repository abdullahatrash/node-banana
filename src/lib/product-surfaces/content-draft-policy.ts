import type { ContentFormat } from "./definitions";
import type { ContentFormatDefinition } from "./content-format-definition";
import { validateContentExecutionInput } from "./content-execution-plan";

export type ContentDraftIssueCode =
  | "CONTENT_FORMAT_DEFINITION_STALE"
  | "CONTENT_LANGUAGE_UNSUPPORTED"
  | "CONTENT_ARABIC_VARIETY_UNSUPPORTED"
  | "CONTENT_ASPECT_RATIO_UNSUPPORTED"
  | "CONTENT_DURATION_UNSUPPORTED"
  | "CONTENT_SCRIPT_REQUIRED"
  | "CONTENT_CAPTION_REQUIRED"
  | "CONTENT_SPEAKER_REQUIRED"
  | "CONTENT_SCENE_REQUIRED"
  | "CONTENT_SOURCE_CARDINALITY_INVALID"
  | "CONTENT_SOURCE_TYPE_INVALID"
  | "CONTENT_ASSET_NOT_READY"
  | "CONTENT_PERSONA_REQUIRED"
  | "CONTENT_MEDIA_SET_INVALID"
  | "CONTENT_THEME_REVISION_INVALID";

export interface ContentDraftPolicyInput {
  definition: ContentFormatDefinition | null;
  draft: {
    format: ContentFormat;
    formatDefinition: { id: string; revision: number } | null;
    contentLanguage: "ar" | "en" | "mixed";
    arabicVariety: string | null;
    aspectRatio: string;
    durationSeconds: number;
    script: string;
    captionStyle: string;
    speaker: string;
    scene: string;
    personaId: string | null;
    mediaSetIds: string[];
    themeRevisionRefs: Array<{ themeId: string; revision: number }>;
  };
  sourceAssets: Array<{ id: string; type: string; ready: boolean }>;
  persona: { id: string; state: string; consentCurrent: boolean } | null;
  mediaSets: Array<{ id: string; state: string }>;
  themes: Array<{ id: string; revision: number; state: string; licenseCurrent: boolean }>;
}

export function validateContentDraft(input: ContentDraftPolicyInput): ContentDraftIssueCode[] {
  const { draft } = input;
  const issues = new Set<ContentDraftIssueCode>();
  const definition = input.definition;
  if (!definition || !draft.formatDefinition || draft.formatDefinition.id !== definition.id || draft.formatDefinition.revision !== definition.revision || definition.format !== draft.format) {
    issues.add("CONTENT_FORMAT_DEFINITION_STALE");
    return [...issues];
  }
  if (!definition.languages.content.includes(draft.contentLanguage)) issues.add("CONTENT_LANGUAGE_UNSUPPORTED");
  if (draft.arabicVariety && !definition.languages.arabicVarieties.includes(draft.arabicVariety as never)) issues.add("CONTENT_ARABIC_VARIETY_UNSUPPORTED");
  if (!definition.layout.aspectRatios.includes(draft.aspectRatio as never)) issues.add("CONTENT_ASPECT_RATIO_UNSUPPORTED");
  if (!Number.isInteger(draft.durationSeconds) || draft.durationSeconds < definition.duration.minimumSeconds || draft.durationSeconds > definition.duration.maximumSeconds) issues.add("CONTENT_DURATION_UNSUPPORTED");
  if (definition.requiredControls.includes("script") && !draft.script.trim()) issues.add("CONTENT_SCRIPT_REQUIRED");
  if (definition.requiredControls.includes("captions") && !definition.captions.styles.includes(draft.captionStyle as never)) issues.add("CONTENT_CAPTION_REQUIRED");
  if (definition.requiredControls.includes("speaker") && !draft.speaker.trim()) issues.add("CONTENT_SPEAKER_REQUIRED");
  if (definition.requiredControls.includes("scene") && !draft.scene.trim()) issues.add("CONTENT_SCENE_REQUIRED");
  const execution = validateContentExecutionInput({ format: draft.format, definition, sources: input.sourceAssets, personaState: input.persona?.state ?? null });
  if (!execution.ok) issues.add(execution.code);
  if (input.sourceAssets.some((asset) => !asset.ready)) issues.add("CONTENT_ASSET_NOT_READY");
  if (definition.requiredControls.includes("persona") && (!input.persona || input.persona.id !== draft.personaId || input.persona.state !== "active" || !input.persona.consentCurrent)) issues.add("CONTENT_PERSONA_REQUIRED");
  if (draft.mediaSetIds.some((id) => !input.mediaSets.some((set) => set.id === id && set.state === "active"))) issues.add("CONTENT_MEDIA_SET_INVALID");
  if (draft.themeRevisionRefs.some((reference) => !input.themes.some((theme) => theme.id === reference.themeId && theme.revision === reference.revision && theme.state === "active" && theme.licenseCurrent))) issues.add("CONTENT_THEME_REVISION_INVALID");
  return [...issues];
}
