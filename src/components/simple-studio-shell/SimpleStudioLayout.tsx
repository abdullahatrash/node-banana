"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { SimpleStudioHeaderActions } from "./SimpleStudioSiteHeader";
import { SavePromptDialog } from "./SavePromptDialog";
import { ProductShell } from "@/components/product-shell/ProductShell";
import type { ProductShellContext } from "@/lib/product-shell/server";
import { modeFromPathname } from "./urlToMode";
import { useGenerateShortcut } from "./useGenerateShortcut";

interface SimpleStudioLayoutProps {
  children: React.ReactNode;
  shellContext: ProductShellContext;
}

export function SimpleStudioLayout({ children, shellContext }: SimpleStudioLayoutProps) {
  const pathname = usePathname();
  const setMode = useSimpleStudioStore((s) => s.setMode);
  const loadRecentResults = useSimpleStudioStore((s) => s.loadRecentResults);
  const initialized = useRef(false);

  // Sync store mode with URL on every pathname change
  useEffect(() => {
    const mode = modeFromPathname(pathname ?? "");
    if (mode) {
      setMode(mode);
    }
  }, [pathname, setMode]);

  useGenerateShortcut(pathname);

  // Load recent results once on first mount
  if (!initialized.current) {
    initialized.current = true;
    loadRecentResults();
  }

  return (
    <ProductShell context={shellContext} headerActions={<SimpleStudioHeaderActions />}>
      {children}
      <SavePromptDialog />
    </ProductShell>
  );
}
