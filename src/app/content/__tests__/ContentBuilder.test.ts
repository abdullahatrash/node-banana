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
    data.append("mediaSetIds", "set_1"); data.set("themeRevision", "theme_1:3");
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
});
