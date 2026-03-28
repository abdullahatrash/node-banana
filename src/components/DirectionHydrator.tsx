"use client";

import { useRef } from "react";
import { useDirectionStore, type Locale } from "@/store/directionStore";

export function DirectionHydrator({ locale }: { locale: Locale }) {
  const initialized = useRef(false);

  if (!initialized.current) {
    initialized.current = true;
    const store = useDirectionStore.getState();
    if (store.locale !== locale) {
      store.setLocale(locale);
    }
  }

  return null;
}
