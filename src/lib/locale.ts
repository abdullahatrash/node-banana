import { cache } from "react";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import {
  activeWorkspaceCookieName,
  defaultLocale,
  getDirection,
  isAppLocale,
  localeCookieName,
  type AppDirection,
  type AppLocale,
} from "@/i18n/config";
import { readWorkspaceLocaleContext } from "@/lib/interface-locale/repository";

export type LocaleResolutionInput = {
  sessionLocale?: string;
  preferenceLocale?: string;
  workspaceLocale?: string;
  acceptLanguage?: string;
};

export function resolveLocale(input: LocaleResolutionInput | string = {}): AppLocale {
  const candidates = typeof input === "string" ? { sessionLocale: input } : input;
  for (const candidate of [
    candidates.sessionLocale,
    candidates.preferenceLocale,
    candidates.workspaceLocale,
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

export const getLocaleFromCookies = cache(async (): Promise<{
  locale: AppLocale;
  direction: AppDirection;
  route: string;
}> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const explicitLocale =
    headerStore.get("x-interface-locale") ?? cookieStore.get(localeCookieName)?.value;
  let durableContext: Awaited<ReturnType<typeof readWorkspaceLocaleContext>> = null;
  if (!isAppLocale(explicitLocale)) {
    try {
      durableContext = await readWorkspaceLocaleContext({
        requestHeaders: new Headers(headerStore),
        selectedWorkspaceId: headerStore.get("x-workspace-id") ?? cookieStore.get(activeWorkspaceCookieName)?.value,
      });
    } catch (error) {
      console.error("[locale-preference]", {
        code: "INTERFACE_LOCALE_PREFERENCE_READ_FAILED",
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  const locale = resolveLocale({
    sessionLocale: explicitLocale,
    preferenceLocale: durableContext?.preferenceLocale ?? undefined,
    workspaceLocale: durableContext?.workspaceLocale,
    acceptLanguage: headerStore.get("accept-language") ?? undefined,
  });
  return {
    locale,
    direction: getDirection(locale),
    route: headerStore.get("x-interface-route") ?? headerStore.get("next-url") ?? "unknown",
  };
});
