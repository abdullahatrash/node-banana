import { cookies } from "next/headers";
import type { Locale, Direction } from "@/store/directionStore";

export function resolveLocale(cookieValue: string | undefined): Locale {
  return cookieValue === "en" ? "en" : "ar";
}

export async function getLocaleFromCookies(): Promise<{
  locale: Locale;
  direction: Direction;
}> {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get("NEXT_LOCALE")?.value);
  const direction: Direction = locale === "ar" ? "rtl" : "ltr";
  return { locale, direction };
}
