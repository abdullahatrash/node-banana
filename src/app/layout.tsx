import type { Metadata } from "next";
import "./globals.css";
import { Toast } from "@/components/Toast";
import { Alexandria, Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { getLocaleFromCookies } from "@/lib/locale";
import { DirectionHydrator } from "@/components/DirectionHydrator";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const alexandria = Alexandria({
  subsets: ["arabic"],
  variable: "--font-alexandria",
});

export const metadata: Metadata = {
  title: "Tasmeemai - AI Content Studio",
  description:
    "Arabic-first AI content creation and social publishing for MENA brands.",
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
      className={cn("font-sans", geist.variable, alexandria.variable)}
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
