/**
 * Simple Studio Store
 *
 * Lightweight Zustand store for the form-based Simple Studio mode.
 * Completely independent from workflowStore — no dependency on
 * nodes, edges, React Flow, or the workflow execution pipeline.
 */

import { create } from "zustand";

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
  tone: string;
  setTone: (tone: string) => void;
  platform: string;
  setPlatform: (platform: string) => void;
  outputLanguage: "ar" | "en" | "both";
  setOutputLanguage: (lang: "ar" | "en" | "both") => void;

  // Generation
  isGenerating: boolean;
  isRewriting: boolean;
  currentBatchId: string | null;
  generations: Generation[];
  generate: () => Promise<void>;
  cancelGeneration: () => void;
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSimpleStudioStore = create<SimpleStudioState>((set, get) => ({
  // Mode
  mode: "photo",
  setMode: (mode) => set({ mode, rewrittenPrompt: null }),

  // Form state
  prompt: "",
  setPrompt: (prompt) => set({ prompt, rewrittenPrompt: null }),
  rewriteEnabled: false,
  setRewriteEnabled: (enabled) => set({ rewriteEnabled: enabled }),
  rewrittenPrompt: null,
  selectedModelId: null,
  setSelectedModelId: (id) => set({ selectedModelId: id }),
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
  generations: [],

  generate: async () => {
    const state = get();
    if (state.isGenerating) return;

    // Rewrite prompt if enabled and not already done
    if (state.rewriteEnabled && !state.rewrittenPrompt) {
      await get().rewritePrompt();
      if (!get().rewrittenPrompt) return; // rewrite failed
    }

    const finalPrompt = get().rewrittenPrompt || get().prompt;
    if (!finalPrompt.trim()) return;

    const batchId = crypto.randomUUID();
    abortController = new AbortController();
    const signal = abortController.signal;

    // Create pending generation entries
    const entries: Generation[] = Array.from(
      { length: state.batchCount },
      (_, i) => ({
        id: `gen_${batchId}_${i}`,
        batchId,
        status: "pending" as const,
        result: null,
        assetId: null,
        error: null,
        mode: state.mode,
      }),
    );

    set({
      isGenerating: true,
      currentBatchId: batchId,
      generations: [...entries, ...state.generations],
    });

    const processGeneration = async (entry: Generation, sig: AbortSignal) => {
      if (sig.aborted) return;

      // Mark as generating
      set((s) => ({
        generations: s.generations.map((g) =>
          g.id === entry.id ? { ...g, status: "generating" as const } : g,
        ),
      }));

      try {
        let result: string | null = null;

        if (state.mode === "copy") {
          // Use /api/llm for copy mode
          const res = await fetch("/api/llm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: finalPrompt,
              model: "gemini-2.5-flash",
              systemPrompt: `You are a professional copywriter. Generate ${state.outputLanguage === "ar" ? "Arabic" : state.outputLanguage === "both" ? "bilingual Arabic and English" : "English"} marketing copy for ${state.platform}. Tone: ${state.tone}. Return ONLY the copy text, no explanations.`,
            }),
            signal: sig,
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || "LLM generation failed");
          result = data.text || data.response;
        } else {
          // Use /api/generate for photo/video
          const body: Record<string, unknown> = {
            prompt: finalPrompt,
            images: state.mode === "photo" ? state.referenceImages : state.sourceImage ? [state.sourceImage] : [],
            selectedModel: state.selectedModelId
              ? { modelId: state.selectedModelId }
              : undefined,
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
          result = data.image || data.video || data.videoUrl || data.audio || null;
        }

        set((s) => ({
          generations: s.generations.map((g) =>
            g.id === entry.id
              ? { ...g, status: "complete" as const, result }
              : g,
          ),
        }));
      } catch (err) {
        if (sig.aborted) return;
        set((s) => ({
          generations: s.generations.map((g) =>
            g.id === entry.id
              ? {
                  ...g,
                  status: "failed" as const,
                  error: err instanceof Error ? err.message : "Generation failed",
                }
              : g,
          ),
        }));
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
    set((s) => ({
      isGenerating: false,
      currentBatchId: null,
      generations: s.generations.map((g) =>
        g.status === "pending" || g.status === "generating"
          ? { ...g, status: "failed" as const, error: "Cancelled" }
          : g,
      ),
    }));
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
            };
          },
        );
        set({ generations: entries });
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
            aspectRatio: state.aspectRatio,
            batchCount: state.batchCount,
            tone: state.tone,
            platform: state.platform,
            outputLanguage: state.outputLanguage,
            videoDuration: state.videoDuration,
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
      aspectRatio: (config.aspectRatio as string) || "1:1",
      batchCount: (config.batchCount as number) || 4,
      tone: (config.tone as string) || "professional",
      platform: (config.platform as string) || "general",
      outputLanguage: (config.outputLanguage as "ar" | "en" | "both") || "en",
      videoDuration: (config.videoDuration as number) || 5,
    });
  },
}));
