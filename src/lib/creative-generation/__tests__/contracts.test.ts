import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { buildCreativeBrief, compileCopyPrompt, compileVisualPlatePrompt } from "../brief";
import { approvedText, contrastRatio, pangoCopyMarkup, parseGeneratedCopy, safeZoneBounds, validateComposition } from "../composition";
import { creativeRequestSchema, structuredCopySchema } from "../contracts";
import { brand, composition, copy, request } from "./fixtures";

describe("creative request and minimized brief", () => {
  it("pins language/variety, dimensions, rights, funding and accepted revision", () => {
    expect(creativeRequestSchema.parse(request())).toEqual(request());
    expect(() => creativeRequestSchema.parse({ ...request(), arabicVariety: null })).toThrow();
    expect(() => creativeRequestSchema.parse({ ...request("en"), arabicVariety: "gulf" })).toThrow();
    expect(() => creativeRequestSchema.parse({ ...request(), output: { ...request().output, width: 721 } })).toThrow();
    expect(() => creativeRequestSchema.parse({ ...request(), output: { ...request().output, format: "video" } })).toThrow();
    expect(() => creativeRequestSchema.parse({ ...request(), fundingMode: "qualification" })).toThrow();
  });
  it("minimizes brand data, distinguishes accepted assertions from source evidence and excludes copy from visual prompts", () => {
    const accepted = { workspaceId: "workspace-1", profileId: "brand-1", revision: 3, acceptedAt: "2026-09-05T00:00:00Z", profile: brand };
    const brief = buildCreativeBrief(request(), accepted);
    expect(brief.factualClaims[0]?.evidence.kind).toBe("accepted_brand_assertion");
    expect(brief.supportingSourceEvidence).toEqual(brand.evidence);
    expect(JSON.stringify(brief)).not.toContain("UNRELATED");
    expect(brief).not.toHaveProperty("workspaceId");
    expect(brief).not.toHaveProperty("fundingMode");
    expect(compileCopyPrompt(brief)).toContain("creative-copy/v1");
    const visual = compileVisualPlatePrompt(brief);
    expect(visual).toContain("letters, words, numbers, captions, logos, watermarks");
    expect(visual).not.toContain("factualClaims");
    expect(visual).not.toContain("Tasmeem");
    expect(() => buildCreativeBrief(request(), { ...accepted, workspaceId: "other" })).toThrow("creative.errors.brandStale");
    expect(() => buildCreativeBrief(request(), { ...accepted, revision: 4 })).toThrow("creative.errors.brandStale");
  });
});

describe("exact authored structured copy", () => {
  it.each(["ar", "en", "mixed"] as const)("validates %s without normalizing or trimming", (language) => {
    const text = copy(language);
    expect(parseGeneratedCopy(JSON.stringify(text), request(language))).toEqual(text);
    expect(approvedText(text.blocks[0]!)).toBe(text.blocks[0]!.spans.map((span) => span.text).join(""));
  });
  it("requires independent bilingual order and isolation boundaries", () => {
    const text = copy();
    text.blocks[0]!.spans = [{ kind: "text", text: "اشتري ABC-12 الآن" }];
    expect(structuredCopySchema.safeParse(text).success).toBe(false);
    const duplicate = copy(); duplicate.blocks[1]!.id = duplicate.blocks[0]!.id;
    expect(structuredCopySchema.safeParse(duplicate).success).toBe(false);
    const order = copy(); order.blocks[1]!.readingOrder = 1;
    expect(structuredCopySchema.safeParse(order).success).toBe(false);
  });
  it.each(["\u202e", "\u2066", "\u061c", "\u0000", "\ud800"])("rejects hostile direction/control %s without silently stripping it", (control) => {
    const text = copy(); text.blocks[0]!.spans[0]!.text += control;
    expect(structuredCopySchema.safeParse(text).success).toBe(false);
  });
  it("escapes Pango markup and isolates literal URLs without reversing them", () => {
    const block = copy().blocks[0]!;
    block.spans = [{ kind: "text", text: "عرض " }, { kind: "literal", text: 'https://example.com/A-12?q=<tag>&x="5"', direction: "ltr" }];
    const markup = pangoCopyMarkup(block, "#ffffff");
    expect(markup).toContain('\u2066https://example.com/A-12?q=&lt;tag&gt;&amp;x=&quot;5&quot;\u2069');
    expect(approvedText(block)).toContain('https://example.com/A-12?q=<tag>&x="5"');
    expect(markup).not.toContain("<tag>");
  });
  it("never repairs model output, switches language, or invents a timing window", () => {
    expect(() => parseGeneratedCopy("```json\n{}\n```", request())).toThrow("creative.errors.copyInvalid");
    expect(() => parseGeneratedCopy(JSON.stringify(copy("en")), request())).toThrow("creative.errors.copyLanguage");
    const text = copy(); text.blocks[0]!.timing = { startMs: 0, endMs: 1000 };
    expect(() => parseGeneratedCopy(JSON.stringify(text), request())).toThrow("creative.errors.duration");
  });
});

describe("versioned composition constraints", () => {
  it("binds exact copy and enforces contrast and conservative short-form zones", () => {
    const text = copy(); const layout = composition(text);
    expect(validateComposition(layout, text)).toEqual(layout);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(safeZoneBounds(layout.canvas, layout.safeZone)).toEqual({ x: 44, y: 128, width: 560, height: 896 });
    const stale = copy(); stale.blocks[0]!.spans[0]!.text += "!";
    expect(() => validateComposition(layout, stale)).toThrow("creative.errors.copyStale");
    layout.layers[0]!.foreground = "#171717";
    expect(() => validateComposition(layout, text)).toThrow("creative.errors.contrast");
  });
  it("rejects off-screen, overlapping and reversed paragraph layouts", () => {
    const text = copy(); const layout = composition(text);
    layout.layers[0]!.box.y = 0;
    expect(() => validateComposition(layout, text)).toThrow("creative.errors.safeZone");
    layout.layers[0]!.box.y = layout.layers[1]!.box.y;
    expect(() => validateComposition(layout, text)).toThrow("creative.errors.overlap");
    const ordered = copy("ar"); ordered.blocks.push({ ...ordered.blocks[0]!, id: "ar-body", readingOrder: 1 });
    const reversed = composition(ordered); reversed.layers.reverse(); reversed.layers[0]!.box.y = 180; reversed.layers[1]!.box.y = 480;
    expect(() => validateComposition(reversed, ordered)).toThrow("creative.errors.copyOrder");
  });
  it("allows shared video placement only for disjoint exact time windows", () => {
    const text = copy(); text.blocks[0]!.timing = { startMs: 0, endMs: 1000 }; text.blocks[1]!.timing = { startMs: 1000, endMs: 2000 };
    const layout = composition(text); layout.canvas = { ...layout.canvas, format: "video", durationMs: 2000, fps: 24 }; layout.layers[1]!.box = { ...layout.layers[0]!.box };
    expect(validateComposition(layout, text)).toEqual(layout);
    text.blocks[1]!.timing!.startMs = 999; layout.copyDigest = canonicalDigest(text);
    expect(() => validateComposition(layout, text)).toThrow("creative.errors.overlap");
  });
});
