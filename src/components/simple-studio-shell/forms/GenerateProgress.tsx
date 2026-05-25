"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";

/**
 * Inline batch progress + cancel control. Shown in place of the Generate button
 * while `isGenerating` is true. Reads the current batch from the store and
 * derives a done/total ratio across pending/complete/failed generations.
 */
export function GenerateProgress() {
  const generations = useSimpleStudioStore((s) => s.generations);
  const currentBatchId = useSimpleStudioStore((s) => s.currentBatchId);
  const cancelGeneration = useSimpleStudioStore((s) => s.cancelGeneration);

  const batch = currentBatchId
    ? generations.filter((g) => g.batchId === currentBatchId)
    : [];
  const total = batch.length;
  const done = batch.filter(
    (g) => g.status === "complete" || g.status === "failed"
  ).length;
  const pct = total > 0 ? (done / total) * 100 : 0;

  return (
    <div
      className="space-y-2"
      role="status"
      aria-live="polite"
      aria-label="Generation progress"
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Generating…</span>
        <span>
          {done}/{total}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <button
        type="button"
        onClick={() => cancelGeneration()}
        className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
      >
        Cancel
      </button>
    </div>
  );
}
