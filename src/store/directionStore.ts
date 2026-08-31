"use client";

import { create } from "zustand";

export type Locale = "en" | "ar";
export type Direction = "ltr" | "rtl";

interface DirectionState {
  locale: Locale;
  direction: Direction;
  setLocale: (locale: Locale) => void;
}

const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function directionFromLocale(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

export const useDirectionStore = create<DirectionState>((set) => ({
  locale: "ar",
  direction: "rtl",

  setLocale: (locale: Locale) => {
    const direction = directionFromLocale(locale);

    if (typeof document !== "undefined") {
      document.documentElement.dir = direction;
      document.documentElement.lang = locale;
      document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    }

    set({ locale, direction });
  },
}));
