import { describe, expect, it } from "vitest";
import { validateContentDraft, type ContentDraftPolicyInput } from "../content-draft-policy";
import { contentFormatDefinition } from "../content-format-definition";

const talkingHeadDefinition = contentFormatDefinition("talking_head_ugc");
const readyDraft: ContentDraftPolicyInput = {
  definition: talkingHeadDefinition,
  draft: { format: "talking_head_ugc", formatDefinition: { id: talkingHeadDefinition.id, revision: talkingHeadDefinition.revision }, contentLanguage: "ar", arabicVariety: "gulf", aspectRatio: "9:16", durationSeconds: 15, script: "نص أصلي", captionStyle: "brand", speaker: "Warm founder", scene: "Studio", personaId: "persona", mediaSetIds: ["set"], themeRevisionRefs: [{ themeId: "theme", revision: 2 }] },
  sourceAssets: [],
  persona: { id: "persona", state: "active", consentCurrent: true },
  mediaSets: [{ id: "set", state: "active" }],
  themes: [{ id: "theme", revision: 2, state: "active", licenseCurrent: true }],
};

describe("Content Draft validation", () => {
  it("validates a complete draft against its pinned definition and references", () => {
    expect(validateContentDraft(readyDraft)).toEqual([]);
  });

  it("fails closed on stale definitions, inactive consent, and stale licensed Themes", () => {
    expect(validateContentDraft({ ...readyDraft, draft: { ...readyDraft.draft, formatDefinition: { ...readyDraft.draft.formatDefinition!, revision: 0 } } })).toEqual(["CONTENT_FORMAT_DEFINITION_STALE"]);
    expect(validateContentDraft({ ...readyDraft, persona: { ...readyDraft.persona!, consentCurrent: false }, themes: [{ ...readyDraft.themes[0]!, revision: 3 }] })).toEqual(expect.arrayContaining(["CONTENT_PERSONA_REQUIRED", "CONTENT_THEME_REVISION_INVALID"]));
  });

  it("derives required format controls and media rules instead of trusting the UI", () => {
    const definition = contentFormatDefinition("green_screen_meme");
    const input: ContentDraftPolicyInput = { ...readyDraft, definition, draft: { ...readyDraft.draft, format: "green_screen_meme", formatDefinition: { id: definition.id, revision: definition.revision }, speaker: "", scene: "", personaId: null, mediaSetIds: [], themeRevisionRefs: [] }, persona: null, mediaSets: [], themes: [], sourceAssets: [{ id: "video-first", type: "video", ready: true }, { id: "image-second", type: "image", ready: true }] };
    expect(validateContentDraft(input)).toContain("CONTENT_SOURCE_TYPE_INVALID");
    expect(validateContentDraft({ ...input, sourceAssets: [{ id: "image", type: "image", ready: true }, { id: "video", type: "video", ready: true }] })).not.toContain("CONTENT_SOURCE_TYPE_INVALID");
  });

  it("uses the exact persisted pinned definition instead of the built-in latest definition", () => {
    const pinned = {
      ...contentFormatDefinition("talking_head_ugc"),
      revision: 7,
      duration: { minimumSeconds: 20, maximumSeconds: 30, defaultSeconds: 25 },
    };
    const input: ContentDraftPolicyInput = {
      ...readyDraft,
      definition: pinned,
      draft: { ...readyDraft.draft, formatDefinition: { id: pinned.id, revision: pinned.revision }, durationSeconds: 15 },
    };
    expect(validateContentDraft(input)).toContain("CONTENT_DURATION_UNSUPPORTED");
    expect(validateContentDraft({ ...input, definition: null })).toEqual(["CONTENT_FORMAT_DEFINITION_STALE"]);
  });
});
