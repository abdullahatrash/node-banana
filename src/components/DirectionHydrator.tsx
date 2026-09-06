"use client";

import { useEffect } from "react";
import { useDirectionStore, type Locale } from "@/store/directionStore";

export function DirectionHydrator({ locale }: { locale: Locale }) {
  useEffect(() => {
    const store = useDirectionStore.getState();
    if (store.locale !== locale) {
      store.setLocale(locale);
    }
  }, [locale]);

  return null;
}
