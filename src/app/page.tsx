import type { Metadata } from "next";
import { MarketingHome } from "@/components/marketing/MarketingHome";
import { getLocaleFromCookies } from "@/lib/locale";
import { getPublicAppUrl } from "@/lib/site-routing";

export const metadata: Metadata = {
  title: "تصميمي — محتوى قصير للمنطقة العربية",
  description:
    "حوّل الترندات وأفكار علامتك إلى فيديوهات وشرائح، واملأ تقويمك وانشر عبر تيك توك وإنستغرام ريلز ويوتيوب شورتس.",
  openGraph: {
    title: "تصميمي — 30 يومًا من المحتوى القصير في دقائق",
    description:
      "منصة صناعة ونشر المحتوى القصير للشرق الأوسط وشمال أفريقيا.",
    type: "website",
    locale: "ar_AR",
  },
};

export default async function HomePage() {
  const { locale } = await getLocaleFromCookies();

  return (
    <MarketingHome
      locale={locale}
      contentStudioUrl={getPublicAppUrl("/social/compose")}
      signInUrl={getPublicAppUrl("/sign-in")}
      signUpUrl={getPublicAppUrl("/sign-up")}
    />
  );
}
