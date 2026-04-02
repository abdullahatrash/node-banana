"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { GenerationCard } from "./GenerationCard";

function formatRelativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function ResultsGallery() {
  const generations = useSimpleStudioStore((s) => s.generations);
  const mode = useSimpleStudioStore((s) => s.mode);
  const retryGeneration = useSimpleStudioStore((s) => s.retryGeneration);

  if (generations.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-neutral-500">
        <div className="text-center">
          <svg
            className="w-12 h-12 mx-auto mb-3 text-neutral-700"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V4.5a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v15a1.5 1.5 0 001.5 1.5z"
            />
          </svg>
          <p className="text-sm">Your generated content will appear here</p>
          <p className="text-xs mt-1 text-neutral-600">
            Fill in the form and click Generate
          </p>
        </div>
      </div>
    );
  }

  // Group generations by batchId in a single pass
  const batches: { batchId: string; items: typeof generations }[] = [];
  const batchMap = new Map<string, typeof generations>();

  for (const gen of generations) {
    let items = batchMap.get(gen.batchId);
    if (!items) {
      items = [];
      batchMap.set(gen.batchId, items);
      batches.push({ batchId: gen.batchId, items });
    }
    items.push(gen);
  }

  return (
    <div className="p-4 space-y-6">
      {batches.map((batch) => {
        // Determine grid columns per-batch based on its own aspect ratio
        const batchAspect = batch.items[0]?.aspectRatio || "1:1";
        const isPortrait = batchAspect === "9:16";

        let gridCols: string;
        if (mode === "copy") {
          gridCols = "grid-cols-1 md:grid-cols-2";
        } else if (isPortrait) {
          gridCols = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
        } else if (mode === "video") {
          gridCols = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
        } else {
          gridCols = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";
        }

        const firstItem = batch.items[0];
        const promptExcerpt = firstItem?.prompt || "";
        const truncated = promptExcerpt.length > 80
          ? promptExcerpt.slice(0, 80) + "..."
          : promptExcerpt;

        return (
          <div key={batch.batchId}>
            {/* Batch header */}
            {truncated && (
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-neutral-400 truncate max-w-[70%]" dir="auto">
                  {truncated}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-neutral-500 shrink-0">
                  {firstItem?.modelName && <span>{firstItem.modelName}</span>}
                  <span>{formatRelativeTime(firstItem?.createdAt)}</span>
                  <span>{batch.items.length} items</span>
                </div>
              </div>
            )}
            <div className={`grid ${gridCols} gap-3`}>
              {batch.items.map((gen) => (
                <GenerationCard
                  key={gen.id}
                  generation={gen}
                  onRetry={() => retryGeneration(gen.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
