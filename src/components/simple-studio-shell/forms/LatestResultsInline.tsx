"use client";

import Link from "next/link";
import {
  useSimpleStudioStore,
  type Generation,
  type SimpleStudioMode,
} from "@/store/simpleStudioStore";
import { useTranslations } from "next-intl";

interface LatestResultsInlineProps {
  mode: SimpleStudioMode;
}
const ERROR_KEYS = { MODEL_NOT_SELECTED: "errors.MODEL_NOT_SELECTED", RIGHTS_CONFIRMATION_REQUIRED: "errors.RIGHTS_CONFIRMATION_REQUIRED", TEXT_GENERATION_NOT_ADMITTED: "errors.TEXT_GENERATION_NOT_ADMITTED", PROVIDER_OUTCOME_UNKNOWN: "errors.PROVIDER_OUTCOME_UNKNOWN", GENERATION_FAILED: "errors.GENERATION_FAILED" } as const;

function ResultCard({ gen }: { gen: Generation }) {
  const t = useTranslations("simpleStudio.generation");
  if (gen.status === "pending" || gen.status === "generating") {
    return (
      <div className="rounded-md border bg-muted p-3 text-xs text-muted-foreground animate-pulse">
        {t("generating")}
      </div>
    );
  }

  if (gen.status === "failed") {
    const errorKey = gen.error && gen.error in ERROR_KEYS ? ERROR_KEYS[gen.error as keyof typeof ERROR_KEYS] : "errors.GENERATION_FAILED";
    return (
      <div className="rounded-md border border-destructive p-3 text-xs text-destructive">
        {t("failed", { reason: t(errorKey) })}
      </div>
    );
  }

  if (gen.mode === "copy") {
    return (
      <div className="rounded-md border p-3 text-sm whitespace-pre-wrap">
        {gen.result ?? "(no output)"}
      </div>
    );
  }

  if (gen.mode === "video") {
    return (
      <div className="rounded-md border overflow-hidden">
        {gen.result && (
          <video
            src={gen.result}
            className="w-full aspect-video object-cover"
            muted
            playsInline
            controls
          />
        )}
      </div>
    );
  }

  // photo
  return (
    <div className="rounded-md border overflow-hidden">
      {gen.result && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={gen.result}
          alt={gen.prompt}
          className="w-full aspect-square object-cover"
        />
      )}
    </div>
  );
}

export function LatestResultsInline({ mode }: LatestResultsInlineProps) {
  const t = useTranslations("simpleStudio.generation");
  const modeGens = useSimpleStudioStore((s) => s.generationsByMode[mode]);

  if (modeGens.length === 0) return null;

  const latestBatchId = modeGens[0].batchId;
  const latestBatch = modeGens.filter((g) => g.batchId === latestBatchId);

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{t("latest")}</div>
        <Link
          href="/simple-studio/library"
          className="text-xs text-muted-foreground hover:underline"
        >
          {t("viewAll")} <span aria-hidden>→</span>
        </Link>
      </div>
      <div className="space-y-2">
        {latestBatch.map((gen) => (
          <ResultCard key={gen.id} gen={gen} />
        ))}
      </div>
    </div>
  );
}
