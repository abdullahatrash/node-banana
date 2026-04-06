"use client";

import Link from "next/link";
import {
  useSimpleStudioStore,
  type Generation,
  type SimpleStudioMode,
} from "@/store/simpleStudioStore";

interface LatestResultsInlineProps {
  mode: SimpleStudioMode;
}

function ResultCard({ gen }: { gen: Generation }) {
  if (gen.status === "pending" || gen.status === "generating") {
    return (
      <div className="rounded-md border bg-muted p-3 text-xs text-muted-foreground animate-pulse">
        Generating…
      </div>
    );
  }

  if (gen.status === "failed") {
    return (
      <div className="rounded-md border border-destructive p-3 text-xs text-destructive">
        Failed: {gen.error ?? "unknown error"}
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
  const modeGens = useSimpleStudioStore((s) => s.generationsByMode[mode]);

  if (modeGens.length === 0) return null;

  const latestBatchId = modeGens[0].batchId;
  const latestBatch = modeGens.filter((g) => g.batchId === latestBatchId);

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Latest results</div>
        <Link
          href="/simple-studio/library"
          className="text-xs text-muted-foreground hover:underline"
        >
          View all →
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
