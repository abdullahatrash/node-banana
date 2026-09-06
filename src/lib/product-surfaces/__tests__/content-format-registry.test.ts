import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { contentFormatDefinition } from "../content-format-definition";
import { ContentFormatRegistryError, validatePersistedContentFormatDefinition } from "../content-format-registry";

describe("persisted Content Format Definition validation", () => {
  it("accepts a complete governed definition with a stable digest", () => {
    const definition = contentFormatDefinition("talking_head_ugc");
    expect(validatePersistedContentFormatDefinition(definition)).toEqual(definition);
    expect(canonicalDigest(definition)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed when 9:16 or Render Proof governance is weakened", () => {
    const definition = contentFormatDefinition("slideshow");
    expect(() => validatePersistedContentFormatDefinition({ ...definition, layout: { ...definition.layout, aspectRatios: ["1:1"] } })).toThrow(ContentFormatRegistryError);
    expect(() => validatePersistedContentFormatDefinition({ ...definition, renderProof: { ...definition.renderProof, verifies: ["timing"] } })).toThrow(ContentFormatRegistryError);
  });
});
