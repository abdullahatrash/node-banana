import { isDatabaseConfigured } from "@/lib/db";
import { getReleaseControlService } from "@/lib/release-control/production";
import { createTranslator } from "next-intl";
import { catalogs } from "@/i18n/catalog";

export default async function StatusPage({ params }: { params: Promise<{ locale: string }> }) {
  const raw = (await params).locale; const locale = raw === "ar" ? "ar" : "en"; const t = createTranslator({ locale, messages: catalogs[locale], namespace: "releaseQuality.statusPage" });
  let incidents: Array<{ id: string; severity: "minor" | "major" | "critical"; status: "investigating" | "identified" | "monitoring" | "resolved"; impactedServices: string[]; startedAt: Date; resolvedAt: Date | null; summary: string }> = []; let status: "operational" | "degraded" | "unknown" = "unknown";
  const statusWorkspaceId = process.env.PUBLIC_STATUS_WORKSPACE_ID?.trim();
  if (isDatabaseConfigured() && statusWorkspaceId) { try { incidents = await getReleaseControlService().publicIncidents(locale, statusWorkspaceId); status = incidents.some((item) => item.status !== "resolved") ? "degraded" : "operational"; } catch {} }
  return <main lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="mx-auto min-h-screen max-w-3xl space-y-8 p-6 md:p-12"><header><p className="text-sm text-muted-foreground">{t("brand")}</p><h1 className="mt-2 text-3xl font-semibold">{t("title")}</h1><p role="status" className="mt-4 rounded-xl border bg-card p-4 text-lg">{t(status)}</p></header><section className="space-y-4">{incidents.map((item) => <article key={item.id} className="rounded-xl border bg-card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><strong>{item.summary}</strong><span className="rounded-full bg-muted px-3 py-1 text-sm">{t(item.status)}</span></div><p className="mt-3 text-sm text-muted-foreground">{t("services")}: {item.impactedServices.join(" · ")}</p><time className="mt-2 block text-xs text-muted-foreground" dateTime={item.startedAt.toISOString()}>{item.startedAt.toLocaleString(locale)}</time></article>)}{!incidents.length ? <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">{status === "unknown" ? t("unknown") : t("noIncidents")}</p> : null}</section></main>;
}
