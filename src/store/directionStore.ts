"use client";

import { create } from "zustand";
import {
  getDirection,
  type AppDirection,
  type AppLocale,
} from "@/i18n/config";

export type Locale = AppLocale;
export type Direction = AppDirection;

interface DirectionState {
  locale: Locale;
  direction: Direction;
  setLocale: (locale: Locale) => void;
}

export const useDirectionStore = create<DirectionState>((set) => ({
  locale: "ar",
  direction: "rtl",

  setLocale: (locale: Locale) => {
    const direction = getDirection(locale);

    if (typeof document !== "undefined") {
      document.documentElement.dir = direction;
      document.documentElement.lang = locale;
    }

    set({ locale, direction });
  },
}));
