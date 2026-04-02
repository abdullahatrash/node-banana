/**
 * Simple Studio Store
 *
 * Lightweight Zustand store for the form-based Simple Studio mode.
 * Completely independent from workflowStore — no dependency on
 * nodes, edges, React Flow, or the workflow execution pipeline.
 */

import { create } from "zustand";
import {
  createStudioAssetPresign,
  finalizeStudioAssetUpload,
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
  setSelectedModel: (id: string | null, provider?: string | null, name?: string | null) => void;
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
  prompt: string,
  batchId: string,
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
  setSelectedModel: (id, provider = null, name = null) =>
    set({ selectedModelId: id, selectedModelProvider: provider, selectedModelName: name }),
  setSelectedModelId: (id) => set({ selectedModelId: id, selectedModelProvider: null, selectedModelName: null }),
  aspectRatio: "1:1",
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

    const processGeneration = async (entry: Generation, sig: AbortSignal) => {
      if (sig.aborted) return;

      // Mark as generating
      setGenerations(set, genMode, (prev) =>
        prev.map((g) => g.id === entry.id ? { ...g, status: "generating" as const } : g),
      );

      try {
        let result: string | null = null;

        if (state.mode === "copy") {
          // Use /api/studio/copy streaming endpoint
          const langDirective = state.outputLanguage === "ar"
            ? "Write in Arabic only."
            : state.outputLanguage === "both"
              ? "Write in both Arabic and English."
              : "Write in English only.";
          const systemPrompt = `You are a professional copywriter. ${langDirective} Platform: ${state.platform}. Tone: ${state.tone}. Return ONLY the copy text, no explanations or meta-commentary.`;

          const res = await fetch("/api/studio/copy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [{ id: entry.id, role: "user", parts: [{ type: "text", text: finalPrompt }] }],
              model: state.copyModelId,
              system: systemPrompt,
            }),
            signal: sig,
          });

          if (!res.ok) {
            let errMsg = "Copy generation failed";
            try {
              const errData = await res.json();
              errMsg = errData.error || errMsg;
            } catch {
              errMsg = (await res.text()) || errMsg;
            }
            throw new Error(errMsg);
          }

          // Read AI SDK v6 UI message stream to completion
          // Format: lines of `data: {"type":"text-delta","id":"0","delta":"..."}`
          const reader = res.body?.getReader();
          if (!reader) throw new Error("No response body");
          const decoder = new TextDecoder();
          let buffer = "";
          let fullText = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (sig.aborted) { reader.cancel(); break; }
            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data: ")) continue;
              const payload = trimmed.slice(6);
              if (payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload);
                if (parsed.type === "text-delta" && parsed.delta) {
                  fullText += parsed.delta;
                }
              } catch {
                // skip unparseable lines
              }
            }
          }

          result = fullText;
        } else {
          // Use /api/generate for photo/video
          const images = state.mode === "photo"
            ? state.referenceImages
            : state.sourceImage ? [state.sourceImage] : [];
          const hasSourceImage = state.mode === "video" && images.length > 0;

          let modelId = state.selectedModelId;
          let modelProvider = state.selectedModelProvider;
          let modelName = state.selectedModelName;

          // Auto-switch to image-to-video variant when source image is provided
          if (hasSourceImage && modelId?.includes("/text-to-video")) {
            modelId = modelId.replace("/text-to-video", "/image-to-video");
          }

          // Default to Veo when in video mode with no model selected
          if (state.mode === "video" && !modelId) {
            modelId = hasSourceImage ? "veo-3.1/image-to-video" : "veo-3.1/text-to-video";
            modelProvider = null;
            modelName = "Veo 3.1";
          }

          const body: Record<string, unknown> = {
            prompt: finalPrompt,
            images,
            selectedModel: modelId
              ? {
                  modelId,
                  provider: modelProvider || undefined,
                  displayName: modelName || modelId,
                }
              : undefined,
            mediaType: state.mode === "video" ? "video" : undefined,
            parameters: {
              aspectRatio: state.aspectRatio,
              ...(state.mode === "video" ? { duration: state.videoDuration } : {}),
            },
          };

          const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: sig,
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || "Generation failed");
          // For video: prefer video (base64) or videoUrl (remote URL)
          // For other modes: image, audio
          if (state.mode === "video") {
            result = data.video || data.videoUrl || null;
          } else {
            result = data.image || data.audio || null;
          }
        }

        setGenerations(set, genMode, (prev) =>
          prev.map((g) => g.id === entry.id ? { ...g, status: "complete" as const, result } : g),
        );

        // Persist image/video results to R2 in the background (non-blocking)
        // Results can be base64 data URLs or remote URLs (for large videos)
        if (result && genMode !== "copy" && (result.startsWith("data:") || result.startsWith("http"))) {
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

      if (genMode === "copy") {
        const langDirective = state.outputLanguage === "ar"
          ? "Write in Arabic only."
          : state.outputLanguage === "both"
            ? "Write in both Arabic and English."
            : "Write in English only.";
        const systemPrompt = `You are a professional copywriter. ${langDirective} Platform: ${state.platform}. Tone: ${state.tone}. Return ONLY the copy text, no explanations or meta-commentary.`;

        const res = await fetch("/api/studio/copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ id, role: "user", parts: [{ type: "text", text: gen.prompt }] }],
            model: state.copyModelId,
            system: systemPrompt,
          }),
          signal: sig,
        });

        if (!res.ok) {
          let errMsg = "Copy generation failed";
          try { const errData = await res.json(); errMsg = errData.error || errMsg; } catch { errMsg = (await res.text()) || errMsg; }
          throw new Error(errMsg);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (sig.aborted) { reader.cancel(); break; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;
            try { const parsed = JSON.parse(payload); if (parsed.type === "text-delta" && parsed.delta) fullText += parsed.delta; } catch { /* skip */ }
          }
        }
        result = fullText;
      } else {
        const images = genMode === "photo"
          ? state.referenceImages
          : state.sourceImage ? [state.sourceImage] : [];
        const hasSourceImage = genMode === "video" && images.length > 0;

        let modelId = state.selectedModelId;
        let modelProvider = state.selectedModelProvider;
        let modelName = state.selectedModelName;

        if (hasSourceImage && modelId?.includes("/text-to-video")) {
          modelId = modelId.replace("/text-to-video", "/image-to-video");
        }
        if (genMode === "video" && !modelId) {
          modelId = hasSourceImage ? "veo-3.1/image-to-video" : "veo-3.1/text-to-video";
          modelProvider = null;
          modelName = "Veo 3.1";
        }

        const body: Record<string, unknown> = {
          prompt: gen.prompt,
          images,
          selectedModel: modelId ? { modelId, provider: modelProvider || undefined, displayName: modelName || modelId } : undefined,
          mediaType: genMode === "video" ? "video" : undefined,
          parameters: { aspectRatio: gen.aspectRatio, ...(genMode === "video" ? { duration: state.videoDuration } : {}) },
        };

        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: sig,
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Generation failed");
        result = genMode === "video" ? (data.video || data.videoUrl || null) : (data.image || data.audio || null);
      }

      setGenerations(set, genMode, (prev) =>
        prev.map((g) => g.id === id ? { ...g, status: "complete" as const, result } : g),
      );

      if (result && genMode !== "copy" && (result.startsWith("data:") || result.startsWith("http"))) {
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
    const { prompt } = get();
    if (!prompt.trim()) return;

    set({ isRewriting: true });

    try {
      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Rewrite this prompt for better AI image/video generation results. Keep the same intent but make it more descriptive and detailed. Return ONLY the rewritten prompt, no explanations:\n\n${prompt}`,
          provider: "google",
          model: "gemini-2.5-flash",
        }),
      });
      const data = await res.json();
      if (data.success) {
        set({ rewrittenPrompt: data.text || data.response || null });
      }
    } catch {
      // Silently fail — user can still generate with original prompt
    } finally {
      set({ isRewriting: false });
    }
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
