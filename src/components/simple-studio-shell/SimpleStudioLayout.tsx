"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSimpleStudioStore } from "@/store/simpleStudioStore";
import { SimpleStudioAppSidebar } from "./SimpleStudioAppSidebar";
import { SimpleStudioSiteHeader } from "./SimpleStudioSiteHeader";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { modeFromPathname } from "./urlToMode";

interface SimpleStudioLayoutProps {
  children: React.ReactNode;
}

export function SimpleStudioLayout({ children }: SimpleStudioLayoutProps) {
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

  // Load recent results once on first mount
  if (!initialized.current) {
    initialized.current = true;
    loadRecentResults();
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <SimpleStudioAppSidebar variant="inset" />
      <SidebarInset>
        <SimpleStudioSiteHeader />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
