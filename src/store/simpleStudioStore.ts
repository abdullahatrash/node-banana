/**
 * Simple Studio Store
 *
 * Lightweight Zustand store for the form-based content studio.
 */

import { create } from "zustand";
import {
  ingestStudioAsset,
} from "@/lib/studio/client";
import { runAdmittedStudioGeneration, StudioGenerationError } from "@/lib/model-routing/studio-generation-client";
import type { ManagedCreditQuote } from "@/lib/model-routing/budget-authority";

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
  nextActionCode?: string | null;
  nextActionHref?: string | null;
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
  selectedModelExecutionPriceUsd: { basis: "image" | "second" | "run"; amount: number } | null;
  setSelectedModel: (id: string | null, provider?: string | null, name?: string | null, version?: string | null, schemaDigest?: string | null, executionPriceUsd?: SimpleStudioState["selectedModelExecutionPriceUsd"]) => void;
  setSelectedModelId: (id: string | null) => void;
  aspectRatio: string;
  setAspectRatio: (ratio: string) => void;
  batchCount: number;
  setBatchCount: (count: number) => void;
  referenceImages: string[];
  setReferenceImages: (images: string[]) => void;
  sourceImage: string | null;
  sourceMediaType: "image" | "video" | null;
  setSourceImage: (image: string | null, mediaType?: "image" | "video" | null) => void;
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
  fundingMode: "byok" | "managed";
  setFundingMode: (value: SimpleStudioState["fundingMode"]) => void;
  pendingManagedCreditQuotes: ManagedCreditQuote[];
  resolveManagedCreditQuote: (quoteId: string, accepted: boolean) => void;
  rightsBasis: "owned" | "licensed" | "public_domain" | "consented";
  setRightsBasis: (value: SimpleStudioState["rightsBasis"]) => void;
  permittedRemix: "reference_only" | "transform" | "derivative";
  setPermittedRemix: (value: SimpleStudioState["permittedRemix"]) => void;
  rightsConfirmed: boolean;
  setRightsConfirmed: (value: boolean) => void;
  rightsEvidenceIds: string[];
  setRightsEvidenceIds: (value: string[]) => void;

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
const managedQuoteResolvers = new Map<string, (accepted: boolean) => void>();

function requestManagedQuoteConfirmation(set: StudioSet, quote: ManagedCreditQuote): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = managedQuoteResolvers.get(quote.quoteId);
    if (previous) previous(false);
    managedQuoteResolvers.set(quote.quoteId, resolve);
    set((state) => ({ pendingManagedCreditQuotes: state.pendingManagedCreditQuotes.some((item) => item.quoteId === quote.quoteId) ? state.pendingManagedCreditQuotes : [...state.pendingManagedCreditQuotes, quote] }));
  });
}

export function requestStudioManagedCreditQuoteConfirmation(quote: ManagedCreditQuote): Promise<boolean> {
  return requestManagedQuoteConfirmation(useSimpleStudioStore.setState, quote);
}

const CONCURRENT_LIMIT = 4;

