"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

export function ServiceStatusBanner() {
  const locale = useLocale() === "ar" ? "ar" : "en"; const t = useTranslations("releaseQuality.status"); const [status, setStatus] = useState<"operational" | "degraded" | "unknown" | null>(null); const [summary, setSummary] = useState("");
  useEffect(() => { const controller = new AbortController(); void fetch(`/api/status?locale=${locale}`, { cache: "no-store", signal: controller.signal }).then(async (response) => { const data = await response.json() as { status?: string; incidents?: Array<{ summary?: string }> }; setStatus(data.status === "operational" || data.status === "degraded" ? data.status : "unknown"); setSummary(data.incidents?.[0]?.summary || ""); }).catch(() => setStatus("unknown")); return () => controller.abort(); }, [locale]);
  if (!status || status === "operational") return null;
  return <aside role="status" className={status === "degraded" ? "border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm" : "border-b bg-muted px-4 py-2 text-sm"}><a href={`/${locale}/status`} className="underline underline-offset-4">{t(status)}{summary ? ` — ${summary}` : ""}</a></aside>;
}
