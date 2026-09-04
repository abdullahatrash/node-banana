import { describe, expect, it } from "vitest";
import type { GenerationIntent } from "@/lib/model-routing/types";
import { isAdmittedContentArtifact, validateReadyPortraitAsset } from "../content-lineage";

const digest = `sha256:${"a".repeat(64)}`;
const video = { id: "source", type: "video", checksum: digest, width: 1080, height: 1920, durationSeconds: 15, uploadState: "ready" };
const artifact = { ...video, id: "result" };
const intent = { id: "intent", capability: "video_to_video", rights: { sourceAssetIds: ["source"] }, outputContract: { mediaType: "video", aspectRatio: "9:16" } } as GenerationIntent;
const admitted = { format: "wall_of_text" as const, sourceAssets: [video], personaState: null, generation: { assetId: "result", intentId: "intent", operationId: "generation:intent" }, receipt: { assetId: "result", intentId: "intent", status: "ready", contentDigest: digest, width: 1080, height: 1920, durationSeconds: "15" }, intent, operation: { state: "succeeded", artifactIds: ["result"] }, artifact };

describe("Content Render Proof lineage", () => {
  it("accepts only a ready portrait artifact from the exact admitted intent", () => {
    expect(isAdmittedContentArtifact(admitted)).toBe(true);
    expect(isAdmittedContentArtifact({ ...admitted, operation: { state: "running", artifactIds: ["result"] } })).toBe(false);
    expect(isAdmittedContentArtifact({ ...admitted, intent: { ...intent, capability: "image_to_video" } })).toBe(false);
    expect(isAdmittedContentArtifact({ ...admitted, artifact: { ...artifact, checksum: `sha256:${"b".repeat(64)}` } })).toBe(false);
  });

  it("rejects square, unprobed, and overlong upload candidates", () => {
    expect(validateReadyPortraitAsset({ ...video, width: 1080, height: 1080 }, "video")).toBe("CONTENT_ASSET_9_16_REQUIRED");
    expect(validateReadyPortraitAsset({ ...video, uploadState: "pending" }, "video")).toBe("CONTENT_ASSET_NOT_READY");
    expect(validateReadyPortraitAsset({ ...video, durationSeconds: 61 }, "video")).toBe("CONTENT_VIDEO_DURATION_INVALID");
  });
});
