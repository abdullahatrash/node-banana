"use client";

import { useRouter } from "next/navigation";
import { useDirectionStore } from "@/store/directionStore";
import { Button } from "@/components/ui/button";
import { LanguagesIcon } from "lucide-react";

export function LanguageSwitcher() {
  const router = useRouter();
  const { locale, setLocale } = useDirectionStore();

  function toggle() {
    const next = locale === "en" ? "ar" : "en";
    setLocale(next);
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle}>
      <LanguagesIcon data-icon="inline-start" />
      {locale === "en" ? "العربية" : "English"}
    </Button>
  );
}
