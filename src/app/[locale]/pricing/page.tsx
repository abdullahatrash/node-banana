import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createTranslator } from "next-intl";
import { PricingPage } from "@/components/marketing/PricingPage";
import arMessages from "@/i18n/messages/ar.json";
import enMessages from "@/i18n/messages/en.json";
import { isAppLocale } from "@/i18n/config";
import { getPublicAppUrl } from "@/lib/site-routing";

const messagesByLocale = { ar: arMessages, en: enMessages } as const;
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isAppLocale(locale)) return {};
  const t = createTranslator({ locale, messages: messagesByLocale[locale], namespace: "metadata" });
  return {
    title: t("pricingTitle"),
    description: t("pricingDescription"),
    alternates: { canonical: `/${locale}/pricing`, languages: { ar: "/ar/pricing", en: "/en/pricing" } },
    openGraph: { title: t("pricingTitle"), description: t("pricingDescription"), type: "website", locale: locale === "ar" ? "ar_AR" : "en_US" },
  };
}

export default async function LocalizedPricingPage({ params }: Props) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();
  return <PricingPage locale={locale} signInUrl={getPublicAppUrl("/sign-in")} signUpUrl={getPublicAppUrl("/sign-up")} />;
}
