"use client";

import { Header } from "@/components/Header";
import { Sidebar } from "@/components/simple-studio/Sidebar";
import { ResultsGallery } from "@/components/simple-studio/ResultsGallery";

/**
 * Simple Studio — form-based batch generation UI.
 *
 * Two-panel layout: left sidebar (form) + right panel (results gallery).
 */
export function SimpleStudioClient() {
  return (
    <div className="h-screen flex flex-col bg-neutral-950">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar — form */}
        <aside className="w-[380px] shrink-0 border-e border-neutral-800 bg-neutral-900 overflow-y-auto">
          <Sidebar />
        </aside>

        {/* Right panel — results gallery */}
        <main className="flex-1 overflow-y-auto bg-neutral-950">
          <ResultsGallery />
        </main>
      </div>
    </div>
  );
}
