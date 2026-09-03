import { cache } from "react";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import {
  defaultLocale,
  getDirection,
  isAppLocale,
  localeCookieName,
  type AppDirection,
  type AppLocale,
} from "@/i18n/config";
import { getAuthenticatedUserFromHeaders } from "@/lib/auth/session";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";

type LocaleResolutionInput = {
  sessionLocale?: string;
  preferenceLocale?: string;
  workspaceLocale?: string;
  cookieLocale?: string;
  acceptLanguage?: string;
};

export function resolveLocale(input: LocaleResolutionInput | string = {}): AppLocale {
  const candidates = typeof input === "string" ? { cookieLocale: input } : input;
  for (const candidate of [
    candidates.sessionLocale,
    candidates.preferenceLocale,
    candidates.workspaceLocale,
    candidates.cookieLocale,
  ]) {
    if (isAppLocale(candidate)) return candidate;
  }

  const browserLocales = candidates.acceptLanguage
    ?.split(",")
    .map((part, index) => {
      const [language, ...parameters] = part.trim().toLowerCase().split(";");
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
      return { language, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter(({ language, quality }) => Boolean(language) && quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const { language } of browserLocales ?? []) {
    if (language === "ar" || language.startsWith("ar-")) return "ar";
    if (language === "en" || language.startsWith("en-")) return "en";
  }
  return defaultLocale;
}

async function readDurablePreference(requestHeaders: Headers): Promise<string | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  try {
    const user = await getAuthenticatedUserFromHeaders(requestHeaders);
    if (!user) return undefined;
    const [preference] = await getDb()
      .select({ locale: userPreferences.interfaceLocale })
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);
    return preference?.locale;
  } catch (error) {
    console.error("[locale-preference]", {
      code: "INTERFACE_LOCALE_PREFERENCE_READ_FAILED",
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return undefined;
  }
}

export const getLocaleFromCookies = cache(async (): Promise<{
  locale: AppLocale;
  direction: AppDirection;
  route: string;
}> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const explicitLocale =
    headerStore.get("x-interface-locale") ?? cookieStore.get(localeCookieName)?.value;
  const preferenceLocale = isAppLocale(explicitLocale)
    ? undefined
    : await readDurablePreference(new Headers(headerStore));
  const locale = resolveLocale({
    sessionLocale: explicitLocale,
    preferenceLocale,
    acceptLanguage: headerStore.get("accept-language") ?? undefined,
  });
  return {
    locale,
    direction: getDirection(locale),
    route: headerStore.get("x-interface-route") ?? headerStore.get("next-url") ?? "unknown",
  };
});
