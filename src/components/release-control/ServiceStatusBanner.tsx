"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

export function ServiceStatusBanner() {
  const locale = useLocale() === "ar" ? "ar" : "en"; const t = useTranslations("releaseQuality.status"); const [status, setStatus] = useState<"operational" | "degraded" | "majorOutage" | "criticalOutage" | "unknown" | null>(null); const [summary, setSummary] = useState("");
  useEffect(() => { const controller = new AbortController(); void fetch(`/api/status?locale=${locale}`, { cache: "no-store", signal: controller.signal }).then(async (response) => { const data = await response.json() as { status?: string; incidents?: Array<{ summary?: string }> }; setStatus(data.status === "operational" || data.status === "degraded" || data.status === "majorOutage" || data.status === "criticalOutage" ? data.status : "unknown"); setSummary(data.incidents?.[0]?.summary || ""); }).catch(() => setStatus("unknown")); return () => controller.abort(); }, [locale]);
  if (!status || status === "operational") return null;
  const severityClass = status === "criticalOutage" ? "border-red-600/50 bg-red-600/15" : status === "majorOutage" ? "border-orange-600/50 bg-orange-600/15" : status === "degraded" ? "border-amber-500/40 bg-amber-500/10" : "bg-muted";
  return <aside role="status" className={`border-b px-4 py-2 text-sm ${severityClass}`}><a href={`/${locale}/status`} className="underline underline-offset-4">{t(status)}{summary ? ` — ${summary}` : ""}</a></aside>;
}
