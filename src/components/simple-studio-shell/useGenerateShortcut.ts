"use client";

import { useEffect } from "react";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { modeFromPathname } from "./urlToMode";

/**
 * Registers a window-level Cmd/Ctrl+Enter listener that triggers `generate()`
 * on the simple-studio store, but only while the user is on a form route
 * (`/simple-studio/{images,videos,copy}`). No-ops on library/prompt-library.
 */
export function useGenerateShortcut(pathname: string | null) {
  useEffect(() => {
    const onFormRoute = modeFromPathname(pathname ?? "") !== null;
    if (!onFormRoute) return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        const s = useSimpleStudioStore.getState();
        if (s.prompt.trim() && !s.isGenerating && !s.isRewriting) {
          void s.generate();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pathname]);
}
