import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { compositionSchema, CreativeError, structuredCopySchema, type Composition, type CopyBlock, type CreativeRequest, type StructuredCopy } from "./contracts";

export function approvedText(block: CopyBlock): string { return block.spans.map((span) => span.text).join(""); }

export function validateCopyForRequest(value: unknown, request: CreativeRequest): StructuredCopy {
  const result = structuredCopySchema.safeParse(value);
  if (!result.success) throw new CreativeError("creative.errors.copyInvalid");
  const copy = result.data;
  if (copy.language !== request.contentLanguage || copy.arabicVariety !== request.arabicVariety) throw new CreativeError("creative.errors.copyLanguage");
  for (const block of copy.blocks) {
    if (request.output.format === "image" ? block.timing !== null : block.timing === null || block.timing.endMs > request.output.durationMs!) throw new CreativeError("creative.errors.duration");
  }
  return copy;
}

export function parseGeneratedCopy(output: unknown, request: CreativeRequest): StructuredCopy {
  // No cleanup or "repair" model calls. Invalid provider JSON is a visible
  // review failure and preserves the original provider receipt.
  const text = typeof output === "string" ? output : Array.isArray(output) && output.every((item) => typeof item === "string") ? output.join("") : null;
  if (text === null || Buffer.byteLength(text, "utf8") > 100_000) throw new CreativeError("creative.errors.copyInvalid");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new CreativeError("creative.errors.copyInvalid"); }
  return validateCopyForRequest(value, request);
}

export function safeZoneBounds(canvas: Composition["canvas"], preset: Composition["safeZone"]) {
  const shortForm = preset === "short-form-v1";
  const left = Math.ceil(canvas.width * (shortForm ? 0.06 : 0.04));
  // Conservative shared 9:16 preset. Platforms may impose stricter overlays;
  // this is a versioned product layout policy, not a claim about their UI.
  const right = Math.ceil(canvas.width * (shortForm ? 0.16 : 0.04));
  const top = Math.ceil(canvas.height * (shortForm ? 0.1 : 0.04));
  const bottom = Math.ceil(canvas.height * (shortForm ? 0.2 : 0.04));
  return { x: left, y: top, width: canvas.width - left - right, height: canvas.height - top - bottom };
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
export function contrastRatio(a: string, b: string) {
  const first = luminance(a); const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function validateComposition(value: unknown, copyValue: StructuredCopy): Composition {
  const copy = structuredCopySchema.parse(copyValue);
  const parsed = compositionSchema.safeParse(value);
  if (!parsed.success) throw new CreativeError("creative.errors.layoutInvalid");
  const composition = parsed.data;
  if (composition.copyDigest !== canonicalDigest(copy)) throw new CreativeError("creative.errors.copyStale");
  const [w, h] = composition.canvas.aspectRatio.split(":").map(Number);
  if (composition.canvas.width * h !== composition.canvas.height * w) throw new CreativeError("creative.errors.aspectRatio");
  const video = composition.canvas.format === "video";
  if (video && (composition.canvas.aspectRatio !== "9:16" || composition.canvas.durationMs === null || composition.canvas.fps === null) || !video && (composition.canvas.durationMs !== null || composition.canvas.fps !== null)) throw new CreativeError("creative.errors.duration");
  if (composition.canvas.aspectRatio === "9:16" && composition.safeZone !== "short-form-v1") throw new CreativeError("creative.errors.safeZone");
  const bounds = safeZoneBounds(composition.canvas, composition.safeZone);
  if (composition.layers.length !== copy.blocks.length || new Set(composition.layers.map((layer) => layer.blockId)).size !== copy.blocks.length) throw new CreativeError("creative.errors.copyOrder");
  const blocks = new Map(copy.blocks.map((block) => [block.id, block]));
  for (const layer of composition.layers) {
    const block = blocks.get(layer.blockId);
    if (!block) throw new CreativeError("creative.errors.copyOrder");
    if (video ? !block.timing || block.timing.endMs > composition.canvas.durationMs! : block.timing !== null) throw new CreativeError("creative.errors.duration");
    const { x, y, width, height } = layer.box;
    if (x < bounds.x || y < bounds.y || x + width > bounds.x + bounds.width || y + height > bounds.y + bounds.height) throw new CreativeError("creative.errors.safeZone");
    if (width <= layer.padding * 2 || height <= layer.padding * 2 || layer.typography.minimumSize > layer.typography.size) throw new CreativeError("creative.errors.layoutInvalid");
    if (contrastRatio(layer.foreground, layer.background) < 4.5) throw new CreativeError("creative.errors.contrast");
  }
  for (const [index, layer] of composition.layers.entries()) for (const other of composition.layers.slice(index + 1)) {
    const a = layer.box; const b = other.box;
    const ta = blocks.get(layer.blockId)!.timing; const tb = blocks.get(other.blockId)!.timing;
    const simultaneous = !ta || !tb || ta.startMs < tb.endMs && tb.startMs < ta.endMs;
    if (simultaneous && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) throw new CreativeError("creative.errors.overlap");
  }
  // Each language retains its authored reading order; arbitrary layer/z-order
  // changes cannot reverse an Arabic or English paragraph sequence.
  for (const language of ["ar", "en"] as const) {
    const ordered = copy.blocks.filter((block) => block.language === language).sort((a, b) => a.readingOrder - b.readingOrder);
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1]!; const next = ordered[index]!;
      if (previous.timing && next.timing && previous.timing.endMs <= next.timing.startMs) continue;
      const before = composition.layers.find((layer) => layer.blockId === previous.id)!.box;
      const after = composition.layers.find((layer) => layer.blockId === next.id)!.box;
      if (after.y < before.y || after.y === before.y && (language === "ar" ? after.x > before.x : after.x < before.x)) throw new CreativeError("creative.errors.copyOrder");
    }
  }
  return composition;
}

const escapeMarkup = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Display-only directional controls are added outside the authored payload.
 * FriBidi/HarfBuzz shape logical Unicode; we never reverse a string or glyph. */
export function pangoCopyMarkup(block: CopyBlock, color: string) {
  if (!/^#[a-fA-F0-9]{6}$/.test(color)) throw new CreativeError("creative.errors.layoutInvalid");
  const spans = block.spans.map((span) => span.kind === "text" ? escapeMarkup(span.text) : `${span.direction === "rtl" ? "\u2067" : "\u2066"}${escapeMarkup(span.text)}\u2069`).join("");
  const paragraph = `${block.language === "ar" ? "\u202b" : "\u202a"}${spans}\u202c`;
  return `<span foreground="${color}">${paragraph}</span>`;
}
