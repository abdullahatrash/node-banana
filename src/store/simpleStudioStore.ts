/**
 * Simple Studio Store
 *
 * Lightweight Zustand store for the form-based content studio.
 */

import { create } from "zustand";
import {
  createStudioAssetPresign,
  finalizeStudioAssetUpload,
  getActiveWorkspaceId,
  getStudioAssetDownloadUrl,
  ingestStudioAsset,
} from "@/lib/studio/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SimpleStudioMode = "photo" | "video" | "copy";

export interface Generation {
  id: string;
  batchId: string;
  status: "pending" | "generating" | "complete" | "failed";
  result: string | null;
  assetId: string | null;
  error: string | null;
  mode: SimpleStudioMode;
  aspectRatio: string;
  prompt: string;
  createdAt: number;
  modelName: string | null;
}

export interface SavedPrompt {
  id: string;
  mode: SimpleStudioMode;
  name: string;
  promptText: string;
  formConfig: Record<string, unknown>;
  isPublic: boolean;
}

export interface SimpleStudioState {
  // Mode
  mode: SimpleStudioMode;
  setMode: (mode: SimpleStudioMode) => void;

  // Form state
  prompt: string;
  setPrompt: (prompt: string) => void;
  rewriteEnabled: boolean;
  setRewriteEnabled: (enabled: boolean) => void;
  rewrittenPrompt: string | null;
  selectedModelId: string | null;
  selectedModelProvider: string | null;
  selectedModelName: string | null;
  selectedModelVersion: string | null;
  selectedModelSchemaDigest: string | null;
  setSelectedModel: (id: string | null, provider?: string | null, name?: string | null, version?: string | null, schemaDigest?: string | null) => void;
  setSelectedModelId: (id: string | null) => void;
  aspectRatio: string;
  setAspectRatio: (ratio: string) => void;
  batchCount: number;
  setBatchCount: (count: number) => void;
  referenceImages: string[];
  setReferenceImages: (images: string[]) => void;
  sourceImage: string | null;
  setSourceImage: (image: string | null) => void;
  videoDuration: number;
  setVideoDuration: (duration: number) => void;
  dialogueEnabled: boolean;
  setDialogueEnabled: (enabled: boolean) => void;
  dialogueText: string;
  setDialogueText: (text: string) => void;
  dialogueLanguage: "ar" | "en";
  setDialogueLanguage: (lang: "ar" | "en") => void;
  copyModelId: string;
  setCopyModelId: (id: string) => void;
  tone: string;
  setTone: (tone: string) => void;
  platform: string;
  setPlatform: (platform: string) => void;
  outputLanguage: "ar" | "en" | "both";
  setOutputLanguage: (lang: "ar" | "en" | "both") => void;
  arabicVariety: "msa" | "gulf" | "egyptian" | "levantine" | "maghrebi" | "other";
  setArabicVariety: (value: SimpleStudioState["arabicVariety"]) => void;
  rightsBasis: "owned" | "licensed" | "public_domain" | "consented";
  setRightsBasis: (value: SimpleStudioState["rightsBasis"]) => void;
  permittedRemix: "reference_only" | "transform" | "derivative";
  setPermittedRemix: (value: SimpleStudioState["permittedRemix"]) => void;
  rightsConfirmed: boolean;
  setRightsConfirmed: (value: boolean) => void;

  // Generation (per-mode)
  isGenerating: boolean;
  isRewriting: boolean;
  currentBatchId: string | null;
  generationsByMode: Record<SimpleStudioMode, Generation[]>;
  generations: Generation[]; // derived — current mode's generations
  generate: () => Promise<void>;
  cancelGeneration: () => void;
  retryGeneration: (id: string) => Promise<void>;
  rewritePrompt: () => Promise<void>;

  // Gallery
  loadRecentResults: () => Promise<void>;

  // Prompts
  savedPrompts: SavedPrompt[];
  publicPrompts: SavedPrompt[];
  saveCurrentPrompt: (name: string) => Promise<void>;
  loadSavedPrompts: () => Promise<void>;
  loadPublicPrompts: () => Promise<void>;
  applyPrompt: (prompt: SavedPrompt) => void;
}

// ---------------------------------------------------------------------------
// Module-level abort controller (non-reactive)
// ---------------------------------------------------------------------------

let abortController: AbortController | null = null;

const CONCURRENT_LIMIT = 4;

