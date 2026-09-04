"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

interface FormInfoPanelProps {
  aspectRatios?: { value: string; label: string }[];
  batchPresets?: number[];
  outputExample?: ReactNode;
  tips?: ReactNode;
  currentAspectRatio?: string;
  onAspectRatioChange?: (value: string) => void;
  currentBatchCount?: number;
  onBatchCountChange?: (value: number) => void;
  estimatedCost?: ReactNode;
}

export function FormInfoPanel({
  aspectRatios,
  batchPresets,
  outputExample,
  tips,
  currentAspectRatio,
  onAspectRatioChange,
  currentBatchCount,
  onBatchCountChange,
  estimatedCost,
}: FormInfoPanelProps) {
  const t = useTranslations("studioUi.infoPanel");
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 text-sm">
      {aspectRatios && aspectRatios.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t("aspectRatio")}
          </div>
          <div className="flex flex-wrap gap-2">
            {aspectRatios.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`rounded-md border px-3 py-1 text-xs ${
                  currentAspectRatio === r.value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() => onAspectRatioChange?.(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {batchPresets && batchPresets.length > 0 && (
        <section>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t("batchCount")}
          </div>
          <div className="flex flex-wrap gap-2">
            {batchPresets.map((n) => (
              <button
                key={n}
                type="button"
                className={`rounded-md border px-3 py-1 text-xs ${
                  currentBatchCount === n
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
                onClick={() => onBatchCountChange?.(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </section>
      )}

      {estimatedCost && (
        <section>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            {t("estimatedCost")}
          </div>
          <div>{estimatedCost}</div>
        </section>
      )}

      {outputExample && (
        <section>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t("outputExample")}
          </div>
          {outputExample}
        </section>
      )}

      {tips && (
        <section className="text-xs text-muted-foreground">{tips}</section>
      )}
    </div>
  );
}
