import type { Metadata } from "next";
import "./globals.css";
import { Toast } from "@/components/Toast";
import { Alexandria, Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { getLocaleFromCookies } from "@/lib/locale";
import { DirectionHydrator } from "@/components/DirectionHydrator";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { createTranslator } from "next-intl";
import { catalogs } from "@/i18n/catalog";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const alexandria = Alexandria({
  subsets: ["arabic"],
  variable: "--font-alexandria",
});

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getLocaleFromCookies();
  const t = createTranslator({ locale, messages: catalogs[locale], namespace: "metadata" });
  return { title: t("appTitle"), description: t("appDescription") };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [{ locale, direction }, messages] = await Promise.all([
    getLocaleFromCookies(),
    getMessages(),
  ]);

  return (
    <html
      lang={locale}
      dir={direction}
      className={cn("font-sans", geist.variable, alexandria.variable)}
    >
      <body className="antialiased">
        <DirectionProvider direction={direction}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <DirectionHydrator locale={locale} />
            {children}
            <Toast />
          </NextIntlClientProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
