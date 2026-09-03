import { beforeEach, describe, expect, it, vi } from "vitest";

const download = vi.fn(async (_assetId: string) => ({ assetId: "asset-1", key: "key", downloadUrl: "https://media.example/output.mp4", expiresInSeconds: 60 }));
vi.mock("@/lib/studio/client", () => ({ getActiveWorkspaceId: () => "ws", getStudioAssetDownloadUrl: (assetId: string) => download(assetId), ingestStudioAsset: vi.fn(), createStudioAssetPresign: vi.fn(), finalizeStudioAssetUpload: vi.fn() }));
import { useSimpleStudioStore } from "../simpleStudioStore";

describe("Simple Studio admitted media generation", () => {
  beforeEach(() => { vi.clearAllMocks(); useSimpleStudioStore.setState({ mode: "video", prompt: "إعلان خليجي", rewrittenPrompt: null, rewriteEnabled: false, selectedModelId: "google/veo-3.1-lite", selectedModelProvider: "replicate", selectedModelName: "Veo", selectedModelVersion: "immutable-version-1", selectedModelSchemaDigest: `sha256:${"a".repeat(64)}`, aspectRatio: "9:16", batchCount: 1, sourceImage: null, videoDuration: 5, dialogueEnabled: false, arabicVariety: "gulf", rightsBasis: "owned", permittedRemix: "transform", rightsConfirmed: true, isGenerating: false, generationsByMode: { photo: [], video: [], copy: [] }, generations: [] }); });
  it("pins Workspace, brand-aware model identity, Arabic variety, rights, and 9:16 intent through the admitted endpoint", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => { expect(url).toBe("/api/studio/generations"); return { ok: true, json: async () => ({ success: true, operation: { id: "operation-1", state: "succeeded", revision: 4, metadata: { artifactIds: ["asset-1"] } }, provider: { state: "succeeded", artifactIds: ["asset-1"] } }) } as Response; }); global.fetch = fetcher as unknown as typeof fetch;
    await useSimpleStudioStore.getState().generate();
    const call = fetcher.mock.calls[0]; const init = call?.[1] as RequestInit; const body = JSON.parse(String(init.body));
    expect(call?.[0]).toBe("/api/studio/generations"); expect(body).toMatchObject({ model: { provider: "replicate", model: "google/veo-3.1-lite", version: "immutable-version-1" }, capability: "text_to_video", contentLanguage: "ar", arabicVariety: "gulf", rightsBasis: "owned", permittedRemix: "transform", quantity: 5 }); expect((init.headers as Record<string, string>)["x-workspace-id"]).toBe("ws"); expect(useSimpleStudioStore.getState().generations[0]).toMatchObject({ status: "complete", assetId: "asset-1", result: "https://media.example/output.mp4" });
  });
});
