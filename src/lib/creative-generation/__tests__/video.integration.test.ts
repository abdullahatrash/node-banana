// @vitest-environment node
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_FORMATS, FilePathSource, Input } from "mediabunny";
import { renderCreativeVideo } from "../render";
import { composition, copy } from "./fixtures";

const exec = promisify(execFile);
const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { timeout: 10_000 }).status === 0;
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe.skipIf(!ffmpegAvailable)("local FFmpeg 9:16 composition integration (no inference)", () => {
  it("exports bilingual timed copy over owned video using the same measured layer contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "creative-video-test-")); directories.push(directory);
    const platePath = join(directory, "plate.mp4");
    await exec("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xa2b3c4:s=720x1280:r=24:d=1", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", platePath]);
    const plate = await readFile(platePath); const digest = `sha256:${createHash("sha256").update(plate).digest("hex")}`;
    const text = copy(); for (const block of text.blocks) block.timing = { startMs: 0, endMs: 1000 };
    const layout = composition(text, digest); layout.canvas = { ...layout.canvas, format: "video", durationMs: 1000, fps: 24 };
    const result = await renderCreativeVideo({ composition: layout, copy: text, plate });
    expect(result.receipt.output).toMatchObject({ format: "video", mimeType: "video/mp4", width: 720, height: 1280, durationMs: 1000, fps: 24 });
    expect(result.receipt.layout).toHaveLength(2);
    expect(result.receipt.reviewRequired).toBe(true);
    const output = join(directory, "output.mp4"); await writeFile(output, result.buffer);
    const media = new Input({ formats: ALL_FORMATS, source: new FilePathSource(output) });
    try { const track = await media.getPrimaryVideoTrack(); expect(track?.displayWidth).toBe(720); expect(track?.displayHeight).toBe(1280); expect(await media.computeDuration()).toBeCloseTo(1, 1); } finally { media.dispose(); }
    const aborted = new AbortController(); aborted.abort();
    await expect(renderCreativeVideo({ composition: layout, copy: text, plate, signal: aborted.signal })).rejects.toThrow("creative.errors.cancelled");
  }, 30_000);
});
