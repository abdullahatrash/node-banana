"use client";

import { useEffect, useState } from "react";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";

interface ProviderModel {
  id: string;
  name: string;
  provider: string;
  capabilities?: string[];
}

const RECOMMENDED_IMAGE_MODELS = new Set([
  "nano-banana",
  "nano-banana-pro",
  "nano-banana-2",
  "flux-2/pro-text-to-image",
  "seedream/4.5-text-to-image",
  "gpt-image/1.5-text-to-image",
]);

const RECOMMENDED_VIDEO_MODELS = new Set([
  "veo-3.1/text-to-video",
  "veo-3.1-fast/text-to-video",
  "kling-2.6/text-to-video",
  "veo3/text-to-video",
  "wan/2-6-text-to-video",
]);

interface ModelSelectProps {
  mode: "photo" | "video";
  id: string;
}

export function ModelSelect({ mode, id }: ModelSelectProps) {
  const selectedModelId = useSimpleStudioStore((s) => s.selectedModelId);
  const setSelectedModel = useSimpleStudioStore((s) => s.setSelectedModel);

  const [models, setModels] = useState<ProviderModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setHasError(false);

    const capabilities =
      mode === "video"
        ? "text-to-video,image-to-video"
        : "text-to-image,image-to-image";

    fetch(`/api/models?capabilities=${capabilities}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.success) {
          const seen = new Set<string>();
          const unique = (data.models || []).filter((m: ProviderModel) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          setModels(unique);
        } else {
          setHasError(true);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        setHasError(true);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [mode]);

  const recommendedSet =
    mode === "video" ? RECOMMENDED_VIDEO_MODELS : RECOMMENDED_IMAGE_MODELS;

  // Sort: recommended first (alphabetical within group), then others (alphabetical)
  const sorted = [...models].sort((a, b) => {
    const aRec = recommendedSet.has(a.id);
    const bRec = recommendedSet.has(b.id);
    if (aRec && !bRec) return -1;
    if (!aRec && bRec) return 1;
    return a.name.localeCompare(b.name);
  });

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "") {
      setSelectedModel(null, null, null);
      return;
    }
    const model = models.find((m) => m.id === value);
    if (model) {
      setSelectedModel(model.id, model.provider, model.name);
    }
  };

  return (
    <select
      id={id}
      className="w-full rounded-md border bg-background p-2 text-sm"
      value={selectedModelId ?? ""}
      onChange={handleChange}
      disabled={isLoading && models.length === 0}
    >
      <option value="">Auto (default)</option>
      {isLoading && models.length === 0 && (
        <option disabled>Loading models…</option>
      )}
      {hasError && !isLoading && (
        <option disabled>Failed to load models</option>
      )}
      {sorted.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} ({m.provider})
          {recommendedSet.has(m.id) ? " — recommended" : ""}
        </option>
      ))}
    </select>
  );
}
