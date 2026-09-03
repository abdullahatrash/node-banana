import { getRequestConfig } from "next-intl/server";
import { getLocaleFromCookies } from "@/lib/locale";
import { catalogs } from "./catalog";
import { getAuthoredMessageFallback } from "./fallback";
import { reportLocalizationIncident } from "./incidents";

export default getRequestConfig(async () => {
  const { locale, route } = await getLocaleFromCookies();

  return {
    locale,
    messages: catalogs[locale],
    onError(error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[i18n]", { code: error.code, locale, message: error.message });
      }
    },
    getMessageFallback({ error, key, namespace }) {
      const fallback = getAuthoredMessageFallback(locale, namespace, key);
      reportLocalizationIncident({
        locale,
        fallbackLocale: fallback.locale,
        route,
        key: namespace ? `${namespace}.${key}` : key,
        errorCode: error.code,
      });
      return fallback.message;
    },
  };
});
