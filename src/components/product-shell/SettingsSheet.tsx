"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export function SettingsSheet({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <Sheet
      defaultOpen
      onOpenChange={(open) => {
        if (!open) router.replace("/dashboard");
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-labelledby="settings-title"
        aria-describedby="settings-description"
        className="w-full gap-0 p-0 sm:max-w-none md:w-[min(52rem,calc(100vw-3rem))]"
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}
