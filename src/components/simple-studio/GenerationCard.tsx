"use client";

import { type Generation } from "@/store/simpleStudioStore";

interface GenerationCardProps {
  generation: Generation;
  onRetry?: () => void;
}

export function GenerationCard({ generation, onRetry }: GenerationCardProps) {
  const { status, result, error, mode } = generation;

  // Loading state
  if (status === "pending" || status === "generating") {
    return (
      <div className="aspect-square bg-neutral-800/50 border border-neutral-700/50 rounded-lg flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-neutral-600 border-t-neutral-300 rounded-full animate-spin" />
          <span className="text-[10px] text-neutral-500">
            {status === "pending" ? "Queued" : "Generating..."}
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (status === "failed") {
    return (
      <div className="aspect-square bg-neutral-800/50 border border-red-900/30 rounded-lg flex items-center justify-center p-3">
        <div className="flex flex-col items-center gap-2 text-center">
          <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="text-[10px] text-red-400 line-clamp-2">{error || "Failed"}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-[10px] text-blue-400 hover:text-blue-300 underline"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // Copy mode — text card
  if (mode === "copy" && result) {
    return (
      <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4 min-h-[120px]">
        <p className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap" dir="auto">
          {result}
        </p>
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => navigator.clipboard.writeText(result)}
            className="text-[10px] text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Copy
          </button>
        </div>
      </div>
    );
  }

  // Video result
  if (mode === "video" && result) {
    return (
      <div className="relative aspect-video bg-neutral-800/50 border border-neutral-700/50 rounded-lg overflow-hidden group">
        <video
          src={result}
          className="w-full h-full object-cover"
          controls
          preload="metadata"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        <a
          href={result}
          download
          className="absolute bottom-2 end-2 p-1.5 bg-neutral-900/80 rounded text-neutral-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
          title="Download"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </a>
      </div>
    );
  }

  // Image result (default)
  if (result) {
    return (
      <div className="relative aspect-square bg-neutral-800/50 border border-neutral-700/50 rounded-lg overflow-hidden group cursor-pointer">
        <img
          src={result}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        <a
          href={result}
          download
          className="absolute bottom-2 end-2 p-1.5 bg-neutral-900/80 rounded text-neutral-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
          title="Download"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </a>
      </div>
    );
  }

  return null;
}
