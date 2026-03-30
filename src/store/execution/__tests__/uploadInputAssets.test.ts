import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsCloudMode = vi.fn();
const mockIngestStudioAsset = vi.fn();

vi.mock("@/lib/storage", () => ({
  isCloudMode: () => mockIsCloudMode(),
}));

vi.mock("@/lib/studio/client", () => ({
  ingestStudioAsset: (...args: unknown[]) => mockIngestStudioAsset(...args),
}));

import { uploadImagesToR2 } from "../uploadInputAssets";

describe("uploadImagesToR2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through unchanged in local mode", async () => {
    mockIsCloudMode.mockReturnValue(false);

    const images = ["data:image/png;base64,abc123"];
    const result = await uploadImagesToR2({ images });

    expect(result.images).toEqual(images);
    expect(mockIngestStudioAsset).not.toHaveBeenCalled();
  });

  it("uploads base64 images and returns asset IDs in cloud mode", async () => {
    mockIsCloudMode.mockReturnValue(true);
    mockIngestStudioAsset.mockResolvedValue({
      assetId: "asset_uploaded1",
      key: "k",
      downloadUrl: "https://r2/k",
      expiresInSeconds: 900,
    });

    const images = ["data:image/png;base64,abc123"];
    const result = await uploadImagesToR2({ images, projectId: "proj1" });

    expect(result.images).toEqual(["asset_uploaded1"]);
    expect(mockIngestStudioAsset).toHaveBeenCalledWith({
      projectId: "proj1",
      assetType: "image",
      sourceDataUrl: "data:image/png;base64,abc123",
    });
  });

  it("does not re-upload existing asset refs", async () => {
    mockIsCloudMode.mockReturnValue(true);

    const images = ["asset_existing"];
    const result = await uploadImagesToR2({ images });

    expect(result.images).toEqual(["asset_existing"]);
    expect(mockIngestStudioAsset).not.toHaveBeenCalled();
  });

  it("passes through non-data-URL strings (text values)", async () => {
    mockIsCloudMode.mockReturnValue(true);

    const images = ["just some text", "https://example.com/img.png"];
    const result = await uploadImagesToR2({ images });

    expect(result.images).toEqual(images);
    expect(mockIngestStudioAsset).not.toHaveBeenCalled();
  });

  it("deduplicates identical data URLs", async () => {
    mockIsCloudMode.mockReturnValue(true);
    mockIngestStudioAsset.mockResolvedValue({
      assetId: "asset_dedup",
      key: "k",
      downloadUrl: "u",
      expiresInSeconds: 900,
    });

    const dataUrl = "data:image/png;base64,samecontent";
    const result = await uploadImagesToR2({ images: [dataUrl, dataUrl] });

    expect(result.images).toEqual(["asset_dedup", "asset_dedup"]);
    expect(mockIngestStudioAsset).toHaveBeenCalledTimes(1);
  });

  it("falls back to base64 on upload failure", async () => {
    mockIsCloudMode.mockReturnValue(true);
    mockIngestStudioAsset.mockRejectedValue(new Error("upload failed"));

    const dataUrl = "data:image/png;base64,failme";
    const result = await uploadImagesToR2({ images: [dataUrl] });

    expect(result.images).toEqual([dataUrl]);
  });

  it("uploads data URL values in dynamicInputs", async () => {
    mockIsCloudMode.mockReturnValue(true);
    mockIngestStudioAsset.mockResolvedValue({
      assetId: "asset_dyn",
      key: "k",
      downloadUrl: "u",
      expiresInSeconds: 900,
    });

    const result = await uploadImagesToR2({
      images: [],
      dynamicInputs: {
        first_frame: "data:image/png;base64,frame1",
        prompt: "some text",
      },
    });

    expect(result.dynamicInputs.first_frame).toBe("asset_dyn");
    expect(result.dynamicInputs.prompt).toBe("some text");
  });
});
