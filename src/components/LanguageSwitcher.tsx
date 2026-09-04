"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useDirectionStore } from "@/store/directionStore";
import { Button } from "@/components/ui/button";
import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { getActiveWorkspaceId } from "@/lib/studio/client";

export function LanguageSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const setLocale = useDirectionStore((state) => state.setLocale);
  const t = useTranslations("common.languageSwitch");
  const [isSaving, setIsSaving] = useState(false);

  async function toggle() {
    if (isSaving) return;
    const next = locale === "en" ? "ar" : "en";
    setIsSaving(true);
    setLocale(next);
    const workspaceId = getActiveWorkspaceId();
    try {
      const response = await fetch("/api/preferences/locale", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        },
        body: JSON.stringify({ locale: next }),
        keepalive: true,
      });
      if (!response.ok) throw new Error("INTERFACE_LOCALE_SAVE_FAILED");
      if (/^\/(ar|en)(?:\/|$)/.test(pathname)) {
        router.replace(pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${next}`));
      } else {
        router.refresh();
      }
    } catch {
      setLocale(locale === "ar" ? "ar" : "en");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" disabled={isSaving} aria-busy={isSaving} onClick={() => void toggle()} className={className}>
      <LanguagesIcon data-icon="inline-start" />
      {t(locale === "en" ? "ar" : "en")}
    </Button>
  );
}
