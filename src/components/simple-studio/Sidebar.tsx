"use client";

import { useEffect, useRef, useState } from "react";
import { useSimpleStudioStore, type SimpleStudioMode } from "@/store/simpleStudioStore";
import { PromptLibrary } from "./PromptLibrary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderModel {
  id: string;
  name: string;
  provider: string;
  capabilities?: string[];
}

// Recommended models — curated best picks per mode
const RECOMMENDED_IMAGE_MODELS = new Set([
  "nano-banana",          // Gemini 2.5 Flash — fast, cheap
  "nano-banana-pro",      // Gemini 3 Pro — high quality
  "nano-banana-2",        // Gemini 3.1 Flash — balanced
  "flux-2/pro-text-to-image",  // FLUX.2 Pro — excellent quality
  "seedream/4.5-text-to-image", // Seedream 4.5 — great prompt following
  "gpt-image/1.5-text-to-image", // GPT Image — good understanding
]);

const RECOMMENDED_VIDEO_MODELS = new Set([
  "veo-3.1/text-to-video",      // Veo 3.1 — best quality + audio
  "veo-3.1-fast/text-to-video",  // Veo 3.1 Fast — cheaper
  "kling-2.6/text-to-video",     // Kling 2.6 — good quality + audio
  "veo3/text-to-video",          // Veo 3 via Kie — alternative
  "wan/2-6-text-to-video",       // Wan 2.6 — affordable
]);

// ---------------------------------------------------------------------------
// Mode tabs
// ---------------------------------------------------------------------------

const MODES: { value: SimpleStudioMode; labelEn: string; labelAr: string }[] = [
  { value: "photo", labelEn: "Photo", labelAr: "صورة" },
  { value: "video", labelEn: "Video", labelAr: "فيديو" },
  { value: "copy", labelEn: "Copy", labelAr: "نص" },
];

const PHOTO_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:5"];
const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"];
const BATCH_PRESETS = [1, 4, 8, 12, 20];
const VIDEO_BATCH_PRESETS = [1, 2, 4, 8];
const TONES = ["professional", "casual", "creative", "persuasive"];
const PLATFORMS = ["general", "instagram", "x", "linkedin"];

