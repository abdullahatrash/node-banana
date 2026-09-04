"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { getDirection } from "@/i18n/config";

export function SettingsSheet({ children }: { children: ReactNode }) {
  const router = useRouter();
  const locale = useLocale();
  const isArabic = locale === "ar";

  return (
    <Sheet
      defaultOpen
      onOpenChange={(open) => {
        if (!open) router.replace("/dashboard");
      }}
    >
      <SheetContent
        side={isArabic ? "left" : "right"}
        dir={getDirection(isArabic ? "ar" : "en")}
        showCloseButton={false}
        aria-labelledby="settings-title"
        aria-describedby="settings-description"
        className="w-full gap-0 p-0 data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:sm:max-w-none data-[side=right]:sm:max-w-none data-[side=left]:md:w-[min(52rem,calc(100vw-3rem))] data-[side=right]:md:w-[min(52rem,calc(100vw-3rem))]"
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}
