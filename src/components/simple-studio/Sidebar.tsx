"use client";

import { useEffect, useState } from "react";
import { useSimpleStudioStore, type SimpleStudioMode } from "@/store/simpleStudioStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderModel {
  id: string;
  name: string;
  provider: string;
  capabilities?: string[];
}

// ---------------------------------------------------------------------------
// Mode tabs
// ---------------------------------------------------------------------------

const MODES: { value: SimpleStudioMode; labelEn: string; labelAr: string }[] = [
  { value: "photo", labelEn: "Photo", labelAr: "صورة" },
  { value: "video", labelEn: "Video", labelAr: "فيديو" },
  { value: "copy", labelEn: "Copy", labelAr: "نص" },
];

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:5"];
const BATCH_PRESETS = [1, 4, 8, 12, 20];
const VIDEO_BATCH_PRESETS = [1, 2, 4, 8];
const TONES = ["professional", "casual", "creative", "persuasive"];
const PLATFORMS = ["general", "instagram", "x", "linkedin"];
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
          setModels(data.models || []);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingModels(false);
      });

    return () => { cancelled = true; };
  }, [store.mode]);

  const isPhotoOrVideo = store.mode === "photo" || store.mode === "video";
  const maxBatch = store.mode === "video" ? 8 : 20;
  const batchPresets = store.mode === "video" ? VIDEO_BATCH_PRESETS : BATCH_PRESETS;

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
              onClick={() => store.setRewriteEnabled(!store.rewriteEnabled)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                store.rewriteEnabled ? "bg-blue-600" : "bg-neutral-700"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  store.rewriteEnabled ? "translate-x-4" : "translate-x-0.5"
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
            <select
              value={store.selectedModelId || ""}
              onChange={(e) => store.setSelectedModelId(e.target.value || null)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
            >
              <option value="">Auto (default)</option>
              {isLoadingModels && <option disabled>Loading models...</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider})
                </option>
              ))}
            </select>
          </fieldset>
        )}

        {/* Aspect ratio (photo/video) */}
        {isPhotoOrVideo && (
          <fieldset>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Aspect Ratio
            </label>
            <div className="flex gap-1.5">
              {ASPECT_RATIOS.map((ratio) => (
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
            <select
              value={store.videoDuration}
              onChange={(e) => store.setVideoDuration(Number(e.target.value))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
            >
              {[3, 5, 10, 15].map((d) => (
                <option key={d} value={d}>{d}s</option>
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
