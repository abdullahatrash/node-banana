import { beforeEach, describe, expect, it, vi } from "vitest";

const download = vi.fn(async (_assetId: string) => ({ assetId: "asset-1", key: "key", downloadUrl: "https://media.example/output.mp4", expiresInSeconds: 60 }));
vi.mock("@/lib/studio/client", () => ({ getActiveWorkspaceId: () => "ws", getStudioAssetDownloadUrl: (assetId: string) => download(assetId), ingestStudioAsset: vi.fn(), createStudioAssetPresign: vi.fn(), finalizeStudioAssetUpload: vi.fn() }));
import { useSimpleStudioStore } from "../simpleStudioStore";

describe("Simple Studio admitted media generation", () => {
  beforeEach(() => { vi.clearAllMocks(); useSimpleStudioStore.setState({ mode: "video", prompt: "إعلان خليجي", rewrittenPrompt: null, rewriteEnabled: false, selectedModelId: "google/veo-3.1-lite", selectedModelProvider: "replicate", selectedModelName: "Veo", selectedModelVersion: "immutable-version-1", selectedModelSchemaDigest: `sha256:${"a".repeat(64)}`, aspectRatio: "9:16", batchCount: 1, sourceImage: null, sourceMediaType: null, videoDuration: 5, dialogueEnabled: false, dialogueLanguage: "ar", arabicVariety: "gulf", fundingMode: "byok", rightsBasis: "owned", permittedRemix: "transform", rightsConfirmed: true, isGenerating: false, generationsByMode: { photo: [], video: [], copy: [] }, generations: [] }); });
  it("pins Workspace, brand-aware model identity, Arabic variety, rights, and 9:16 intent through the admitted endpoint", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      const payload = String(url) === "/api/studio/generations"
        ? { success: true, intentId: "intent-1", operation: { id: "operation-1", state: "admitted", revision: 2, metadata: {} } }
        : { success: true, result: { kind: "accepted", operation: { id: "operation-1", state: "succeeded", revision: 4, metadata: { artifactIds: ["asset-1"] } }, provider: { state: "succeeded", artifactIds: ["asset-1"] } } };
      return { ok: true, json: async () => payload } as Response;
    }); global.fetch = fetcher as unknown as typeof fetch;
    await useSimpleStudioStore.getState().generate();
    const call = fetcher.mock.calls[0]; const init = call?.[1] as RequestInit; const body = JSON.parse(String(init.body));
    expect(call?.[0]).toBe("/api/studio/generations"); expect(body).toMatchObject({ model: { provider: "replicate", model: "google/veo-3.1-lite", version: "immutable-version-1" }, capability: "text_to_video", contentLanguage: "ar", arabicVariety: "gulf", rightsBasis: "owned", permittedRemix: "transform", quantity: 5 }); expect((init.headers as Record<string, string>)["x-workspace-id"]).toBe("ws"); expect(useSimpleStudioStore.getState().generations[0]).toMatchObject({ status: "complete", assetId: "asset-1", result: "https://media.example/output.mp4" });
  });

  it("selects video-to-video admission for an ordered canonical trending video source", async () => {
    useSimpleStudioStore.setState({ sourceImage: "asset:trending-video", sourceMediaType: "video" });
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      const payload = String(url) === "/api/studio/generations"
        ? { success: true, intentId: "intent-2", operation: { id: "operation-2", state: "admitted", revision: 2, metadata: {} } }
        : { success: true, result: { kind: "accepted", operation: { id: "operation-2", state: "succeeded", revision: 4, metadata: { artifactIds: ["asset-1"] } } } };
      return { ok: true, json: async () => payload } as Response;
    });
    global.fetch = fetcher as unknown as typeof fetch;
    await useSimpleStudioStore.getState().generate();
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toMatchObject({ capability: "video_to_video", sourceAssetIds: ["trending-video"] });
  });

  it("durably cancels an admitted operation when cancellation happens during admission", async () => {
    let finishAdmission!: (value: Response) => void;
    const admission = new Promise<Response>((resolve) => { finishAdmission = resolve; });
    const fetcher = vi.fn((url: RequestInfo | URL) => {
      if (String(url) === "/api/studio/generations") return admission;
      if (String(url).includes("/api/studio/operations/operation-3")) return Promise.resolve({ ok: true, json: async () => ({ success: true }) } as Response);
      throw new Error(`unexpected provider execution: ${String(url)}`);
    });
    global.fetch = fetcher as unknown as typeof fetch;
    const generation = useSimpleStudioStore.getState().generate();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/studio/generations", expect.anything()));
    useSimpleStudioStore.getState().cancelGeneration();
    finishAdmission({ ok: true, json: async () => ({ success: true, intentId: "intent-3", operation: { id: "operation-3", state: "admitted", revision: 2, metadata: {} } }) } as Response);
    await generation;
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/api/studio/operations/operation-3"))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/execute"))).toBe(false);
  });

  it("runs copy through text admission and resolves the canonical output receipt", async () => {
    useSimpleStudioStore.setState({
      mode: "copy",
      prompt: "اكتب إعلاناً قصيراً",
      selectedModelId: "meta/meta-llama-3-8b-instruct",
      selectedModelProvider: "replicate",
      selectedModelName: "Llama 3 8B Instruct",
      selectedModelVersion: "immutable-text-version",
      selectedModelSchemaDigest: `sha256:${"b".repeat(64)}`,
      tone: "friendly",
      platform: "instagram",
      outputLanguage: "ar",
    });
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/studio/generations") return { ok: true, json: async () => ({ success: true, intentId: "intent-copy", operation: { id: "operation-copy", state: "admitted", revision: 2, metadata: {} } }) } as Response;
      if (path.includes("/execute")) return { ok: true, json: async () => ({ success: true, result: { kind: "accepted", operation: { id: "operation-copy", state: "succeeded", revision: 4, metadata: { textOutputIds: ["text-output-1"] } }, provider: { state: "succeeded", textOutputIds: ["text-output-1"] } } }) } as Response;
      if (path === "/api/studio/copy/outputs/text-output-1") return { ok: true, json: async () => ({ success: true, output: { content: "إعلان جاهز للنشر" } }) } as Response;
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? "GET"}`);
    });
    global.fetch = fetcher as unknown as typeof fetch;

    await useSimpleStudioStore.getState().generate();

    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toMatchObject({ capability: "text_generation", sourceAssetIds: [], quantity: 1, contentLanguage: "ar" });
    expect(useSimpleStudioStore.getState().generations[0]).toMatchObject({ status: "complete", assetId: null, result: "إعلان جاهز للنشر" });
  });

  it("preserves the admitted backend recovery action on a failed generation", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "DURABLE_REPLICATE_CREDENTIAL_REQUIRED",
      nextActions: [{ code: "configure_provider_key", href: "/settings?section=providers" }],
    }), { status: 422, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    await useSimpleStudioStore.getState().generate();

    expect(useSimpleStudioStore.getState().generations[0]).toMatchObject({
      status: "failed",
      error: "DURABLE_REPLICATE_CREDENTIAL_REQUIRED",
      nextActionCode: "configure_provider_key",
      nextActionHref: "/settings?section=providers",
    });
  });
});
