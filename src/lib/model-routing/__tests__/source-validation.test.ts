import { describe, expect, it } from "vitest";
import { validateGenerationSources, type CanonicalGenerationSource } from "../source-validation";

const source = (overrides: Partial<CanonicalGenerationSource> = {}): CanonicalGenerationSource => ({ id: "asset-1", type: "image", storageKey: "workspace/asset.png", checksum: `sha256:${"a".repeat(64)}`, mimeType: "image/png", width: 1080, height: 1920, durationSeconds: null, metadata: { uploadState: "ready", dimensionEvidence: "server-media-probe/v1" }, ...overrides });

describe("paid generation source admission", () => {
  it("accepts a single canonical server-decoded 9:16 I2V source", () => {
    expect(validateGenerationSources("image_to_video", ["asset-1"], [source()])).toEqual({ ok: true });
  });

  it("admits ordered multi-image recipes only for an array-qualified model contract", () => {
    const sources = [source({ id: "asset-1" }), source({ id: "asset-2" })];
    expect(validateGenerationSources("image_to_video", sources.map((item) => item.id), sources, "array")).toEqual({ ok: true });
    expect(validateGenerationSources("image_to_video", sources.map((item) => item.id), sources, "single")).toEqual({ ok: false, code: "SOURCE_CARDINALITY_INVALID" });
  });

  it("rejects missing decoded evidence before provider admission", () => {
    expect(validateGenerationSources("image_to_video", ["asset-1"], [source({ metadata: { uploadState: "ready" } })])).toEqual({ ok: false, code: "SOURCE_DECODED_DIMENSIONS_REQUIRED" });
  });

  it("rejects non-9:16 and non-image inputs", () => {
    expect(validateGenerationSources("image_to_video", ["asset-1"], [source({ width: 1920, height: 1080 })])).toEqual({ ok: false, code: "SOURCE_9_16_REQUIRED" });
    expect(validateGenerationSources("image_to_video", ["asset-1"], [source({ type: "video" })])).toEqual({ ok: false, code: "SOURCE_MEDIA_TYPE_MISMATCH" });
  });

  it("requires one ready 9:16 canonical video for video remix", () => {
    expect(validateGenerationSources("video_to_video", ["asset-1"], [source({ type: "video", mimeType: "video/mp4", durationSeconds: 12 })])).toEqual({ ok: true });
    expect(validateGenerationSources("video_to_video", ["asset-1"], [source({ type: "video", mimeType: "video/avi", durationSeconds: 12 })])).toEqual({ ok: false, code: "SOURCE_VIDEO_FORMAT_UNSUPPORTED" });
    expect(validateGenerationSources("video_to_video", ["asset-1"], [source({ type: "video", mimeType: "video/mp4", durationSeconds: 61 })])).toEqual({ ok: false, code: "SOURCE_VIDEO_DURATION_INVALID" });
  });

  it("rejects source media for text-only capabilities and duplicate source ids", () => {
    expect(validateGenerationSources("text_to_video", ["asset-1"], [source()])).toEqual({ ok: false, code: "SOURCE_CARDINALITY_INVALID" });
    expect(validateGenerationSources("image_to_image", ["asset-1", "asset-1"], [source(), source({ id: "asset-2" })], "array")).toEqual({ ok: false, code: "SOURCE_ASSET_DUPLICATE" });
  });
});
