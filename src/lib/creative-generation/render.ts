import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { approvedText, pangoCopyMarkup, validateComposition } from "./composition";
import { CreativeError, type Composition, type StructuredCopy } from "./contracts";
import { loadCreativeFont } from "./font";

const bytesDigest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const execFileAsync = promisify(execFile);
export const CREATIVE_RENDERER_REVISION = "sharp-pango-creative/v1";

async function renderLayers(composition: Composition, copy: StructuredCopy) {
  const font = await loadCreativeFont(copy.blocks.map(approvedText));
  const rendered: Array<{ buffer: Buffer; left: number; top: number; blockId: string; size: number; timing: StructuredCopy["blocks"][number]["timing"] }> = [];
  for (const layer of composition.layers) {
    const block = copy.blocks.find((item) => item.id === layer.blockId)!;
    const availableWidth = layer.box.width - layer.padding * 2; const availableHeight = layer.box.height - layer.padding * 2;
    const alignment = layer.typography.align === "center" ? "centre" : (layer.typography.align === "start") === (block.language === "en") ? "left" : "right";
    let size = layer.typography.size;
    let raster: { data: Buffer; info: sharp.OutputInfo } | null = null;
    for (;;) {
      raster = await sharp({ text: { text: pangoCopyMarkup(block, layer.foreground), font: `${font.family} ${layer.typography.weight === "bold" ? "Bold" : "Regular"} ${size}`, fontfile: font.path, width: availableWidth, dpi: 72, rgba: true, align: alignment, wrap: "word-char", spacing: Math.round(size * (layer.typography.lineHeight - 1)) } }).png().toBuffer({ resolveWithObject: true });
      if (raster.info.width <= availableWidth && raster.info.height <= availableHeight) break;
      if (layer.overflow !== "shrink" || size <= layer.typography.minimumSize) throw new CreativeError("creative.errors.overflow");
      size--;
    }
    const horizontal = alignment === "centre" ? Math.floor((availableWidth - raster.info.width) / 2) : alignment === "right" ? availableWidth - raster.info.width : 0;
    const buffer = await sharp({ create: { width: layer.box.width, height: layer.box.height, channels: 4, background: layer.background } }).composite([{ input: raster.data, left: layer.padding + horizontal, top: layer.padding }]).png().toBuffer();
    rendered.push({ buffer, left: layer.box.x, top: layer.box.y, blockId: block.id, size, timing: block.timing });
  }
  return { layers: rendered, font };
}

function renderEvidence(composition: Composition, copy: StructuredCopy, rendered: Awaited<ReturnType<typeof renderLayers>>, bytes: Buffer, mimeType: "image/png" | "video/mp4") {
  const evidence = {
    schema: "creative-render-receipt/v1" as const,
    renderer: CREATIVE_RENDERER_REVISION,
    runtime: { sharp: sharp.versions.sharp, pango: sharp.versions.pango, harfbuzz: sharp.versions.harfbuzz, fribidi: sharp.versions.fribidi },
    compositionDigest: canonicalDigest(composition),
    compositionRevision: composition.revision,
    copyDigest: canonicalDigest(copy),
    copyRevision: copy.revision,
    plate: composition.plate,
    output: { digest: bytesDigest(bytes), mimeType, byteLength: bytes.length, ...composition.canvas },
    font: { id: rendered.font.id, digest: `sha256:${rendered.font.sha256}` },
    // Receipts record what was measured, not a claim of independent visual
    // qualification. Publishing still needs the separate inspection/review.
    layout: rendered.layers.map(({ blockId, size, timing, left, top, buffer }) => ({ blockId, renderedFontSize: size, timing, left, top, rasterDigest: bytesDigest(buffer) })),
    reviewRequired: true as const,
  };
  return { ...evidence, digest: canonicalDigest(evidence) };
}
export type CreativeRenderReceipt = ReturnType<typeof renderEvidence>;

/** The exact same PNG layers are used by image export, video export, and
 * frame preview. No browser-font metrics or provider calls enter this path. */
