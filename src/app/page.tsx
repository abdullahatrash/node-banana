import { getLocaleFromCookies } from "@/lib/locale";
import { permanentRedirect } from "next/navigation";

export default async function HomePage() {
  const { locale } = await getLocaleFromCookies();
  permanentRedirect(`/${locale}`);
}
