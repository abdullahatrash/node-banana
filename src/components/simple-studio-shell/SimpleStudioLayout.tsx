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
import type { WorkspaceContentLanguage } from "@/lib/product-surfaces/workspace-language-preferences";

interface SimpleStudioLayoutProps {
  children: React.ReactNode;
  shellContext: ProductShellContext;
  defaultContentLanguage: WorkspaceContentLanguage;
}

export function SimpleStudioLayout({ children, shellContext, defaultContentLanguage }: SimpleStudioLayoutProps) {
  const pathname = usePathname();
  const setMode = useSimpleStudioStore((s) => s.setMode);
  const loadRecentResults = useSimpleStudioStore((s) => s.loadRecentResults);
  const setDialogueLanguage = useSimpleStudioStore((s) => s.setDialogueLanguage);
  const setOutputLanguage = useSimpleStudioStore((s) => s.setOutputLanguage);
  const initialized = useRef(false);

  // Sync store mode with URL on every pathname change
  useEffect(() => {
    const mode = modeFromPathname(pathname ?? "");
    if (mode) {
      setMode(mode);
    }
  }, [pathname, setMode]);

  useEffect(() => {
    setDialogueLanguage(defaultContentLanguage);
    setOutputLanguage(defaultContentLanguage);
  }, [defaultContentLanguage, setDialogueLanguage, setOutputLanguage]);

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