export async function renderCreativeFrame(input: { composition: Composition; copy: StructuredCopy; plate: Buffer; timeMs?: number; plateIsDecodedVideoFrame?: boolean }) {
  const composition = validateComposition(input.composition, input.copy);
  if (!input.plateIsDecodedVideoFrame && bytesDigest(input.plate) !== composition.plate.digest) throw new CreativeError("creative.errors.sourceBinding");
  const time = input.timeMs ?? 0;
  if (!Number.isFinite(time) || time < 0 || composition.canvas.durationMs !== null && time >= composition.canvas.durationMs) throw new CreativeError("creative.errors.duration");
  const metadata = await sharp(input.plate, { failOn: "error", limitInputPixels: 16_777_216 }).metadata();
  if (metadata.width !== composition.canvas.width || metadata.height !== composition.canvas.height) throw new CreativeError("creative.errors.aspectRatio");
  const rendered = await renderLayers(composition, input.copy);
  const overlays = rendered.layers.filter((layer) => !layer.timing || time >= layer.timing.startMs && time < layer.timing.endMs).map(({ buffer, left, top }) => ({ input: buffer, left, top }));
  const buffer = await sharp(input.plate, { failOn: "error", limitInputPixels: 16_777_216 }).flatten({ background: composition.background }).composite(overlays).png().toBuffer();
  return { buffer, receipt: renderEvidence(composition, input.copy, rendered, buffer, "image/png") };
}

export async function renderCreativeVideo(input: { composition: Composition; copy: StructuredCopy; plate: Buffer; signal?: AbortSignal; ffmpegPath?: string }) {
  const composition = validateComposition(input.composition, input.copy);
  if (composition.canvas.format !== "video" || bytesDigest(input.plate) !== composition.plate.digest || input.plate.length > 500 * 1024 * 1024) throw new CreativeError("creative.errors.sourceBinding");
  if (input.signal?.aborted) throw new CreativeError("creative.errors.cancelled");
  const rendered = await renderLayers(composition, input.copy);
  const directory = await mkdtemp(join(tmpdir(), "tasmeemai-creative-"));
  try {
    const source = join(directory, "plate.mp4"); const output = join(directory, "output.mp4");
    await writeFile(source, input.plate, { flag: "wx" });
    const { ALL_FORMATS, FilePathSource, Input } = await import("mediabunny");
    const media = new Input({ formats: ALL_FORMATS, source: new FilePathSource(source) });
    try {
      const track = await media.getPrimaryVideoTrack(); const duration = await media.computeDuration();
      if (!track || track.displayWidth !== composition.canvas.width || track.displayHeight !== composition.canvas.height || Math.abs(duration * 1000 - composition.canvas.durationMs!) > Math.max(50, 1000 / composition.canvas.fps!)) throw new CreativeError("creative.errors.aspectRatio");
    } finally { media.dispose(); }
    // Exact executable configuration is deployment-owned; no shell evaluates
    // text, filenames, model output, or customer-authored copy.
    const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1", "-i", source];
    for (const [index, layer] of rendered.layers.entries()) { const file = join(directory, `layer-${index}.png`); await writeFile(file, layer.buffer, { flag: "wx" }); args.push("-i", file); }
    const filters = rendered.layers.map((layer, index) => `[${index === 0 ? "0:v" : `v${index}`}][${index + 1}:v]overlay=${layer.left}:${layer.top}:enable='gte(t,${layer.timing!.startMs / 1000})*lt(t,${layer.timing!.endMs / 1000})':eof_action=repeat[v${index + 1}]`);
    args.push("-filter_complex_threads", "1", "-filter_complex", filters.join(";"), "-map", `[v${rendered.layers.length}]`, "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(composition.canvas.fps), "-t", String(composition.canvas.durationMs! / 1000), "-c:a", "copy", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-movflags", "+faststart", output);
    try { await execFileAsync(input.ffmpegPath ?? process.env.CREATIVE_FFMPEG_PATH ?? "ffmpeg", args, { signal: input.signal, timeout: 300_000, maxBuffer: 64_000 }); }
    catch (error) { if (input.signal?.aborted) throw new CreativeError("creative.errors.cancelled"); if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw new CreativeError("creative.errors.videoRendererUnavailable"); throw new CreativeError("creative.errors.renderFailed"); }
    const buffer = await readFile(output);
    return { buffer, receipt: renderEvidence(composition, input.copy, rendered, buffer, "video/mp4") };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
