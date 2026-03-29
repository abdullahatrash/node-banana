import type { Metadata } from "next";
import "./globals.css";
import { Toast } from "@/components/Toast";
import { Geist, Noto_Sans_Arabic } from "next/font/google";
import { cn } from "@/lib/utils";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { getLocaleFromCookies } from "@/lib/locale";
import { DirectionHydrator } from "@/components/DirectionHydrator";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const notoArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-noto-arabic",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Tasmeemai - AI Content Studio",
  description:
    "AI Content Studio for creating and managing content pipelines using AI. Create workflows to generate images, videos, text, and more.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, direction } = await getLocaleFromCookies();

  return (
    <html
      lang={locale}
      dir={direction}
      className={cn("font-sans", geist.variable, notoArabic.variable)}
    >
      <body className="antialiased">
        <DirectionProvider direction={direction}>
          <DirectionHydrator locale={locale} />
          {children}
          <Toast />
        </DirectionProvider>
      </body>
    </html>
  );
}