async function submitAdmittedGeneration(input: { set: StudioSet; state: SimpleStudioState; prompt: string; mode: SimpleStudioMode; sourceAssetIds: string[]; idempotencyKey: string; signal: AbortSignal }) {
  if (!input.state.selectedModelId || input.state.selectedModelProvider !== "replicate" || !input.state.selectedModelVersion || !input.state.selectedModelSchemaDigest) throw new Error("MODEL_NOT_SELECTED");
  if (!input.state.rightsConfirmed) throw new Error("RIGHTS_CONFIRMATION_REQUIRED");
  const prompt = input.mode === "copy" ? `${input.prompt}\n\nTone: ${input.state.tone}. Platform: ${input.state.platform}. Output language: ${input.state.outputLanguage}.` : input.prompt;
  const contentLanguage = input.mode === "copy"
    ? input.state.outputLanguage === "both" ? "mixed" : input.state.outputLanguage
    : input.mode === "video" ? input.state.dialogueLanguage : undefined;
  return runAdmittedStudioGeneration({ prompt, contentLanguage, model: { provider: "replicate", model: input.state.selectedModelId, version: input.state.selectedModelVersion, inputSchemaDigest: input.state.selectedModelSchemaDigest }, mode: input.mode, sourceMediaType: input.state.sourceMediaType, sourceAssetIds: input.sourceAssetIds, quantity: input.mode === "video" ? input.state.videoDuration : 1, fundingMode: input.state.fundingMode, arabicVariety: input.state.arabicVariety, rightsBasis: input.state.rightsBasis, permittedRemix: input.state.permittedRemix, rightsEvidenceIds: input.state.rightsEvidenceIds, remixBrief: { preserve: ["accepted Brand Profile identity", "core subject"], transform: input.state.permittedRemix === "reference_only" ? [] : [input.mode === "copy" ? "wording for the selected channel" : "composition and motion for an original 9:16 result"], avoid: ["source logos or protected marks not present in the accepted Brand Profile"] }, idempotencyKey: input.idempotencyKey, signal: input.signal, confirmManagedCreditQuote: (quote) => requestManagedQuoteConfirmation(input.set, quote) });
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

async function resolveSourceAssetIds(state: SimpleStudioState, mode: Exclude<SimpleStudioMode, "copy">, filePrefix: string) {
  const sources = mode === "photo" ? state.referenceImages : state.sourceImage ? [state.sourceImage] : [];
  const sourceType = mode === "video" && state.sourceMediaType === "video" ? "video" : "image";
  const extension = sourceType === "video" ? "mp4" : "png";
  return Promise.all(sources.map(async (source, index) => source.startsWith("asset:") ? source.slice(6) : (await ingestStudioAsset({ assetType: sourceType, sourceDataUrl: source.startsWith("data:") ? source : undefined, sourceUrl: source.startsWith("http") ? source : undefined, fileName: `${filePrefix}-${index}.${extension}` })).assetId));
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

type StudioSet = (fn: (state: SimpleStudioState) => Partial<SimpleStudioState>) => void;
async function executeGenerationEntry(input: { set: StudioSet; state: SimpleStudioState; generation: Generation; mode: SimpleStudioMode; prompt: string; sourceAssetIds: string[]; idempotencyKey: string; signal: AbortSignal }) {
  setGenerations(input.set, input.mode, (values) => values.map((value) => value.id === input.generation.id ? { ...value, status: "generating", error: null, nextActionCode: null, nextActionHref: null } : value));
  try {
    const admitted = await submitAdmittedGeneration({ set: input.set, state: input.state, prompt: input.prompt, mode: input.mode, sourceAssetIds: input.sourceAssetIds, idempotencyKey: input.idempotencyKey, signal: input.signal });
    setGenerations(input.set, input.mode, (values) => values.map((value) => value.id === input.generation.id ? { ...value, status: "complete", result: admitted.result, assetId: admitted.assetId } : value));
  } catch (error) {
    if (input.signal.aborted) return;
    if (error instanceof StudioGenerationError && error.code === "GENERATION_PENDING_RECOVERY") {
      setGenerations(input.set, input.mode, (values) => values.map((value) => value.id === input.generation.id ? { ...value, status: "pending", error: error.code, nextActionCode: error.nextActionCode, nextActionHref: error.nextActionHref } : value));
      return;
    }
    setGenerations(input.set, input.mode, (values) => values.map((value) => value.id === input.generation.id ? {
      ...value,
      status: "failed",
      error: error instanceof Error ? error.message : "GENERATION_FAILED",
      nextActionCode: error instanceof StudioGenerationError ? error.nextActionCode : null,
      nextActionHref: error instanceof StudioGenerationError ? error.nextActionHref : null,
    } : value));
  }
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
  selectedModelExecutionPriceUsd: null,
  setSelectedModel: (id, provider = null, name = null, version = null, schemaDigest = null, executionPriceUsd = null) =>
    set({ selectedModelId: id, selectedModelProvider: provider, selectedModelName: name, selectedModelVersion: version, selectedModelSchemaDigest: schemaDigest, selectedModelExecutionPriceUsd: executionPriceUsd }),
  setSelectedModelId: (id) => set({ selectedModelId: id, selectedModelProvider: null, selectedModelName: null, selectedModelVersion: null, selectedModelSchemaDigest: null, selectedModelExecutionPriceUsd: null }),
  aspectRatio: "9:16",
  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
  batchCount: 4,
  setBatchCount: (count) => set({ batchCount: count }),
  referenceImages: [],
  setReferenceImages: (images) => set({ referenceImages: images }),
  sourceImage: null,
  sourceMediaType: null,
  setSourceImage: (image, mediaType = image ? "image" : null) => set({ sourceImage: image, sourceMediaType: image ? mediaType : null, selectedModelId: null, selectedModelProvider: null, selectedModelName: null, selectedModelVersion: null, selectedModelSchemaDigest: null, selectedModelExecutionPriceUsd: null }),
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
  fundingMode: "byok",
  setFundingMode: (fundingMode) => set({ fundingMode }),
  pendingManagedCreditQuotes: [],
  resolveManagedCreditQuote: (quoteId, accepted) => {
    const resolve = managedQuoteResolvers.get(quoteId);
    managedQuoteResolvers.delete(quoteId);
    set((state) => ({ pendingManagedCreditQuotes: state.pendingManagedCreditQuotes.filter((quote) => quote.quoteId !== quoteId) }));
    resolve?.(accepted);
  },
  rightsBasis: "owned",
  setRightsBasis: (rightsBasis) => set((state) => ({ rightsBasis, rightsConfirmed: false, rightsEvidenceIds: rightsBasis === "owned" ? [] : state.rightsEvidenceIds })),
  permittedRemix: "transform",
  setPermittedRemix: (permittedRemix) => set({ permittedRemix, rightsConfirmed: false }),
  rightsConfirmed: false,
  setRightsConfirmed: (rightsConfirmed) => set({ rightsConfirmed }),
  rightsEvidenceIds: [],
  setRightsEvidenceIds: (rightsEvidenceIds) => set({ rightsEvidenceIds }),

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
        nextActionCode: null,
        nextActionHref: null,
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
      try {
        sourceAssetIds = await resolveSourceAssetIds(state, genMode, `inspiration-${batchId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Inspiration media could not be stored safely.";
        setGenerations(set, genMode, (prev) => prev.map((generation) => generation.batchId === batchId ? { ...generation, status: "failed" as const, error: message, nextActionCode: null, nextActionHref: null } : generation));
        set({ isGenerating: false, currentBatchId: null }); abortController = null; return;
      }
    }

    const processGeneration = (entry: Generation, sig: AbortSignal) => sig.aborted ? Promise.resolve() : executeGenerationEntry({ set, state, generation: entry, mode: genMode, prompt: finalPrompt, sourceAssetIds, idempotencyKey: `simple-studio:${entry.id}`, signal: sig });

    await processInChunks(entries, CONCURRENT_LIMIT, processGeneration, signal);

    set({ isGenerating: false, currentBatchId: null });
    abortController = null;
  },

  cancelGeneration: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    for (const [quoteId, resolve] of managedQuoteResolvers) { managedQuoteResolvers.delete(quoteId); resolve(false); }
    // Cancel pending/generating entries across all modes
    const modes: SimpleStudioMode[] = ["photo", "video", "copy"];
    for (const m of modes) {
      setGenerations(set, m, (prev) =>
        prev.map((g) =>
          g.status === "pending" || g.status === "generating"
            ? { ...g, status: "failed" as const, error: "Cancelled", nextActionCode: null, nextActionHref: null }
            : g,
        ),
      );
    }
    set({ isGenerating: false, currentBatchId: null, pendingManagedCreditQuotes: [] });
  },

  retryGeneration: async (id: string) => {
    const state = get();
    const gen = state.generations.find((g) => g.id === id);
    if (!gen || gen.status !== "failed") return;

    const genMode = gen.mode;

    const retryController = new AbortController();
    const sig = retryController.signal;
    const sourceAssetIds = genMode === "copy" ? [] : await resolveSourceAssetIds(state, genMode, `retry-inspiration-${id}`);
    await executeGenerationEntry({ set, state, generation: gen, mode: genMode, prompt: gen.prompt, sourceAssetIds, idempotencyKey: `simple-studio-retry:${id}:${crypto.randomUUID()}`, signal: sig });
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
              nextActionCode: null,
              nextActionHref: null,
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
            fundingMode: state.fundingMode,
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
      selectedModelExecutionPriceUsd: null,
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
      fundingMode: config.fundingMode === "managed" ? "managed" : "byok",
    });
  },
}));
