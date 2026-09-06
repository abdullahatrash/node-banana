import { describe, expect, it } from "vitest";
import { contentPieceSchema } from "@/lib/product-surfaces/definitions";
import { contentFormatDefinition } from "@/lib/product-surfaces/content-format-definition";
import { contentDraftPayload } from "../ContentBuilder";

describe("ContentBuilder draft contract", () => {
  it("submits the exact persisted definition identity including its digest", () => {
    const data = new FormData();
    data.set("language", "ar");
    data.set("arabicVariety", "gulf");
    data.set("script", "نص أصلي");
    data.set("speaker", "متحدث");
    data.set("scene", "استوديو");
    data.set("duration", "15");
    data.set("captionStyle", "brand");
    data.set("personaId", "persona_1");
    const definition = contentFormatDefinition("talking_head_ugc");
    const digest = `sha256:${"a".repeat(64)}` as const;

    const parsed = contentPieceSchema.parse(contentDraftPayload(data, definition.format, definition, digest, { mediaSets: [], themes: [] }));

    expect(parsed.formatDefinition).toEqual({ id: definition.id, revision: definition.revision, digest });
  });

  it("preserves exact Media Set membership and Theme digests in the saved draft", () => {
    const data = new FormData();
    data.set("language", "ar"); data.set("script", "نص"); data.set("duration", "15"); data.set("captionStyle", "brand");
    data.append("mediaSetRevision", "set_1:7"); data.set("themeRevision", "theme_1:3");
    const definition = contentFormatDefinition("slideshow");
    const definitionDigest = `sha256:${"a".repeat(64)}` as const;
    const mediaDigest = `sha256:${"b".repeat(64)}` as const;
    const themeDigest = `sha256:${"c".repeat(64)}` as const;
    const document = { schema: "content-theme/v1" as const, visual: { stylePrompt: "Editorial", palette: [], avoid: [] }, captions: { style: "brand", fontFamilies: ["Noto Sans Arabic"], position: "bottom" as const, bidi: "native" as const } };

    const parsed = contentPieceSchema.parse(contentDraftPayload(data, definition.format, definition, definitionDigest, {
      mediaSets: [{ id: "set_1", label: "Set", assetCount: 2, revision: 7, digest: mediaDigest, orderedAssetIds: ["asset_2", "asset_1"] }],
      themes: [{ id: "theme_1", label: "Theme", revision: 3, digest: themeDigest, document, licenseEvidenceIds: ["license_1"] }],
    }));

    expect(parsed.mediaSetRevisionRefs).toEqual([{ mediaSetId: "set_1", revision: 7, digest: mediaDigest }]);
    expect(parsed.themeRevisionRefs).toEqual([{ themeId: "theme_1", revision: 3, digest: themeDigest }]);
  });

  it("keeps historical pinned revisions on unrelated saves and pins current revisions only when selected", () => {
    const definition = contentFormatDefinition("slideshow"); const definitionDigest = `sha256:${"a".repeat(64)}` as const;
    const oldMedia = `sha256:${"b".repeat(64)}` as const; const currentMedia = `sha256:${"c".repeat(64)}` as const;
    const oldTheme = `sha256:${"d".repeat(64)}` as const; const currentTheme = `sha256:${"e".repeat(64)}` as const;
    const document = { schema: "content-theme/v1" as const, visual: { stylePrompt: "Editorial", palette: [], avoid: [] }, captions: { style: "brand", fontFamilies: ["Noto Sans Arabic"], position: "bottom" as const, bidi: "native" as const } };
    const options = { mediaSets: [{ id: "set_1", label: "Set", assetCount: 2, revision: 7, digest: oldMedia, orderedAssetIds: ["a", "b"] }, { id: "set_1", label: "Set", assetCount: 2, revision: 8, digest: currentMedia, orderedAssetIds: ["a", "c"] }], themes: [{ id: "theme_1", label: "Theme", revision: 3, digest: oldTheme, document, licenseEvidenceIds: ["license"] }, { id: "theme_1", label: "Theme", revision: 4, digest: currentTheme, document, licenseEvidenceIds: ["license"] }] };
    const form = (mediaRevision: number, themeRevision: number) => { const data = new FormData(); data.set("language", "ar"); data.set("script", "updated text"); data.set("duration", "15"); data.set("captionStyle", "brand"); data.append("mediaSetRevision", `set_1:${mediaRevision}`); data.set("themeRevision", `theme_1:${themeRevision}`); return contentPieceSchema.parse(contentDraftPayload(data, definition.format, definition, definitionDigest, options)); };
    expect(form(7, 3)).toMatchObject({ mediaSetRevisionRefs: [{ revision: 7, digest: oldMedia }], themeRevisionRefs: [{ revision: 3, digest: oldTheme }] });
    expect(form(8, 4)).toMatchObject({ mediaSetRevisionRefs: [{ revision: 8, digest: currentMedia }], themeRevisionRefs: [{ revision: 4, digest: currentTheme }] });
  });

  it("retains unavailable historical pins instead of silently dropping them", () => {
    const definition = contentFormatDefinition("talking_head_ugc"); const definitionDigest = `sha256:${"a".repeat(64)}` as const;
    const mediaDigest = `sha256:${"b".repeat(64)}` as const; const themeDigest = `sha256:${"c".repeat(64)}` as const;
    const authoritative = { mediaSetRevisionRefs: [{ mediaSetId: "archived_set", revision: 2, digest: mediaDigest }], themeRevisionRefs: [{ themeId: "expired_theme", revision: 5, digest: themeDigest }] };
    const data = new FormData(); data.set("language", "ar"); data.set("script", "unrelated edit"); data.set("speaker", "speaker"); data.set("scene", "scene"); data.set("duration", "15"); data.set("captionStyle", "brand"); data.set("personaId", "persona"); data.set("retainedMediaSetRevision", "archived_set:2"); data.set("retainedThemeRevision", "expired_theme:5");
    expect(contentPieceSchema.parse(contentDraftPayload(data, definition.format, definition, definitionDigest, { mediaSets: [], themes: [] }, authoritative))).toMatchObject(authoritative);
  });
});
