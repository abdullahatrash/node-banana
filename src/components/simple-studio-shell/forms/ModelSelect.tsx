"use client";

import { useEffect, useState } from "react";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { getActiveWorkspaceId } from "@/lib/studio/client";
import { useTranslations } from "next-intl";
import type { GenerationCapability } from "@/lib/model-routing/types";

interface ProviderModel {
  model: string;
  label: string;
  provider: string;
  capabilities?: string[];
  qualification: { status: "unqualified" } | { status: "qualified"; version: string; inputSchemaDigest: string; executionPriceUsd: { basis: "image" | "second" | "run"; amount: number } };
}

interface ModelSelectProps {
  mode: "photo" | "video" | "copy";
  id: string;
  requiredCapability?: GenerationCapability;
}

export function ModelSelect({ mode, id, requiredCapability }: ModelSelectProps) {
  const t = useTranslations("simpleStudio.modelSelect"); const locale = typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
  const selectedModelId = useSimpleStudioStore((s) => s.selectedModelId);
  const setSelectedModel = useSimpleStudioStore((s) => s.setSelectedModel);
  const sourceMediaType = useSimpleStudioStore((s) => s.sourceMediaType);
  const referenceImageCount = useSimpleStudioStore((s) => s.referenceImages.length);

  const [models, setModels] = useState<ProviderModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setHasError(false);

    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) { setModels([]); setHasError(true); setIsLoading(false); return () => controller.abort(); }
    fetch("/api/studio/model-routing/catalog", {
      headers: { "x-workspace-id": workspaceId },
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.success) {
          const seen = new Set<string>();
          const unique = (data.items || []).filter((m: ProviderModel) => {
            const capability = requiredCapability ?? (mode === "copy" ? "text_generation" : mode === "video"
              ? sourceMediaType === "video" ? "video_to_video" : sourceMediaType === "image" ? "image_to_video" : "text_to_video"
              : referenceImageCount > 0 ? "image_to_image" : "text_to_image");
            const supported = m.capabilities?.includes(capability);
            if (m.provider !== "replicate" || m.qualification.status !== "qualified" || !supported || seen.has(m.model)) return false;
            seen.add(m.model);
            return true;
          });
          setModels(unique);
          const selected = unique.find((item: ProviderModel) => item.model === selectedModelId);
          if (!selected) {
            const replacement = unique[0] as ProviderModel | undefined;
            if (replacement?.qualification.status === "qualified") {
              setSelectedModel(replacement.model, replacement.provider, replacement.label, replacement.qualification.version, replacement.qualification.inputSchemaDigest);
            } else {
              setSelectedModel(null, null, null);
            }
          }
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
  }, [mode, referenceImageCount, requiredCapability, selectedModelId, setSelectedModel, sourceMediaType]);

  const sorted = [...models].sort((a, b) => a.label.localeCompare(b.label));

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "") {
      setSelectedModel(null, null, null);
      return;
    }
    const model = models.find((m) => m.model === value);
    if (model?.qualification.status === "qualified") {
      setSelectedModel(model.model, model.provider, model.label, model.qualification.version, model.qualification.inputSchemaDigest);
    }
  };

  return (
    <select
      id={id}
      dir="auto"
      className="w-full rounded-md border bg-background p-2 text-sm"
      value={selectedModelId ?? ""}
      onChange={handleChange}
      disabled={isLoading && models.length === 0}
    >
      <option value="">{t("select")}</option>
      {isLoading && models.length === 0 && (
        <option disabled>{t("loading")}</option>
      )}
      {hasError && !isLoading && (
        <option disabled>{t("workspaceRequired")}</option>
      )}
      {!hasError && !isLoading && sorted.length === 0 && <option disabled>{t("none")}</option>}
      {sorted.map((m) => (
        <option key={m.model} value={m.model} dir="auto">
          {m.qualification.status === "qualified" ? `${m.label} · ${t("price", { amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(m.qualification.executionPriceUsd.amount), basis: t(`basis.${m.qualification.executionPriceUsd.basis}`) })}` : m.label}
        </option>
      ))}
    </select>
  );
}
