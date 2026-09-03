"use client";

import { create } from "zustand";
import {
  getDirection,
  localeCookieName,
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

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const useDirectionStore = create<DirectionState>((set) => ({
  locale: "ar",
  direction: "rtl",

  setLocale: (locale: Locale) => {
    const direction = getDirection(locale);

    if (typeof document !== "undefined") {
      document.documentElement.dir = direction;
      document.documentElement.lang = locale;
      document.cookie = `${localeCookieName}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    }

    set({ locale, direction });
  },
}));
