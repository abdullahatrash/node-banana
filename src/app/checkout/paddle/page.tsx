import { getTranslations } from "next-intl/server";
import { getLocaleFromCookies } from "@/lib/locale";
import { PaddleCheckout } from "./PaddleCheckout";

export const dynamic = "force-dynamic";

export default async function PaddleCheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, localeState, t] = await Promise.all([searchParams, getLocaleFromCookies(), getTranslations("paddleCheckout")]);
  const transactionId = single(params.transactionId);
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim() ?? "";
  const environment = process.env.PADDLE_ENVIRONMENT === "live" ? "live" : "sandbox";
  const successPath = returnPath(single(params.successPath), "/settings?section=billing&checkout=success");
  const cancelPath = returnPath(single(params.cancelPath), "/settings?section=billing&checkout=cancelled");

  if (!/^txn_[a-z0-9]+$/.test(transactionId) || !clientToken) {
    return <main className="grid min-h-screen place-items-center p-8"><p role="alert">{t("unavailable")}</p></main>;
  }

  return <PaddleCheckout transactionId={transactionId} clientToken={clientToken} environment={environment} locale={localeState.locale} successPath={successPath} cancelPath={cancelPath} copy={{ title: t("title"), description: t("description"), loading: t("loading"), retry: t("retry"), unavailable: t("unavailable") }} />;
}

function single(value: string | string[] | undefined) { return typeof value === "string" ? value : ""; }
function returnPath(value: string, fallback: string) { return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback; }
