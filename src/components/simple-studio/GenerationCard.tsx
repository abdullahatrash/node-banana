"use client";

import { useCallback, useEffect, useState } from "react";
import { type Generation } from "@/store/simpleStudioStore";

// ---------------------------------------------------------------------------
// Aspect ratio → CSS class mapping
// ---------------------------------------------------------------------------

const ASPECT_CLASS: Record<string, string> = {
  "1:1": "aspect-square",
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "4:5": "aspect-[4/5]",
};

function aspectClass(ratio: string): string {
  return ASPECT_CLASS[ratio] || "aspect-square";
}

// ---------------------------------------------------------------------------
// Lightbox / preview overlay
// ---------------------------------------------------------------------------

function Lightbox({
  batchItems,
  initialIndex,
  onClose,
}: {
  batchItems: Generation[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);

  // Filter to only completed items with results for navigation
  const navigable = batchItems.filter((g) => g.status === "complete" && g.result);
  const navIndex = navigable.findIndex((g) => g.id === batchItems[index]?.id);
  const current = navIndex >= 0 ? navigable[navIndex] : null;

  const hasPrev = navIndex > 0;
  const hasNext = navIndex < navigable.length - 1;

  const goPrev = useCallback(() => {
    if (hasPrev) {
      const prev = navigable[navIndex - 1];
      const realIndex = batchItems.findIndex((g) => g.id === prev.id);
      if (realIndex >= 0) setIndex(realIndex);
    }
  }, [hasPrev, navIndex, navigable, batchItems]);

  const goNext = useCallback(() => {
    if (hasNext) {
      const next = navigable[navIndex + 1];
      const realIndex = batchItems.findIndex((g) => g.id === next.id);
      if (realIndex >= 0) setIndex(realIndex);
    }
  }, [hasNext, navIndex, navigable, batchItems]);

  // Keyboard: Escape, ArrowLeft, ArrowRight
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  if (!current?.result) return null;

  const isVideo = current.mode === "video";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Content container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-10 end-0 p-1.5 text-neutral-400 hover:text-white transition-colors z-10"
          title="Close (Esc)"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Prev arrow */}
        {hasPrev && (
          <button
            onClick={goPrev}
            className="absolute start-0 top-1/2 -translate-y-1/2 -ms-12 p-2 text-neutral-400 hover:text-white transition-colors"
            title="Previous"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        )}

        {/* Next arrow */}
        {hasNext && (
          <button
            onClick={goNext}
            className="absolute end-0 top-1/2 -translate-y-1/2 -me-12 p-2 text-neutral-400 hover:text-white transition-colors"
            title="Next"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        )}

        {isVideo ? (
          <video
            key={current.id}
            src={current.result!}
            className="max-w-[90vw] max-h-[85vh] rounded-lg"
            style={{ aspectRatio: current.aspectRatio.replace(":", "/") }}
            controls
            autoPlay
          />
        ) : (
          <img
            key={current.id}
            src={current.result!}
            alt=""
            className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain"
          />
        )}

        {/* Bottom bar: counter + download */}
        <div className="mt-3 flex items-center gap-4">
          {navigable.length > 1 && (
            <span className="text-[11px] text-neutral-500">
              {navIndex + 1} / {navigable.length}
            </span>
          )}
          <a
            href={current.result!}
            download={`generation.${isVideo ? "mp4" : "png"}`}
            className="px-4 py-1.5 text-xs font-medium bg-neutral-800 text-neutral-200 rounded-md hover:bg-neutral-700 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GenerationCard
// ---------------------------------------------------------------------------

interface GenerationCardProps {
  generation: Generation;
  batchItems?: Generation[];
  batchIndex?: number;
  onRetry?: () => void;
}

export function GenerationCard({ generation, batchItems, batchIndex, onRetry }: GenerationCardProps) {
  const { status, result, error, mode, aspectRatio } = generation;
  const [previewOpen, setPreviewOpen] = useState(false);

  const openPreview = useCallback(() => setPreviewOpen(true), []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);

  const aspect = aspectClass(aspectRatio);

  // Loading state
  if (status === "pending" || status === "generating") {
    return (
      <div className={`${aspect} bg-neutral-800/50 border border-neutral-700/50 rounded-lg flex items-center justify-center`}>
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-neutral-600 border-t-neutral-300 rounded-full animate-spin" />
          <span className="text-[11px] text-neutral-500">
            {status === "pending" ? "Queued" : "Generating..."}
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (status === "failed") {
    return (
      <div className={`${aspect} bg-neutral-800/50 border border-red-900/30 rounded-lg flex items-center justify-center p-3`}>
        <div className="flex flex-col items-center gap-2 text-center">
          <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="text-[11px] text-red-400 line-clamp-2">{error || "Failed"}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-[11px] text-blue-400 hover:text-blue-300 underline"
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
            className="text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Copy
          </button>
        </div>
      </div>
    );
  }

  const lightboxProps = batchItems && batchIndex !== undefined
    ? { batchItems, initialIndex: batchIndex }
    : { batchItems: [generation], initialIndex: 0 };

  // Video result
  if (mode === "video" && result) {
    return (
      <>
        <div
          className={`relative ${aspect} bg-neutral-800/50 border border-neutral-700/50 rounded-lg overflow-hidden group cursor-pointer`}
          onClick={openPreview}
        >
          <video
            src={result}
            className="w-full h-full object-cover"
            preload="metadata"
            muted
            playsInline
            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
          />
          {/* Play icon overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all">
              <svg className="w-5 h-5 text-white ms-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </div>
        {previewOpen && <Lightbox {...lightboxProps} onClose={closePreview} />}
      </>
    );
  }

  // Image result (default)
  if (result) {
    return (
      <>
        <div
          className={`relative ${aspect} bg-neutral-800/50 border border-neutral-700/50 rounded-lg overflow-hidden group cursor-pointer`}
          onClick={openPreview}
        >
          <img
            src={result}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </div>
        {previewOpen && <Lightbox {...lightboxProps} onClose={closePreview} />}
      </>
    );
  }

  return null;
}
