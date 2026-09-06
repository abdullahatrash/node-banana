// @vitest-environment node
import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { loadCreativeFont } from "../font";
import { renderCreativeFrame } from "../render";
import { composition, copy } from "./fixtures";

const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const plate = () => sharp({ create: { width: 720, height: 1280, channels: 3, background: "#a2b3c4" } }).png().toBuffer();

describe("real Arabic shaping and raster composition", () => {
  it.each(["ar", "en", "mixed"] as const)("renders deterministic %s pixels from exact copy using the bundled font", async (language) => {
    const source = await plate(); const text = copy(language); const layout = composition(text, digest(source));
    const first = await renderCreativeFrame({ composition: layout, copy: text, plate: source });
    const second = await renderCreativeFrame({ composition: layout, copy: text, plate: source });
    expect(first.buffer.equals(second.buffer)).toBe(true);
    expect(first.receipt.copyDigest).toBe(canonicalDigest(text));
    expect(first.receipt.runtime.harfbuzz).toBeTruthy();
    expect(first.receipt.runtime.fribidi).toBeTruthy();
    expect(first.receipt.reviewRequired).toBe(true);
    expect(first.receipt.output.digest).not.toBe(digest(source));
    expect(await sharp(first.buffer).metadata()).toMatchObject({ width: 720, height: 1280, format: "png" });
  });
  it("blocks glyph fallback and missing font instead of producing tofu", async () => {
    await expect(loadCreativeFont(["مرحبا ABC-12"])).resolves.toMatchObject({ id: "noto-sans-arabic-v1" });
    await expect(loadCreativeFont(["漢字"])).rejects.toThrow("creative.errors.missingGlyph");
    await expect(loadCreativeFont(["نص"], "/nonexistent-font-root")).rejects.toThrow("creative.errors.fontUnavailable");
  });
  it("fails overflow explicitly and preserves accepted copy while shrinking within authored bounds", async () => {
    const source = await plate(); const text = copy("ar"); text.blocks[0]!.spans = [{ kind: "text", text: "كلمات كثيرة في مساحة ضيقة ".repeat(30) }];
    const layout = composition(text, digest(source)); layout.layers[0]!.box.height = 80; layout.layers[0]!.overflow = "reject";
    await expect(renderCreativeFrame({ composition: layout, copy: text, plate: source })).rejects.toThrow("creative.errors.overflow");
    text.blocks[0]!.spans = [{ kind: "text", text: "أهلاً بكم في عالم الأفكار" }];
    layout.copyDigest = canonicalDigest(text); layout.layers[0]!.box.height = 210; layout.layers[0]!.typography.size = 120; layout.layers[0]!.overflow = "shrink";
    const result = await renderCreativeFrame({ composition: layout, copy: text, plate: source });
    expect(result.receipt.layout[0]!.renderedFontSize).toBeLessThan(120);
    expect(result.receipt.copyDigest).toBe(canonicalDigest(text));
  });
  it("binds source bytes and frame timing", async () => {
    const source = await plate(); const text = copy("en"); const layout = composition(text);
    await expect(renderCreativeFrame({ composition: layout, copy: text, plate: source })).rejects.toThrow("creative.errors.sourceBinding");
    layout.plate.digest = digest(source);
    await expect(renderCreativeFrame({ composition: layout, copy: text, plate: source, timeMs: -1 })).rejects.toThrow("creative.errors.duration");
  });
});
