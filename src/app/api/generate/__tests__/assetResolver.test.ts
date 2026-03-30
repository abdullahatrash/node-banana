import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAsset = vi.fn();
const mockGetObjectFromS3 = vi.fn();

vi.mock("@/lib/studio/repository", () => ({
  getAsset: (...args: unknown[]) => mockGetAsset(...args),
}));

vi.mock("@/lib/storage/s3", () => ({
  getObjectFromS3: (...args: unknown[]) => mockGetObjectFromS3(...args),
}));

import { resolveAssetRefsInPayload } from "../assetResolver";

describe("resolveAssetRefsInPayload", () => {
  const workspaceId = "ws_test123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through base64 data URLs unchanged", async () => {
    const images = ["data:image/png;base64,abc123"];
    const result = await resolveAssetRefsInPayload({ images, workspaceId });
    expect(result.images).toEqual(["data:image/png;base64,abc123"]);
    expect(mockGetAsset).not.toHaveBeenCalled();
  });

  it("passes through non-asset strings unchanged", async () => {
    const images = ["https://example.com/image.png"];
    const result = await resolveAssetRefsInPayload({ images, workspaceId });
    expect(result.images).toEqual(["https://example.com/image.png"]);
  });

  it("resolves asset_xxx references to base64 data URLs", async () => {
    mockGetAsset.mockResolvedValue({
      storageKey: "env/production/ws/ws_test/image.png",
      mimeType: "image/png",
    });
    mockGetObjectFromS3.mockResolvedValue({
      body: Buffer.from("fakepngdata"),
      contentType: "image/png",
    });

    const images = ["asset_abc123"];
    const result = await resolveAssetRefsInPayload({ images, workspaceId });

    expect(mockGetAsset).toHaveBeenCalledWith(workspaceId, "asset_abc123");
    expect(mockGetObjectFromS3).toHaveBeenCalledWith({
      key: "env/production/ws/ws_test/image.png",
    });
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("handles mixed asset refs and base64 in images array", async () => {
    mockGetAsset.mockResolvedValue({
      storageKey: "key.png",
      mimeType: "image/jpeg",
    });
    mockGetObjectFromS3.mockResolvedValue({
      body: Buffer.from("data"),
      contentType: "image/jpeg",
    });

    const images = ["data:image/png;base64,inline", "asset_ref1"];
    const result = await resolveAssetRefsInPayload({ images, workspaceId });

    expect(result.images[0]).toBe("data:image/png;base64,inline");
    expect(result.images[1]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("resolves asset refs in dynamicInputs string values", async () => {
    mockGetAsset.mockResolvedValue({ storageKey: "k.png", mimeType: "image/png" });
    mockGetObjectFromS3.mockResolvedValue({
      body: Buffer.from("x"),
      contentType: "image/png",
    });

    const result = await resolveAssetRefsInPayload({
      images: [],
      dynamicInputs: { first_frame: "asset_frame1", prompt: "hello" },
      workspaceId,
    });

    expect(result.dynamicInputs.first_frame).toMatch(/^data:image\/png;base64,/);
    expect(result.dynamicInputs.prompt).toBe("hello");
  });

  it("resolves asset refs in dynamicInputs array values", async () => {
    mockGetAsset.mockResolvedValue({ storageKey: "k.png", mimeType: "image/png" });
    mockGetObjectFromS3.mockResolvedValue({
      body: Buffer.from("x"),
      contentType: "image/png",
    });

    const result = await resolveAssetRefsInPayload({
      images: [],
      dynamicInputs: { frames: ["asset_f1", "data:image/png;base64,inline"] },
      workspaceId,
    });

    const frames = result.dynamicInputs.frames as string[];
    expect(frames[0]).toMatch(/^data:image\/png;base64,/);
    expect(frames[1]).toBe("data:image/png;base64,inline");
  });

  it("throws when asset not found", async () => {
    mockGetAsset.mockResolvedValue(null);

    await expect(
      resolveAssetRefsInPayload({
        images: ["asset_missing"],
        workspaceId,
      }),
    ).rejects.toThrow("Asset not found: asset_missing");
  });

  it("returns empty arrays when no inputs provided", async () => {
    const result = await resolveAssetRefsInPayload({ workspaceId });
    expect(result.images).toEqual([]);
    expect(result.dynamicInputs).toEqual({});
  });
});
