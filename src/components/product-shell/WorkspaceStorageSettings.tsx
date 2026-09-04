"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { getDirection } from "@/i18n/config";
import type { WorkspaceStorageSummary } from "@/lib/studio/repository";

export function WorkspaceStorageSettings({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("product.storageSettings") as (key: string, values?: Record<string, string | number>) => string;
  const locale = useLocale() as "ar" | "en";
  const [data, setData] = useState<WorkspaceStorageSummary | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/studio/storage", { headers: { "x-workspace-id": workspaceId }, cache: "no-store" });
    const body = await response.json() as { success?: boolean; data?: WorkspaceStorageSummary; code?: string };
    if (!response.ok || !body.success || !body.data) throw new Error(body.code ?? "REQUEST_FAILED");
    setData(body.data);
  }, [workspaceId]);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "REQUEST_FAILED")); }, [load]);

  const formatBytes = (bytes: number) => {
    const units = ["bytes", "kb", "mb", "gb", "tb"] as const;
    let value = Math.max(0, bytes); let index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
    return t(`units.${units[index]}`, { value: new Intl.NumberFormat(locale, { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value) });
  };

  if (!data) return <div dir={getDirection(locale)} className="p-6">{error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{t("errors.REQUEST_FAILED")}</p><button onClick={() => void load().catch(() => setError("REQUEST_FAILED"))} className="min-h-10 rounded-lg border px-3 text-sm font-semibold">{t("retry")}</button></div> : <LoaderCircle className="size-5 animate-spin" aria-label={t("loading")} />}</div>;

  const projectedBytes = data.usedBytes + data.pendingReservedBytes;
  const ratio = data.quotaBytes > 0 ? Math.min(1, projectedBytes / data.quotaBytes) : 1;
  const percent = Math.round(ratio * 100);
  const measured = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.measuredAt));

  return <div dir={getDirection(locale)} className="space-y-7 p-5 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-semibold">{t("title")}</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p></div><Link href="/billing" className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">{t("upgrade")}</Link></header>
    <section aria-labelledby="storage-usage-title" className="rounded-2xl border p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 id="storage-usage-title" className="font-semibold">{t("usage")}</h3><p className="mt-2 text-3xl font-semibold tabular-nums"><bdi>{formatBytes(data.usedBytes)}</bdi></p><p className="mt-1 text-sm text-muted-foreground">{t("ofLimit", { limit: formatBytes(data.quotaBytes) })}</p></div><strong className="text-xl tabular-nums"><bdi>{new Intl.NumberFormat(locale, { style: "percent" }).format(ratio)}</bdi></strong></div><div role="progressbar" aria-label={t("usageProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-4 h-3 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${ratio >= 0.9 ? "bg-destructive" : ratio >= 0.75 ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${percent}%` }} /></div>{data.pendingReservedBytes > 0 ? <p className="mt-3 text-sm text-amber-700">{t("pending", { size: formatBytes(data.pendingReservedBytes) })}</p> : null}<p className="mt-2 text-xs text-muted-foreground">{t("measured", { date: measured })}</p></section>
    <section className="grid gap-4 sm:grid-cols-2"><article className="rounded-2xl border p-5"><p className="text-sm text-muted-foreground">{t("activeAssets")}</p><p className="mt-2 text-3xl font-semibold tabular-nums"><bdi>{new Intl.NumberFormat(locale).format(data.activeAssetCount)}</bdi></p></article><article className="rounded-2xl border p-5"><p className="text-sm text-muted-foreground">{t("recoverable")}</p><p className="mt-2 text-3xl font-semibold tabular-nums"><bdi>{formatBytes(data.recoverableDeletedBytes)}</bdi></p><p className="mt-1 text-xs text-muted-foreground">{t("recoverableCount", { count: new Intl.NumberFormat(locale).format(data.recoverableDeletedCount) })}</p></article></section>
    <section><h3 className="font-semibold">{t("breakdown")}</h3>{data.byType.length === 0 ? <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("empty")}</p> : <div className="mt-3 grid gap-2">{data.byType.map((item) => <div key={item.type} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span>{t(`types.${item.type}`)} · {t("assetCount", { count: new Intl.NumberFormat(locale).format(item.count) })}</span><strong><bdi>{formatBytes(item.bytes)}</bdi></strong></div>)}</div>}</section>
    <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("cleanup.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("cleanup.description")}</p><Link href="/library" className="mt-4 inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">{t("cleanup.action")}</Link><p className="mt-3 text-xs text-muted-foreground">{t("cleanup.boundary")}</p></section>
  </div>;
}
