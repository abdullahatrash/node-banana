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

    const parsed = contentPieceSchema.parse(contentDraftPayload(data, definition.format, definition, digest));

    expect(parsed.formatDefinition).toEqual({ id: definition.id, revision: definition.revision, digest });
  });
});
