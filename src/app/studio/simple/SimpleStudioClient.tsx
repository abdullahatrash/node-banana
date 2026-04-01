"use client";

import { Header } from "@/components/Header";

/**
 * Simple Studio — form-based batch generation UI.
 *
 * Two-panel layout: left sidebar (form) + right panel (results gallery).
 * Actual sidebar form and gallery components will be added in subsequent issues.
 */
export function SimpleStudioClient() {
  return (
    <div className="h-screen flex flex-col">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar — form */}
        <aside className="w-[380px] shrink-0 border-e border-neutral-800 bg-neutral-900/50 overflow-y-auto">
          <div className="p-6 text-neutral-500 text-sm">
            Sidebar form will go here
          </div>
        </aside>

        {/* Right panel — results gallery */}
        <main className="flex-1 overflow-y-auto bg-neutral-950">
          <div className="p-6 text-neutral-500 text-sm">
            Results gallery will go here
          </div>
        </main>
      </div>
    </div>
  );
}
