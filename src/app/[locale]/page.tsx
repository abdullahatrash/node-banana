import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingHome } from "@/components/marketing/MarketingHome";
import { getPublicAppUrl } from "@/lib/site-routing";
import { isAppLocale } from "@/i18n/config";
import { createTranslator } from "next-intl";
import arMessages from "@/i18n/messages/ar.json";
import enMessages from "@/i18n/messages/en.json";

const messagesByLocale = { ar: arMessages, en: enMessages } as const;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isAppLocale(locale)) return {};
  const t = createTranslator({ locale, messages: messagesByLocale[locale], namespace: "metadata" });
  return {
    title: t("homeTitle"),
    description: t("homeDescription"),
    alternates: { canonical: `/${locale}`, languages: { ar: "/ar", en: "/en" } },
    openGraph: { title: t("homeOgTitle"), description: t("homeOgDescription"), type: "website", locale: locale === "ar" ? "ar_AR" : "en_US" },
  };
}

export default async function LocalizedHomePage({ params }: Props) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();

  return (
    <MarketingHome
      locale={locale}
      contentStudioUrl={getPublicAppUrl("/social/compose")}
      signInUrl={getPublicAppUrl("/sign-in")}
      signUpUrl={getPublicAppUrl("/sign-up")}
    />
  );
}