const hasArabic = (value: string) => /[\u0600-\u06ff]/.test(value);
const terminalOperationStates = new Set(["cancelled", "succeeded", "failed_known", "outcome_unknown"]);

async function waitForAdmittedGeneration(input: { response: Record<string, unknown>; signal: AbortSignal }): Promise<{ result: string | null; assetId: string | null }> {
  const workspaceId = getActiveWorkspaceId(); if (!workspaceId) throw new Error("Select a Workspace before generating.");
  let operation = input.response.operation as Record<string, unknown> | undefined;
  const provider = input.response.provider as Record<string, unknown> | undefined;
  const cancelProviderWork = () => { if (!operation?.id || typeof operation.revision !== "number" || terminalOperationStates.has(String(operation.state))) return; void fetch(`/api/studio/operations/${encodeURIComponent(String(operation.id))}`, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId, "idempotency-key": `simple-cancel:${String(operation.id)}:${crypto.randomUUID()}` }, body: JSON.stringify({ action: "cancel", expectedRevision: operation.revision }), keepalive: true }).catch(() => {}); };
  input.signal.addEventListener("abort", cancelProviderWork, { once: true });
  for (let attempt = 0; attempt < 150 && operation && !terminalOperationStates.has(String(operation.state)); attempt++) {
    await new Promise<void>((resolve, reject) => { const timer = window.setTimeout(resolve, 2_000); input.signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); }, { once: true }); });
    const response = await fetch(`/api/studio/operations/${encodeURIComponent(String(operation.id))}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store", signal: input.signal });
    const body = await response.json() as Record<string, unknown>; if (!response.ok || !body.success) throw new Error(typeof body.error === "string" ? body.error : "Operation status is unavailable."); operation = body.operation as Record<string, unknown>;
  }
  input.signal.removeEventListener("abort", cancelProviderWork);
  if (!operation || operation.state !== "succeeded") throw new Error(operation?.state === "outcome_unknown" ? "Provider outcome is unknown. Check Operations before retrying." : `Generation ended in ${String(operation?.state ?? "an unknown state")}.`);
  const metadata = operation.metadata as Record<string, unknown> | undefined;
  const ids = Array.isArray(metadata?.artifactIds) ? metadata.artifactIds.filter((item): item is string => typeof item === "string") : Array.isArray(provider?.artifactIds) ? provider.artifactIds.filter((item): item is string => typeof item === "string") : [];
  const assetId = ids[0] ?? null; if (!assetId) throw new Error("Generation succeeded without a canonical artifact receipt.");
  const download = await getStudioAssetDownloadUrl(assetId); return { result: download.downloadUrl, assetId };
}

async function submitAdmittedGeneration(input: { state: SimpleStudioState; prompt: string; mode: "photo" | "video"; sourceAssetIds: string[]; idempotencyKey: string; signal: AbortSignal }) {
  const workspaceId = getActiveWorkspaceId(); if (!workspaceId) throw new Error("Select a Workspace before generating.");
  if (!input.state.selectedModelId || input.state.selectedModelProvider !== "replicate" || !input.state.selectedModelVersion || !input.state.selectedModelSchemaDigest) throw new Error("Choose an executable Replicate model from the admitted catalog.");
  if (!input.state.rightsConfirmed) throw new Error("Confirm that the selected inspiration rights are accurate.");
  const capability = input.mode === "video" ? (input.sourceAssetIds.length ? "image_to_video" : "text_to_video") : (input.sourceAssetIds.length ? "image_to_image" : "text_to_image");
  const contentLanguage = hasArabic(input.prompt) ? "ar" : "en";
  const response = await fetch("/api/studio/generations", { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId, "idempotency-key": input.idempotencyKey }, body: JSON.stringify({ prompt: input.prompt, model: { provider: "replicate", model: input.state.selectedModelId, version: input.state.selectedModelVersion, inputSchemaDigest: input.state.selectedModelSchemaDigest }, capability, contentLanguage, arabicVariety: contentLanguage === "ar" ? input.state.arabicVariety : null, quantity: input.mode === "video" ? input.state.videoDuration : 1, sourceAssetIds: input.sourceAssetIds, rightsBasis: input.state.rightsBasis, permittedRemix: input.state.permittedRemix, remixBrief: { preserve: ["accepted Brand Profile identity", "core subject"], transform: input.state.permittedRemix === "reference_only" ? [] : ["composition and motion for an original 9:16 result"], avoid: ["source logos or protected marks not present in the accepted Brand Profile"] } }), signal: input.signal });
  const body = await response.json() as Record<string, unknown>; if (!response.ok || !body.success) { const actions = Array.isArray(body.nextActions) ? body.nextActions as Array<Record<string, unknown>> : []; const next = actions[0]?.label; throw new Error(`${typeof body.error === "string" ? body.error : "Generation admission failed."}${typeof next === "string" ? ` Next: ${next}.` : ""}`); }
  return waitForAdmittedGeneration({ response: body, signal: input.signal });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function processInChunks<T>(
  items: T[],
  concurrency: number,
  processor: (item: T, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    if (signal.aborted) break;
    const chunk = items.slice(i, i + concurrency);
    await Promise.allSettled(chunk.map((item) => processor(item, signal)));
  }
}

/**
 * Persist a base64 data URL result to R2 via presign → PUT → finalize.
 * Returns the assetId on success, null on failure (non-fatal).
 */
async function persistToR2(
  dataUrl: string,
  mode: SimpleStudioMode,
  _prompt: string,
  _batchId: string,
): Promise<string | null> {
  try {
    // Convert data URL or remote URL to blob
    const res = await fetch(dataUrl);
    const blob = await res.blob();

    const assetType = mode === "video" ? "video" : "image";
    const ext = mode === "video" ? "mp4" : "png";
    // Use mode-aware content type rather than trusting blob.type
    // (e.g. video results may report as application/octet-stream)
    const contentType = mode === "video"
      ? "video/mp4"
      : blob.type || `image/${ext}`;

    // Presign
    const presign = await createStudioAssetPresign({
      assetType,
      contentType,
      expectedSizeBytes: blob.size,
      fileName: `simple-${mode}-${Date.now()}.${ext}`,
    });

    // Upload to R2
    await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });

    // Finalize
    await finalizeStudioAssetUpload(presign.assetId, {
      uploadState: "ready",
      sizeBytes: blob.size,
      mimeType: contentType,
    });

    return presign.assetId;
  } catch {
    // Non-fatal — generation still shows in UI, just not persisted
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Helper: update generations for a specific mode.
 * Accepts an explicit `mode` to avoid stale-closure bugs when the user
 * switches modes while a generation batch is in-flight.
 * Syncs both `generations` (derived) and `generationsByMode[mode]`.
 */
function setGenerations(
  set: (fn: (s: SimpleStudioState) => Partial<SimpleStudioState>) => void,
  mode: SimpleStudioMode,
  updater: (prev: Generation[]) => Generation[],
) {
  set((s) => {
    const updated = updater(s.generationsByMode[mode]);
    return {
      // Only update derived `generations` if the user is still viewing this mode
      ...(s.mode === mode ? { generations: updated } : {}),
      generationsByMode: { ...s.generationsByMode, [mode]: updated },
    };
  });
}

export const useSimpleStudioStore = create<SimpleStudioState>((set, get) => ({
  // Mode
  mode: "photo",
  setMode: (mode) => set((s) => ({
    mode,
    rewrittenPrompt: null,
    generations: s.generationsByMode[mode],
  })),

  // Form state
  prompt: "",
  setPrompt: (prompt) => set({ prompt, rewrittenPrompt: null }),
  rewriteEnabled: false,
  setRewriteEnabled: (enabled) => set({ rewriteEnabled: enabled }),
  rewrittenPrompt: null,
  selectedModelId: null,
  selectedModelProvider: null,
  selectedModelName: null,
  selectedModelVersion: null,
  selectedModelSchemaDigest: null,
  setSelectedModel: (id, provider = null, name = null, version = null, schemaDigest = null) =>
    set({ selectedModelId: id, selectedModelProvider: provider, selectedModelName: name, selectedModelVersion: version, selectedModelSchemaDigest: schemaDigest }),
  setSelectedModelId: (id) => set({ selectedModelId: id, selectedModelProvider: null, selectedModelName: null, selectedModelVersion: null, selectedModelSchemaDigest: null }),
  aspectRatio: "9:16",
  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
  batchCount: 4,
  setBatchCount: (count) => set({ batchCount: count }),
  referenceImages: [],
  setReferenceImages: (images) => set({ referenceImages: images }),
  sourceImage: null,
  setSourceImage: (image) => set({ sourceImage: image }),
  videoDuration: 5,
  setVideoDuration: (duration) => set({ videoDuration: duration }),
  dialogueEnabled: false,
  setDialogueEnabled: (enabled) => set({ dialogueEnabled: enabled }),
  dialogueText: "",
  setDialogueText: (text) => set({ dialogueText: text }),
  dialogueLanguage: "en",
  setDialogueLanguage: (lang) => set({ dialogueLanguage: lang }),
  copyModelId: "gemini-2.5-flash",
  setCopyModelId: (id) => set({ copyModelId: id }),
  tone: "professional",
  setTone: (tone) => set({ tone }),
  platform: "general",
  setPlatform: (platform) => set({ platform }),
  outputLanguage: "en",
  setOutputLanguage: (lang) => set({ outputLanguage: lang }),
  arabicVariety: "msa",
  setArabicVariety: (arabicVariety) => set({ arabicVariety }),
  rightsBasis: "owned",
  setRightsBasis: (rightsBasis) => set({ rightsBasis, rightsConfirmed: false }),
  permittedRemix: "transform",
  setPermittedRemix: (permittedRemix) => set({ permittedRemix, rightsConfirmed: false }),
  rightsConfirmed: false,
  setRightsConfirmed: (rightsConfirmed) => set({ rightsConfirmed }),

  // Generation
  isGenerating: false,
  isRewriting: false,
  currentBatchId: null,
  generationsByMode: { photo: [], video: [], copy: [] },
  generations: [],

  generate: async () => {
    const state = get();
    if (state.isGenerating) return;

    // Lock generation immediately to prevent double-invocation during rewrite
    set({ isGenerating: true });

    // Rewrite prompt if enabled and not already done
    if (state.rewriteEnabled && !state.rewrittenPrompt) {
      await get().rewritePrompt();
      if (!get().rewrittenPrompt) {
        set({ isGenerating: false });
        return; // rewrite failed
      }
    }

    let finalPrompt = get().rewrittenPrompt || get().prompt;
    if (!finalPrompt.trim()) {
      set({ isGenerating: false });
      return;
    }

    // Inject dialogue into video prompts when enabled
    if (state.mode === "video" && state.dialogueEnabled && state.dialogueText.trim()) {
      const langHint = state.dialogueLanguage === "ar"
        ? "speaking in Arabic"
        : "speaking in English";
      // Use colon-style dialogue to suppress subtitles (Veo 3.1 pattern)
      finalPrompt = `${finalPrompt}. The character is ${langHint}, saying: "${state.dialogueText.trim()}"`;
    }

    // Capture mode at generation start so mode switches during generation
    // don't corrupt the wrong mode's results
    const genMode = state.mode;

    const batchId = crypto.randomUUID();
    abortController = new AbortController();
    const signal = abortController.signal;

    // Create pending generation entries
    const now = Date.now();
    const displayModelName = state.selectedModelName || "Auto";
    const entries: Generation[] = Array.from(
      { length: state.batchCount },
      (_, i) => ({
        id: `gen_${batchId}_${i}`,
        batchId,
        status: "pending" as const,
        result: null,
        assetId: null,
        error: null,
        mode: genMode,
        aspectRatio: state.aspectRatio,
        prompt: finalPrompt,
        createdAt: now,
        modelName: displayModelName,
      }),
    );

    // Prepend new batch entries (keep previous results)
    setGenerations(set, genMode, (prev) => [...entries, ...prev]);
    set({ currentBatchId: batchId });

    let sourceAssetIds: string[] = [];
    if (genMode !== "copy") {
      const sources = genMode === "photo" ? state.referenceImages : state.sourceImage ? [state.sourceImage] : [];
      try {
        sourceAssetIds = await Promise.all(sources.map(async (source, index) => source.startsWith("asset:") ? source.slice(6) : (await ingestStudioAsset({ assetType: "image", sourceDataUrl: source.startsWith("data:") ? source : undefined, sourceUrl: source.startsWith("http") ? source : undefined, fileName: `inspiration-${batchId}-${index}.png` })).assetId));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Inspiration media could not be stored safely.";
        setGenerations(set, genMode, (prev) => prev.map((generation) => generation.batchId === batchId ? { ...generation, status: "failed" as const, error: message } : generation));
        set({ isGenerating: false, currentBatchId: null }); abortController = null; return;
      }
    }

    const processGeneration = async (entry: Generation, sig: AbortSignal) => {
      if (sig.aborted) return;

      // Mark as generating
      setGenerations(set, genMode, (prev) =>
        prev.map((g) => g.id === entry.id ? { ...g, status: "generating" as const } : g),
      );

      try {
        let result: string | null = null;
        let canonicalAssetId: string | null = null;

        if (genMode === "copy") {
          throw new Error("Copy providers are paused until their brand-aware intent, exact quote, reservation, provenance, and Operation adapters are qualified.");
        } else {
          const admitted = await submitAdmittedGeneration({ state, prompt: finalPrompt, mode: genMode, sourceAssetIds, idempotencyKey: `simple-studio:${entry.id}`, signal: sig });
          result = admitted.result; canonicalAssetId = admitted.assetId;
        }

        setGenerations(set, genMode, (prev) =>
          prev.map((g) => g.id === entry.id ? { ...g, status: "complete" as const, result, assetId: canonicalAssetId } : g),
        );

        // Persist image/video results to R2 in the background (non-blocking)
        // Results can be base64 data URLs or remote URLs (for large videos)
        if (!canonicalAssetId && result && (result.startsWith("data:") || result.startsWith("http"))) {
          persistToR2(result, genMode, finalPrompt, batchId).then((assetId) => {
            if (assetId) {
              setGenerations(set, genMode, (prev) =>
                prev.map((g) => g.id === entry.id ? { ...g, assetId } : g),
              );
            }
          }).catch(() => {
            // Non-fatal — asset just won't be persisted
          });
        }
      } catch (err) {
        if (sig.aborted) return;
        setGenerations(set, genMode, (prev) =>
          prev.map((g) =>
            g.id === entry.id
              ? { ...g, status: "failed" as const, error: err instanceof Error ? err.message : "Generation failed" }
              : g,
          ),
        );
      }
    };

    await processInChunks(entries, CONCURRENT_LIMIT, processGeneration, signal);

    set({ isGenerating: false, currentBatchId: null });
    abortController = null;
  },

  cancelGeneration: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    // Cancel pending/generating entries across all modes
    const modes: SimpleStudioMode[] = ["photo", "video", "copy"];
    for (const m of modes) {
      setGenerations(set, m, (prev) =>
        prev.map((g) =>
          g.status === "pending" || g.status === "generating"
            ? { ...g, status: "failed" as const, error: "Cancelled" }
            : g,
        ),
      );
    }
    set({ isGenerating: false, currentBatchId: null });
  },

  retryGeneration: async (id: string) => {
    const state = get();
    const gen = state.generations.find((g) => g.id === id);
    if (!gen || gen.status !== "failed") return;

    const genMode = gen.mode;

    // Mark as generating
    setGenerations(set, genMode, (prev) =>
      prev.map((g) => g.id === id ? { ...g, status: "generating" as const, error: null } : g),
    );

    const retryController = new AbortController();
    const sig = retryController.signal;

    try {
      let result: string | null = null;
      let canonicalAssetId: string | null = null;

      if (genMode === "copy") {
        throw new Error("Copy providers are paused until their admitted execution adapters are qualified.");
      } else {
        const sources = genMode === "photo" ? state.referenceImages : state.sourceImage ? [state.sourceImage] : [];
        const sourceAssetIds = await Promise.all(sources.map(async (source, index) => source.startsWith("asset:") ? source.slice(6) : (await ingestStudioAsset({ assetType: "image", sourceDataUrl: source.startsWith("data:") ? source : undefined, sourceUrl: source.startsWith("http") ? source : undefined, fileName: `retry-inspiration-${id}-${index}.png` })).assetId));
        const admitted = await submitAdmittedGeneration({ state, prompt: gen.prompt, mode: genMode, sourceAssetIds, idempotencyKey: `simple-studio-retry:${id}:${crypto.randomUUID()}`, signal: sig }); result = admitted.result; canonicalAssetId = admitted.assetId;
      }

      setGenerations(set, genMode, (prev) =>
        prev.map((g) => g.id === id ? { ...g, status: "complete" as const, result, assetId: canonicalAssetId } : g),
      );

      if (!canonicalAssetId && result && (result.startsWith("data:") || result.startsWith("http"))) {
        persistToR2(result, genMode, gen.prompt, gen.batchId).then((assetId) => {
          if (assetId) {
            setGenerations(set, genMode, (prev) =>
              prev.map((g) => g.id === id ? { ...g, assetId } : g),
            );
          }
        }).catch(() => {});
      }
    } catch (err) {
      if (sig.aborted) return;
      setGenerations(set, genMode, (prev) =>
        prev.map((g) =>
          g.id === id
            ? { ...g, status: "failed" as const, error: err instanceof Error ? err.message : "Generation failed" }
            : g,
        ),
      );
    }
  },

  rewritePrompt: async () => {
    set({ isRewriting: false, rewrittenPrompt: null });
  },

  // Gallery
  loadRecentResults: async () => {
    try {
      const currentMode = get().mode;
      const res = await fetch("/api/studio/assets?source=simple");
      const data = await res.json();
      if (data.success && data.assets) {
        const entries: Generation[] = data.assets.map(
          (asset: Record<string, unknown>) => {
            const metadata = (asset.metadata as Record<string, unknown>) || {};
            return {
              id: asset.id as string,
              batchId: (metadata.batchId as string) || "unknown",
              status: "complete" as const,
              result: asset.storageKey as string,
              assetId: asset.id as string,
              error: null,
              mode: (metadata.mode as SimpleStudioMode) || "photo",
              aspectRatio: (metadata.aspectRatio as string) || "1:1",
              prompt: (metadata.prompt as string) || "",
              createdAt: (metadata.createdAt as number) || Date.now(),
              modelName: (metadata.modelName as string) || null,
            };
          },
        );
        setGenerations(set, currentMode, () => entries);
      }
    } catch {
      // Non-fatal — gallery just stays empty
    }
  },

  // Prompts
  savedPrompts: [],
  publicPrompts: [],

  saveCurrentPrompt: async (name: string) => {
    const state = get();
    try {
      const res = await fetch("/api/studio/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: state.mode,
          name,
          promptText: state.prompt,
          formConfig: {
            selectedModelId: state.selectedModelId,
            selectedModelProvider: state.selectedModelProvider,
            selectedModelName: state.selectedModelName,
            aspectRatio: state.aspectRatio,
            batchCount: state.batchCount,
            tone: state.tone,
            platform: state.platform,
            outputLanguage: state.outputLanguage,
            videoDuration: state.videoDuration,
            dialogueEnabled: state.dialogueEnabled,
            dialogueText: state.dialogueText,
            dialogueLanguage: state.dialogueLanguage,
            copyModelId: state.copyModelId,
          },
        }),
      });
      const data = await res.json();
      if (data.success && data.prompt) {
        set((s) => ({ savedPrompts: [data.prompt, ...s.savedPrompts] }));
      }
    } catch {
      // Non-fatal
    }
  },

  loadSavedPrompts: async () => {
    const { mode } = get();
    try {
      const res = await fetch(`/api/studio/prompts?mode=${mode}`);
      const data = await res.json();
      if (data.success && data.prompts) {
        set({ savedPrompts: data.prompts });
      }
    } catch {
      // Non-fatal
    }
  },

  loadPublicPrompts: async () => {
    const { mode } = get();
    try {
      const res = await fetch(`/api/studio/prompts/public?mode=${mode}`);
      const data = await res.json();
      if (data.success && data.prompts) {
        set({ publicPrompts: data.prompts });
      }
    } catch {
      // Non-fatal
    }
  },

  applyPrompt: (prompt: SavedPrompt) => {
    const config = prompt.formConfig || {};
    set({
      mode: prompt.mode,
      prompt: prompt.promptText,
      rewrittenPrompt: null,
      selectedModelId: (config.selectedModelId as string) || null,
      selectedModelProvider: (config.selectedModelProvider as string) || null,
      selectedModelName: (config.selectedModelName as string) || null,
      aspectRatio: (config.aspectRatio as string) || "1:1",
      batchCount: (config.batchCount as number) || 4,
      tone: (config.tone as string) || "professional",
      platform: (config.platform as string) || "general",
      outputLanguage: (config.outputLanguage as "ar" | "en" | "both") || "en",
      videoDuration: (config.videoDuration as number) || 5,
      dialogueEnabled: (config.dialogueEnabled as boolean) || false,
      dialogueText: (config.dialogueText as string) || "",
      dialogueLanguage: (config.dialogueLanguage as "ar" | "en") || "en",
      copyModelId: (config.copyModelId as string) || "gemini-2.5-flash",
    });
  },
}));
