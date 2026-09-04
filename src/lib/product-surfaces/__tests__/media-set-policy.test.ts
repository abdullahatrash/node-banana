import { describe, expect, it } from "vitest";
import { DEMO_VIDEO_MAX_BYTES, mediaSetAssetIssue } from "../media-set-policy";

const ready = { id: "asset_1", type: "video", mimeType: "video/mp4", sizeBytes: 10_000, durationSeconds: 12, checksum: `sha256:${"a".repeat(64)}`, metadata: { uploadState: "ready" } };

describe("Media Set asset policy", () => {
  it("admits only server-verified MP4 or MOV Demo Videos within both limits", () => {
    expect(mediaSetAssetIssue("demo_videos", ready)).toBeNull();
    expect(mediaSetAssetIssue("demo_videos", { ...ready, mimeType: "video/quicktime" })).toBeNull();
    expect(mediaSetAssetIssue("demo_videos", { ...ready, type: "image" })).toBe("DEMO_VIDEO_TYPE_INVALID");
    expect(mediaSetAssetIssue("demo_videos", { ...ready, mimeType: "video/webm" })).toBe("DEMO_VIDEO_FORMAT_INVALID");
    expect(mediaSetAssetIssue("demo_videos", { ...ready, sizeBytes: DEMO_VIDEO_MAX_BYTES + 1 })).toBe("DEMO_VIDEO_SIZE_INVALID");
    expect(mediaSetAssetIssue("demo_videos", { ...ready, durationSeconds: 31 })).toBe("DEMO_VIDEO_DURATION_INVALID");
  });

  it("fails closed when trusted upload evidence is absent", () => {
    expect(mediaSetAssetIssue("demo_videos", { ...ready, checksum: null })).toBe("MEDIA_SET_ASSET_NOT_AVAILABLE");
    expect(mediaSetAssetIssue("demo_videos", { ...ready, metadata: { uploadState: "pending" } })).toBe("MEDIA_SET_ASSET_NOT_AVAILABLE");
  });
});
