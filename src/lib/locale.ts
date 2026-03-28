import { cookies } from "next/headers";
import type { Locale, Direction } from "@/store/directionStore";

export async function getLocaleFromCookies(): Promise<{
  locale: Locale;
  direction: Direction;
}> {
  const cookieStore = await cookies();
  const locale =
    cookieStore.get("NEXT_LOCALE")?.value === "ar" ? "ar" : "en";
  const direction: Direction = locale === "ar" ? "rtl" : "ltr";
  return { locale, direction };
}
