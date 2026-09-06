import { getLocaleFromCookies } from "@/lib/locale";
import { permanentRedirect } from "next/navigation";

export default async function PricingPage() {
  const { locale } = await getLocaleFromCookies();
  permanentRedirect(`/${locale}/pricing`);
}
