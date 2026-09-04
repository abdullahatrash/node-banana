import { describe, expect, it } from "vitest";
import { validateContentDraft, type ContentDraftPolicyInput } from "../content-draft-policy";

const readyDraft: ContentDraftPolicyInput = {
  draft: { format: "talking_head_ugc", formatDefinition: { id: "content-format:talking_head_ugc", revision: 1 }, contentLanguage: "ar", arabicVariety: "gulf", aspectRatio: "9:16", durationSeconds: 15, script: "نص أصلي", captionStyle: "brand", speaker: "Warm founder", scene: "Studio", personaId: "persona", mediaSetIds: ["set"], themeRevisionRefs: [{ themeId: "theme", revision: 2 }] },
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
    expect(validateContentDraft({ ...readyDraft, draft: { ...readyDraft.draft, formatDefinition: { ...readyDraft.draft.formatDefinition!, revision: 0 } }, persona: { ...readyDraft.persona!, consentCurrent: false }, themes: [{ ...readyDraft.themes[0]!, revision: 3 }] })).toEqual(expect.arrayContaining(["CONTENT_FORMAT_DEFINITION_STALE", "CONTENT_PERSONA_REQUIRED", "CONTENT_THEME_REVISION_INVALID"]));
  });

  it("derives required format controls and media rules instead of trusting the UI", () => {
    const input: ContentDraftPolicyInput = { ...readyDraft, draft: { ...readyDraft.draft, format: "green_screen_meme", formatDefinition: { id: "content-format:green_screen_meme", revision: 1 }, speaker: "", scene: "", personaId: null, mediaSetIds: [], themeRevisionRefs: [] }, persona: null, mediaSets: [], themes: [], sourceAssets: [{ id: "video-first", type: "video", ready: true }, { id: "image-second", type: "image", ready: true }] };
    expect(validateContentDraft(input)).toContain("CONTENT_SOURCE_TYPE_INVALID");
    expect(validateContentDraft({ ...input, sourceAssets: [{ id: "image", type: "image", ready: true }, { id: "video", type: "video", ready: true }] })).not.toContain("CONTENT_SOURCE_TYPE_INVALID");
  });
});
