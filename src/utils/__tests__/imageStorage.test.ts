import { beforeEach, describe, expect, it, vi } from "vitest";
import { externalizeWorkflowImages, hydrateWorkflowImages } from "../imageStorage";
import type { WorkflowFile } from "@/store/workflowStore";

const mockIsCloudMode = vi.fn();
const mockIngestStudioAsset = vi.fn();
const mockGetStudioAssetDownloadUrl = vi.fn();
const mockGetLegacyStudioAssetDownloadUrl = vi.fn();

vi.mock("@/lib/storage", () => ({
  isCloudMode: () => mockIsCloudMode(),
}));

vi.mock("@/lib/studio/client", () => ({
  ingestStudioAsset: (...args: unknown[]) => mockIngestStudioAsset(...args),
  getStudioAssetDownloadUrl: (...args: unknown[]) => mockGetStudioAssetDownloadUrl(...args),
  getLegacyStudioAssetDownloadUrl: (...args: unknown[]) => mockGetLegacyStudioAssetDownloadUrl(...args),
}));

describe("imageStorage cloud mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCloudMode.mockReturnValue(true);
    mockIngestStudioAsset.mockResolvedValue({
      assetId: "asset_1",
      key: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
      downloadUrl: "https://example-download",
      expiresInSeconds: 900,
    });
    mockGetStudioAssetDownloadUrl.mockResolvedValue({
      assetId: "asset_1",
      key: "env/dev/ws/ws_1/proj/proj_1/image/2026/03/29/file.png",
      downloadUrl: "https://example-download",
      expiresInSeconds: 900,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => ({
        type: "image/png",
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    }) as unknown as typeof fetch;
  });

  it("externalizes base64 refs to canonical asset IDs without requiring workflowPath", async () => {
    const workflow: WorkflowFile = {
      version: 1,
      id: "proj_1",
      name: "Test",
      nodes: [
        {
          id: "img-1",
          type: "imageInput",
          position: { x: 0, y: 0 },
          data: {
            image: "data:image/png;base64,aGVsbG8=",
            imageRef: undefined,
          },
        },
      ] as WorkflowFile["nodes"],
      edges: [],
      edgeStyle: "angular",
    };

    const externalized = await externalizeWorkflowImages(workflow, {
      workflowPath: null,
      projectId: "proj_1",
    });

    const nodeData = externalized.nodes[0].data as { image: string | null; imageRef?: string };
    expect(nodeData.image).toBeNull();
    expect(nodeData.imageRef).toBe("asset_1");
    expect(mockIngestStudioAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj_1",
        assetType: "image",
      }),
    );
  });

  it("hydrates cloud assetId refs via authorized download URLs", async () => {
    const workflow: WorkflowFile = {
      version: 1,
      id: "proj_1",
      name: "Hydrate",
      nodes: [
        {
          id: "img-1",
          type: "imageInput",
          position: { x: 0, y: 0 },
          data: {
            image: null,
            imageRef: "asset_1",
          },
        },
      ] as WorkflowFile["nodes"],
      edges: [],
      edgeStyle: "angular",
    };

    const hydrated = await hydrateWorkflowImages(workflow, {
      projectId: "proj_1",
    });
    const nodeData = hydrated.nodes[0].data as { image: string | null };

    expect(nodeData.image?.startsWith("data:image/png;base64,")).toBe(true);
    expect(mockGetStudioAssetDownloadUrl).toHaveBeenCalledWith("asset_1");
  });
});
