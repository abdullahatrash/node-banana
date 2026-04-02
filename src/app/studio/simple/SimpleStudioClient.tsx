"use client";

import { useState } from "react";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/simple-studio/Sidebar";
import { ResultsGallery } from "@/components/simple-studio/ResultsGallery";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";

function MobileProgress({ onTap }: { onTap: () => void }) {
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
    <button
      onClick={onTap}
      className="fixed bottom-6 inset-x-0 z-40 mx-auto w-[280px] bg-neutral-900 border border-neutral-700 rounded-full px-4 py-2.5 flex items-center gap-3 shadow-lg"
    >
      <div className="flex-1">
        <div className="w-full h-1 bg-neutral-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="text-xs text-neutral-400 shrink-0">
        {done}/{total}
      </span>
      <span
        role="button"
        onClick={(e) => {
          e.stopPropagation();
          cancelGeneration();
        }}
        className="text-xs text-red-400 hover:text-red-300 shrink-0"
      >
        Cancel
      </span>
    </button>
  );
}

/**
 * Simple Studio — form-based batch generation UI.
 *
 * Two-panel layout: left sidebar (form) + right panel (results gallery).
 * On mobile: full-width gallery + bottom Drawer for sidebar form.
 */
export function SimpleStudioClient() {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isGenerating = useSimpleStudioStore((s) => s.isGenerating);

  // Desktop layout — unchanged
  if (!isMobile) {
    return (
      <div className="h-screen flex flex-col bg-neutral-950">
        <Header />
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-[380px] shrink-0 border-e border-neutral-800 bg-neutral-900 overflow-y-auto">
            <Sidebar />
          </aside>
          <main className="flex-1 overflow-y-auto bg-neutral-950">
            <ResultsGallery />
          </main>
        </div>
      </div>
    );
  }

  // Mobile layout — full-width gallery + bottom Drawer for sidebar
  return (
    <div className="h-screen flex flex-col bg-neutral-950">
      <Header />
      <main className="flex-1 overflow-y-auto bg-neutral-950">
        <ResultsGallery />
      </main>

      {/* Floating Create button or progress bar */}
      {isGenerating ? (
        <MobileProgress onTap={() => setDrawerOpen(true)} />
      ) : (
        !drawerOpen && (
          <button
            onClick={() => setDrawerOpen(true)}
            className="fixed bottom-6 inset-x-0 z-40 mx-auto w-fit px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-full shadow-lg transition-colors flex items-center gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            Create
          </button>
        )
      )}

      {/* Bottom Drawer with Sidebar form */}
      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent className="max-h-[85vh] bg-neutral-900">
          <DrawerTitle className="sr-only">Create</DrawerTitle>
          <div className="overflow-y-auto">
            <Sidebar onGenerate={() => setDrawerOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
