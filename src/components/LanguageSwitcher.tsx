"use client";

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

  function toggle() {
    const next = locale === "en" ? "ar" : "en";
    setLocale(next);
    const workspaceId = getActiveWorkspaceId();
    void fetch("/api/preferences/locale", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
      },
      body: JSON.stringify({ locale: next }),
      keepalive: true,
    });
    if (/^\/(ar|en)(?:\/|$)/.test(pathname)) {
      router.replace(pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${next}`));
    } else {
      router.refresh();
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} className={className}>
      <LanguagesIcon data-icon="inline-start" />
      {t(locale === "en" ? "ar" : "en")}
    </Button>
  );
}
