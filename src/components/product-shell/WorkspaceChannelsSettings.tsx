"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { getDirection } from "@/i18n/config";
import type { WorkspaceChannelSummary } from "@/lib/social/channel-summary";

export function WorkspaceChannelsSettings({
  workspaceId,
  canConnect,
}: {
  workspaceId: string;
  canConnect: boolean;
}) {
  const locale = useLocale() as "ar" | "en";
  const t = useTranslations("product.channelSettings") as (key: string, values?: Record<string, string | number>) => string;
  const tPlatform = useTranslations("social.platforms");
  const [data, setData] = useState<WorkspaceChannelSummary | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    const response = await fetch("/api/social/channels/summary", {
      headers: { "x-workspace-id": workspaceId },
      cache: "no-store",
    });
    const body = await response.json() as { success?: boolean; data?: WorkspaceChannelSummary };
    if (!response.ok || !body.success || !body.data) throw new Error("REQUEST_FAILED");
    setData(body.data);
  }, [workspaceId]);

  useEffect(() => {
    void load().catch(() => setError(true));
  }, [load]);

  if (!data) {
    return (
      <div dir={getDirection(locale)} className="p-6">
        {error ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">{t("errors.REQUEST_FAILED")}</p>
            <button onClick={() => void load().catch(() => setError(true))} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">{t("retry")}</button>
          </div>
        ) : <LoaderCircle className="size-5 animate-spin" aria-label={t("loading")} />}
      </div>
    );
  }

  const ratio = data.entitlement.connectedChannels > 0
    ? Math.min(1, data.usage.active / data.entitlement.connectedChannels)
    : 1;
  const percent = Math.round(ratio * 100);
  const number = new Intl.NumberFormat(locale);
  const measured = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.measuredAt));

  return (
    <div dir={getDirection(locale)} className="space-y-7 p-5 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{t("title")}</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/channels" className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">{canConnect ? t("manage") : t("view")}</Link>
      </header>

      <section aria-labelledby="channel-allowance-title" className="rounded-2xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="channel-allowance-title" className="font-semibold">{t("allowance")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("plan", { name: data.entitlement.authoredName[locale], version: data.entitlement.planVersion })}</p>
          </div>
          <strong className="text-2xl tabular-nums"><bdi>{t("used", { current: number.format(data.usage.active), limit: number.format(data.entitlement.connectedChannels) })}</bdi></strong>
        </div>
        <div role="progressbar" aria-label={t("allowanceProgress")} aria-valuemin={0} aria-valuemax={data.entitlement.connectedChannels} aria-valuenow={data.usage.active} className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${ratio >= 1 ? "bg-destructive" : ratio >= 0.8 ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{t("remaining", { count: number.format(data.usage.remaining) })}</span>
          <span>{t("measured", { date: measured })}</span>
        </div>
        {data.usage.remaining === 0 ? <Link href="/billing" className="mt-4 inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">{t("upgrade")}</Link> : null}
      </section>

      <section aria-label={t("health")} className="grid gap-4 sm:grid-cols-3">
        {(["healthy", "requiresReauth", "disabled"] as const).map((key) => (
          <article key={key} className="rounded-2xl border p-5">
            <p className="text-sm text-muted-foreground">{t(`counts.${key}`)}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums"><bdi>{number.format(data.usage[key])}</bdi></p>
          </article>
        ))}
      </section>

      <section aria-labelledby="channel-providers-title">
        <h3 id="channel-providers-title" className="font-semibold">{t("providers")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("providersDescription")}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {data.providers.map((provider) => {
            const capabilities = [
              provider.supportsImages ? t("capabilities.images") : null,
              provider.supportsVideo ? t("capabilities.video") : null,
              provider.supportsCarousel ? t("capabilities.carousel") : null,
              provider.supportsPostMetrics ? t("capabilities.metrics") : null,
            ].filter((value): value is string => Boolean(value));
            return (
              <article key={provider.identifier} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h4 className="font-semibold">{tPlatform(provider.identifier)}</h4><p className="mt-1 text-xs text-muted-foreground">{t("connected", { count: number.format(provider.connected) })}</p></div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${provider.configured ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>{provider.configured ? t("configured") : t("notConfigured")}</span>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{capabilities.length ? capabilities.join(" · ") : t("capabilities.text")}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border p-5">
        <h3 className="font-semibold">{t("safeConnection.title")}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{t("safeConnection.description")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/channels" className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">{t("safeConnection.channels")}</Link>
          <Link href="/channels/onboarding" className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">{t("safeConnection.onboarding")}</Link>
          <Link href="/guide" className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">{t("safeConnection.help")}</Link>
        </div>
      </section>
    </div>
  );
}
