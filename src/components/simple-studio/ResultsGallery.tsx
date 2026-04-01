"use client";

import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { GenerationCard } from "./GenerationCard";

export function ResultsGallery() {
  const generations = useSimpleStudioStore((s) => s.generations);
  const mode = useSimpleStudioStore((s) => s.mode);

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

  // Group generations by batchId
  const batches: { batchId: string; items: typeof generations }[] = [];
  const seen = new Set<string>();

  for (const gen of generations) {
    if (!seen.has(gen.batchId)) {
      seen.add(gen.batchId);
      batches.push({
        batchId: gen.batchId,
        items: generations.filter((g) => g.batchId === gen.batchId),
      });
    }
  }

  // Grid columns based on mode
  const gridCols =
    mode === "copy"
      ? "grid-cols-1 md:grid-cols-2"
      : mode === "video"
        ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  return (
    <div className="p-4 space-y-6">
      {batches.map((batch) => (
        <div key={batch.batchId}>
          <div className={`grid ${gridCols} gap-3`}>
            {batch.items.map((gen) => (
              <GenerationCard key={gen.id} generation={gen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
