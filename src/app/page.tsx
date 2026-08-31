import type { Metadata } from "next";
import { MarketingHome } from "@/components/marketing/MarketingHome";
import { getLocaleFromCookies } from "@/lib/locale";
import { getPublicAppUrl } from "@/lib/site-routing";

export const metadata: Metadata = {
  title: "تصميمي — صناعة ونشر المحتوى للمنطقة العربية",
  description:
    "مساحة عمل عربية لإنشاء الصور والفيديو والنصوص، وتنظيم المحتوى ونشره عبر قنواتك الاجتماعية.",
  openGraph: {
    title: "تصميمي — محتوى عربي من الفكرة إلى النشر",
    description:
      "أنشئ ونظّم وانشر محتوى علامتك من مساحة عمل واحدة مصممة لفرق المنطقة العربية.",
    type: "website",
    locale: "ar_AR",
  },
};

export default async function HomePage() {
  const { locale } = await getLocaleFromCookies();

  return (
    <MarketingHome
      locale={locale}
      contentStudioUrl={getPublicAppUrl("/simple-studio/images")}
      signInUrl={getPublicAppUrl("/sign-in")}
      signUpUrl={getPublicAppUrl("/sign-up")}
    />
  );
}
