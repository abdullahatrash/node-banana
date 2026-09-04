"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, FolderOpen, LoaderCircle, Plus, Search, Trash2 } from "lucide-react";
import { getDirection } from "@/i18n/config";
import type { WorkspaceRemixSummary } from "@/lib/product-surfaces/content-theme-summary";

export function WorkspaceRemixSettings({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const t = useTranslations("product.remixSettings") as (key: string, values?: Record<string, string | number>) => string;
  const locale = useLocale() as "ar" | "en";
  const [data, setData] = useState<WorkspaceRemixSummary | null>(null);
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/product-themes", { headers: { "x-workspace-id": workspaceId }, cache: "no-store" });
    const body = await response.json() as { success?: boolean; data?: WorkspaceRemixSummary; code?: string };
    if (!response.ok || !body.success || !body.data) throw new Error(body.code ?? "REQUEST_FAILED");
    setData(body.data);
  }, [workspaceId]);

  useEffect(() => { void load().catch(() => setError("REQUEST_FAILED")); }, [load]);

  async function mutate(catalogId: string, action: "add" | "archive") {
    setBusyId(catalogId); setError("");
    try {
      const response = await fetch("/api/product-themes", { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify({ action, catalogId }) });
      const body = await response.json() as { success?: boolean; code?: string };
      if (!response.ok || !body.success) throw new Error(body.code ?? "REQUEST_FAILED");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "REQUEST_FAILED"); }
    finally { setBusyId(""); }
  }

  const themes = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().normalize("NFKC").toLocaleLowerCase(locale);
    return data.themes.filter((theme) => (!activeOnly || theme.active) && (!normalized || `${theme.authoredName[locale]} ${theme.authoredDescription[locale]}`.normalize("NFKC").toLocaleLowerCase(locale).includes(normalized)));
  }, [activeOnly, data, locale, query]);
  const errorText = t(`errors.${["CONTENT_THEME_LIMIT_REACHED", "CONTENT_THEME_NOT_FOUND", "CONTENT_THEME_NOT_ACTIVE"].includes(error) ? error : "REQUEST_FAILED"}`);

  if (!data) return <div lang={locale} dir={getDirection(locale)} className="p-6">{error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{errorText}</p><button onClick={() => void load().catch(() => undefined)} className="min-h-10 rounded-lg border px-4 text-sm font-semibold">{t("retry")}</button></div> : <LoaderCircle className="size-5 animate-spin" aria-label={t("loading")} />}</div>;

  return <div lang={locale} dir={getDirection(locale)} className="space-y-7 p-5 sm:p-8">
    <header><h2 className="text-2xl font-semibold">{t("title")}</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p></header>
    <section className="rounded-2xl border p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">{t("themes.title")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("themes.description")}</p></div><strong className="tabular-nums">{t("themes.usage", { current: data.activeThemeCount, limit: data.themeLimit })}</strong></div><div className="mt-4 flex flex-wrap gap-2"><label className="flex min-h-11 min-w-56 flex-1 items-center gap-2 rounded-xl border px-3"><Search className="size-4 text-muted-foreground" /><span className="sr-only">{t("search")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} className="min-w-0 flex-1 bg-transparent outline-none" /></label><button aria-pressed={activeOnly} onClick={() => setActiveOnly((value) => !value)} className="min-h-11 rounded-xl border px-4 text-sm font-semibold aria-pressed:bg-muted">{t("activeOnly")}</button></div></section>
    {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorText}</p> : null}
    <section className="grid gap-4 lg:grid-cols-2">{themes.map((theme) => <article key={theme.catalogId} className={`rounded-2xl border p-5 ${theme.active ? "border-emerald-500/50" : ""}`}><div className="flex items-start justify-between gap-3"><div><h3 dir="auto" className="font-semibold">{theme.authoredName[locale]}</h3><p className="mt-1 text-sm text-muted-foreground">{theme.authoredDescription[locale]}</p></div>{theme.active ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800"><Check className="size-3" />{t("active")}</span> : null}</div><div className="mt-4 flex gap-1" aria-label={t("palette")} dir="ltr">{theme.palette.map((color) => <span key={color} className="h-8 flex-1 rounded-md border" style={{ backgroundColor: color }} title={color} />)}</div><p className="mt-3 text-xs text-muted-foreground">{theme.culturalNote[locale]}</p><p className="mt-2 flex min-w-0 items-baseline gap-1 text-[10px] text-muted-foreground" title={theme.digest}><span>{t("revision", { revision: theme.revision })}</span><span aria-hidden="true">·</span><bdi dir="ltr" className="truncate font-mono">{theme.digest}</bdi></p>{canManage ? <button disabled={Boolean(busyId)} onClick={() => void mutate(theme.catalogId, theme.active ? "archive" : "add")} className={`mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50 ${theme.active ? "text-destructive" : ""}`}>{busyId === theme.catalogId ? <LoaderCircle className="size-4 animate-spin" /> : theme.active ? <Trash2 className="size-4" /> : <Plus className="size-4" />}{theme.active ? t("remove") : t("add")}</button> : null}</article>)}</section>
    {themes.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("empty")}</p> : null}
    <section className="rounded-2xl border p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold">{t("sets.title")}</h3><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("sets.description")}</p></div><Link href="/library?tab=media" className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"><FolderOpen className="size-4" />{t("sets.manage")}</Link></div>{data.mediaSets.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{data.mediaSets.map((set) => <div key={set.id} className="rounded-xl border p-3"><p dir="auto" className="font-medium">{set.title}</p><p className="mt-1 text-xs text-muted-foreground">{t(`sets.purposes.${set.purpose}`)} · {t("sets.assets", { count: set.assetCount })} · {t("revision", { revision: set.revision })}</p></div>)}</div> : <p className="mt-4 text-sm text-muted-foreground">{t("sets.empty")}</p>}</section>
    <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("license.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("license.description")}</p><p className="mt-3 text-xs text-muted-foreground">{t("license.boundary")}</p></section>
  </div>;
}
