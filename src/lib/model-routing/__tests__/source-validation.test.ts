import { describe, expect, it } from "vitest";
import { validateGenerationSources, type CanonicalGenerationSource } from "../source-validation";

const source = (overrides: Partial<CanonicalGenerationSource> = {}): CanonicalGenerationSource => ({ id: "asset-1", type: "image", storageKey: "workspace/asset.png", checksum: `sha256:${"a".repeat(64)}`, width: 1080, height: 1920, metadata: { uploadState: "ready", dimensionEvidence: "server-media-probe/v1" }, ...overrides });

describe("paid generation source admission", () => {
  it("accepts a single canonical server-decoded 9:16 I2V source", () => {
    expect(validateGenerationSources("image_to_video", ["asset-1"], [source()])).toEqual({ ok: true });
  });

  it("rejects missing decoded evidence before provider admission", () => {
    expect(validateGenerationSources("image_to_video", ["asset-1"], [source({ metadata: { uploadState: "ready" } })])).toEqual({ ok: false, code: "SOURCE_DECODED_DIMENSIONS_REQUIRED" });
  });

  it("rejects non-9:16 and non-image inputs", () => {
    expect(validateGenerationSources("image_to_video", ["asset-1"], [source({ width: 1920, height: 1080 })])).toEqual({ ok: false, code: "SOURCE_9_16_REQUIRED" });
    expect(validateGenerationSources("image_to_video", ["asset-1"], [source({ type: "video" })])).toEqual({ ok: false, code: "SOURCE_MEDIA_TYPE_MISMATCH" });
  });
});