const LLM_MODELS: { id: string; name: string; provider: string }[] = [
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", provider: "Google" },
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", provider: "Google" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "OpenAI" },
  { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", provider: "OpenAI" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "Anthropic" },
];
const OUTPUT_LANGUAGES: { value: "ar" | "en" | "both"; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ar", label: "عربي" },
  { value: "both", label: "Both" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Sidebar() {
  const store = useSimpleStudioStore();
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch models on mount and mode change
  useEffect(() => {
    let cancelled = false;
    setIsLoadingModels(true);

    const capabilities =
      store.mode === "video"
        ? "text-to-video,image-to-video"
        : "text-to-image,image-to-image";

    fetch(`/api/models?capabilities=${capabilities}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.success) {
          // Deduplicate models by ID
          const seen = new Set<string>();
          const unique = (data.models || []).filter((m: ProviderModel) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          setModels(unique);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingModels(false);
      });

    return () => { cancelled = true; };
  }, [store.mode]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isPhotoOrVideo = store.mode === "photo" || store.mode === "video";
  const maxBatch = store.mode === "video" ? 8 : 20;
  const batchPresets = store.mode === "video" ? VIDEO_BATCH_PRESETS : BATCH_PRESETS;
  const aspectRatios = store.mode === "video" ? VIDEO_ASPECT_RATIOS : PHOTO_ASPECT_RATIOS;

  // Reset aspect ratio when switching to video if current value isn't valid for video
  useEffect(() => {
    if (store.mode === "video" && !VIDEO_ASPECT_RATIOS.includes(store.aspectRatio)) {
      store.setAspectRatio("16:9");
    }
  }, [store.mode, store.aspectRatio, store.setAspectRatio]);

  // Split models into recommended + others, filtered by search
  const recommendedSet = store.mode === "video" ? RECOMMENDED_VIDEO_MODELS : RECOMMENDED_IMAGE_MODELS;
  const searchLower = modelSearch.toLowerCase();
  const filteredModels = models.filter(
    (m) => !searchLower || m.name.toLowerCase().includes(searchLower) || m.id.toLowerCase().includes(searchLower) || m.provider.toLowerCase().includes(searchLower),
  );
  const recommendedModels = filteredModels.filter((m) => recommendedSet.has(m.id));
  const otherModels = filteredModels.filter((m) => !recommendedSet.has(m.id));
  const selectedModel = models.find((m) => m.id === store.selectedModelId);

  return (
    <div className="flex flex-col h-full">
      {/* Mode tabs */}
      <div className="flex border-b border-neutral-800 shrink-0">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => store.setMode(m.value)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              store.mode === m.value
                ? "text-neutral-100 border-b-2 border-blue-500"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {m.labelEn}
          </button>
        ))}
      </div>

      {/* Form fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Prompt */}
        <fieldset>
          <label className="block text-xs font-medium text-neutral-400 mb-1.5">
            Prompt
          </label>
          <textarea
            value={store.prompt}
            onChange={(e) => store.setPrompt(e.target.value)}
            placeholder={
              store.mode === "copy"
                ? "Describe the content you want to create..."
                : "Describe what you want to generate..."
            }
            rows={4}
            className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 resize-none focus:outline-none focus:border-neutral-600"
            dir="auto"
          />
        </fieldset>

        {/* LLM Rewrite toggle (photo/video only) */}
        {isPhotoOrVideo && (
          <fieldset className="flex items-center justify-between">
            <label className="text-xs font-medium text-neutral-400">
              AI Prompt Enhance
            </label>
            <button
              role="switch"
              aria-checked={store.rewriteEnabled}
              onClick={() => store.setRewriteEnabled(!store.rewriteEnabled)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                store.rewriteEnabled ? "bg-blue-600" : "bg-neutral-700"
              }`}
            >
              <span
                className={`absolute top-0.5 start-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  store.rewriteEnabled ? "translate-x-4 rtl:-translate-x-4" : ""
                }`}
              />
            </button>
          </fieldset>
        )}

        {/* Rewritten prompt preview */}
        {store.rewriteEnabled && store.rewrittenPrompt && (
          <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-md p-3">
            <div className="text-[10px] uppercase tracking-wide text-blue-400 mb-1">
              Enhanced prompt
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed" dir="auto">
              {store.rewrittenPrompt}
            </p>
          </div>
        )}

        {/* Reference images (photo mode) */}
        {store.mode === "photo" && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Reference Images (optional)
            </label>
            <div className="flex gap-2">
              {store.referenceImages.map((img, i) => (
                <div key={i} className="relative w-16 h-16 rounded border border-neutral-700 overflow-hidden">
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() =>
                      store.setReferenceImages(store.referenceImages.filter((_, j) => j !== i))
                    }
                    className="absolute top-0 end-0 w-4 h-4 bg-red-600 text-white text-[10px] flex items-center justify-center rounded-bl"
                  >
                    ×
                  </button>
                </div>
              ))}
              {store.referenceImages.length < 3 && (
                <label className="w-16 h-16 rounded border border-dashed border-neutral-700 flex items-center justify-center text-neutral-500 hover:border-neutral-500 cursor-pointer transition-colors">
                  <span className="text-lg">+</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === "string") {
                          store.setReferenceImages([...store.referenceImages, reader.result]);
                        }
                      };
                      reader.readAsDataURL(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </fieldset>
        )}

        {/* Source image (video mode — image-to-video) */}
        {store.mode === "video" && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Source Image (optional, for image-to-video)
            </label>
            {store.sourceImage ? (
              <div className="relative w-24 h-24 rounded border border-neutral-700 overflow-hidden">
                <img src={store.sourceImage} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => store.setSourceImage(null)}
                  className="absolute top-0 end-0 w-5 h-5 bg-red-600 text-white text-xs flex items-center justify-center rounded-bl"
                >
                  ×
                </button>
              </div>
            ) : (
              <label className="w-24 h-24 rounded border border-dashed border-neutral-700 flex items-center justify-center text-neutral-500 hover:border-neutral-500 cursor-pointer transition-colors">
                <span className="text-lg">+</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === "string") {
                        store.setSourceImage(reader.result);
                      }
                    };
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </fieldset>
        )}

        {/* Model selector (photo/video) */}
        {isPhotoOrVideo && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Model
            </label>
            <div className="relative" ref={dropdownRef}>
              {/* Trigger button */}
              <button
                type="button"
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 text-start flex items-center justify-between hover:border-neutral-600 transition-colors"
              >
                <span className="truncate">
                  {selectedModel ? `${selectedModel.name}` : "Auto (default)"}
                </span>
                <svg className={`w-4 h-4 text-neutral-500 shrink-0 transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {/* Dropdown */}
              {modelDropdownOpen && (
                <div className="absolute z-50 mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-md shadow-xl overflow-hidden">
                  {/* Search input */}
                  <div className="p-2 border-b border-neutral-700">
                    <input
                      type="text"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder="Search models..."
                      className="w-full bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
                      autoFocus
                    />
                  </div>

                  <div className="max-h-[280px] overflow-y-auto">
                    {/* Auto option */}
                    <button
                      type="button"
                      onClick={() => { store.setSelectedModel(null); setModelDropdownOpen(false); setModelSearch(""); }}
                      className={`w-full text-start px-3 py-2 text-xs hover:bg-neutral-700/50 transition-colors ${
                        !store.selectedModelId ? "bg-neutral-700/30 text-blue-400" : "text-neutral-300"
                      }`}
                    >
                      Auto (default)
                    </button>

                    {/* Recommended section */}
                    {recommendedModels.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-blue-400 bg-neutral-800 sticky top-0">
                          Recommended
                        </div>
                        {recommendedModels.map((m, i) => (
                          <button
                            key={`rec-${m.id}-${i}`}
                            type="button"
                            onClick={() => { store.setSelectedModel(m.id, m.provider, m.name); setModelDropdownOpen(false); setModelSearch(""); }}
                            className={`w-full text-start px-3 py-2 text-xs hover:bg-neutral-700/50 transition-colors ${
                              store.selectedModelId === m.id ? "bg-neutral-700/30 text-blue-400" : "text-neutral-300"
                            }`}
                          >
                            <span>{m.name}</span>
                            <span className="text-neutral-500 ms-1.5">{m.provider}</span>
                          </button>
                        ))}
                      </>
                    )}

                    {/* All models section */}
                    {otherModels.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-neutral-500 bg-neutral-800 sticky top-0">
                          All Models
                        </div>
                        {otherModels.map((m, i) => (
                          <button
                            key={`all-${m.id}-${i}`}
                            type="button"
                            onClick={() => { store.setSelectedModel(m.id, m.provider, m.name); setModelDropdownOpen(false); setModelSearch(""); }}
                            className={`w-full text-start px-3 py-2 text-xs hover:bg-neutral-700/50 transition-colors ${
                              store.selectedModelId === m.id ? "bg-neutral-700/30 text-blue-400" : "text-neutral-300"
                            }`}
                          >
                            <span>{m.name}</span>
                            <span className="text-neutral-500 ms-1.5">{m.provider}</span>
                          </button>
                        ))}
                      </>
                    )}

                    {isLoadingModels && (
                      <div className="px-3 py-2 text-xs text-neutral-500">Loading models...</div>
                    )}

                    {!isLoadingModels && filteredModels.length === 0 && modelSearch && (
                      <div className="px-3 py-2 text-xs text-neutral-500">No models match &quot;{modelSearch}&quot;</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </fieldset>
        )}

        {/* Aspect ratio (photo/video) */}
        {isPhotoOrVideo && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Aspect Ratio
            </label>
            <div className="flex gap-1.5">
              {aspectRatios.map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => store.setAspectRatio(ratio)}
                  className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                    store.aspectRatio === ratio
                      ? "bg-blue-600/20 border-blue-500 text-blue-400"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {/* Video duration (video mode) */}
        {store.mode === "video" && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Duration (seconds)
            </label>
            <div className="flex gap-1.5">
              {[4, 5, 6, 8, 10].map((d) => (
                <button
                  key={d}
                  onClick={() => store.setVideoDuration(d)}
                  className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                    store.videoDuration === d
                      ? "bg-blue-600/20 border-blue-500 text-blue-400"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                  }`}
                >
                  {d}s
                </button>
              ))}
            </div>
            <p className="text-[10px] text-neutral-600 mt-1">Duration depends on model (Veo: 4-8s, Kling: 5-10s)</p>
          </fieldset>
        )}

        {/* Dialogue / Audio (video mode) */}
        {store.mode === "video" && (
          <>
            <fieldset className="flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-400">
                Include Dialogue
              </label>
              <button
                role="switch"
                aria-checked={store.dialogueEnabled}
                onClick={() => store.setDialogueEnabled(!store.dialogueEnabled)}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  store.dialogueEnabled ? "bg-blue-600" : "bg-neutral-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 start-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                    store.dialogueEnabled ? "translate-x-4 rtl:-translate-x-4" : ""
                  }`}
                />
              </button>
            </fieldset>

            {store.dialogueEnabled && (
              <>
                <fieldset>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Dialogue Language
                  </label>
                  <div className="flex gap-1.5">
                    {([
                      { value: "en" as const, label: "English" },
                      { value: "ar" as const, label: "عربي" },
                    ]).map((lang) => (
                      <button
                        key={lang.value}
                        onClick={() => store.setDialogueLanguage(lang.value)}
                        className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                          store.dialogueLanguage === lang.value
                            ? "bg-blue-600/20 border-blue-500 text-blue-400"
                            : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                        }`}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                    Dialogue Text
                  </label>
                  <textarea
                    value={store.dialogueText}
                    onChange={(e) => store.setDialogueText(e.target.value)}
                    placeholder={
                      store.dialogueLanguage === "ar"
                        ? "اكتب ما يقوله الشخص..."
                        : "Write what the character says..."
                    }
                    rows={2}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 resize-none focus:outline-none focus:border-neutral-600"
                    dir="auto"
                  />
                  <p className="text-[10px] text-neutral-600 mt-1">
                    Works best with Veo 3.1 and Kling 2.6. Dialogue is injected into the prompt.
                  </p>
                </fieldset>
              </>
            )}
          </>
        )}

        {/* LLM Model (copy mode) */}
        {store.mode === "copy" && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Model
            </label>
            <select
              value={store.copyModelId}
              onChange={(e) => store.setCopyModelId(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
            >
              {LLM_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider})
                </option>
              ))}
            </select>
          </fieldset>
        )}

        {/* Tone (copy mode) */}
        {store.mode === "copy" && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Tone
            </label>
            <select
              value={store.tone}
              onChange={(e) => store.setTone(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
            >
              {TONES.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </fieldset>
        )}

        {/* Platform (copy mode) */}
        {store.mode === "copy" && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Platform
            </label>
            <select
              value={store.platform}
              onChange={(e) => store.setPlatform(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </fieldset>
        )}

        {/* Output language (copy mode) */}
        {store.mode === "copy" && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Language
            </label>
            <div className="flex gap-1.5">
              {OUTPUT_LANGUAGES.map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => store.setOutputLanguage(lang.value)}
                  className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                    store.outputLanguage === lang.value
                      ? "bg-blue-600/20 border-blue-500 text-blue-400"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {/* Batch count */}
        <fieldset>
          <label className="block text-xs font-medium text-neutral-400 mb-1.5">
            {store.mode === "copy" ? "Output Count" : "Batch Count"}
          </label>
          <div className="flex gap-1.5">
            {batchPresets
              .filter((n) => n <= maxBatch)
              .map((n) => (
                <button
                  key={n}
                  onClick={() => store.setBatchCount(n)}
                  className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                    store.batchCount === n
                      ? "bg-blue-600/20 border-blue-500 text-blue-400"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                  }`}
                >
                  {n}
                </button>
              ))}
          </div>
        </fieldset>
      </div>

      {/* Prompt library */}
      <PromptLibrary />

      {/* Generate button — pinned at bottom */}
      <div className="p-4 border-t border-neutral-800 shrink-0">
        {store.isGenerating ? (
          <button
            onClick={() => store.cancelGeneration()}
            className="w-full py-2.5 text-sm font-medium rounded-md bg-red-600/20 text-red-400 border border-red-600/50 hover:bg-red-600/30 transition-colors"
          >
            Cancel Generation
          </button>
        ) : (
          <button
            onClick={() => store.generate()}
            disabled={!store.prompt.trim() || store.isRewriting}
            className="w-full py-2.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {store.isRewriting
              ? "Enhancing prompt..."
              : `Generate ${store.batchCount} ${store.mode === "copy" ? "variation" : store.mode}${store.batchCount > 1 ? "s" : ""}`}
          </button>
        )}
      </div>
    </div>
  );
}
