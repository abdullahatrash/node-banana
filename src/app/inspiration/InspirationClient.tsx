"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BookmarkPlus, ExternalLink, Filter, LoaderCircle, Plus, RefreshCw, Search, Sparkles } from "lucide-react";
import { CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";
import { productRequest } from "@/components/product-surfaces/ProductApi";

type Payload = Record<string, unknown> & {
  metrics?: { views?: number; likes?: number };
  whyThisAppears?: string[];
  tags?: string[];
  trendEvidence?: { source?: { sourceKind?: string } } | null;
};
export type InspirationDiscoveryItem = {
  id: string; title: string; revision: number; state: string; payload: Payload;
  score: number | null; freshness: "live" | "recent" | "aging" | null;
  metricsObservedAt: string; sourcePublishedAt: string | null;
  eligibleForBlitz: boolean; origin: "trend" | "manual";
};

const REASON_CODES = new Set(["fresh_metrics", "stale_metrics", "recent_source", "strong_performance", "brand_topic_match", "mena_region_match", "mena_region_relevant", "content_language_match", "arabic_variety_match", "preferred_format", "licensed_rights", "user_submitted_rights", "embeddable_rights", "metadata_only_rights", "rights_restricted", "explicit_preference_excluded", "explicit_preference_match", "rights_expired"]);

export function InspirationClient({ items }: { items: InspirationDiscoveryItem[] }) {
  const t = useTranslations("product.inspiration") as (key: string, values?: Record<string, string | number>) => string;
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [format, setFormat] = useState("");
  const [region, setRegion] = useState("");
  const [blitzOnly, setBlitzOnly] = useState(false);
  const regions = useMemo(() => [...new Set(items.map((item) => String(item.payload.region ?? "")).filter(Boolean))].sort(), [items]);
  const visible = useMemo(() => {
    const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase("und");
    return items.filter((item) => {
      const searchable = [item.title, item.payload.sourceName, item.payload.region, ...(item.payload.tags ?? [])].join(" ").normalize("NFKC").toLocaleLowerCase("und");
      return (!normalizedQuery || searchable.includes(normalizedQuery))
        && (!language || item.payload.contentLanguage === language)
        && (!format || item.payload.format === format)
        && (!region || item.payload.region === region)
        && (!blitzOnly || item.eligibleForBlitz);
    });
  }, [items, query, language, format, region, blitzOnly]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const data = new FormData(event.currentTarget);
    try {
      const contentLanguage = String(data.get("language")) as "ar" | "en";
      await productRequest("/api/product-inspiration", { action: "submit", title: String(data.get("title")), sourceName: String(data.get("sourceName")), sourceAssetId: String(data.get("sourceAssetId")), rightsSnapshotId: String(data.get("rightsSnapshotId")), region: String(data.get("region")), contentLanguage, arabicVariety: null, format: String(data.get("format")), tags: String(data.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean), idempotencyKey: crypto.randomUUID() });
      event.currentTarget.reset(); router.refresh();
    } catch { setError(t("error")); } finally { setBusy(false); }
  }
  async function queue(item: InspirationDiscoveryItem) {
    setBusy(true); setError(""); setNotice("");
    try { await productRequest("/api/product-inspiration", { action: "queue", inspirationItemId: item.id, idempotencyKey: crypto.randomUUID() }); router.push("/blitz"); }
    catch { setError(t("error")); } finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await productRequest("/api/product-inspiration", { action: "refresh", idempotencyKey: crypto.randomUUID() });
      const result = response.result as { scheduled?: number } | undefined;
      setNotice(result?.scheduled ? t("refreshQueued", { count: result.scheduled }) : t("noSources"));
      router.refresh();
    } catch { setError(t("error")); } finally { setBusy(false); }
  }

  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return <div className="space-y-7">
    <section className="rounded-3xl border bg-card p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div><div className="flex items-center gap-2"><Sparkles className="size-5 text-amber-600" /><h2 className="text-xl font-semibold">{t("discoveryTitle")}</h2></div><p className="mt-1 text-sm text-muted-foreground">{t("discoveryDescription")}</p></div><button type="button" onClick={refresh} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />{t("refresh")}</button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><label className="relative xl:col-span-2"><span className="sr-only">{t("filters.search")}</span><Search className="absolute start-3 top-3.5 size-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filters.search")} className="min-h-11 w-full rounded-xl border bg-background ps-10 pe-3" /></label><Select label={t("filters.language")} value={language} onChange={setLanguage} options={[{ value: "ar", label: t("languages.ar") }, { value: "en", label: t("languages.en") }]} all={t("filters.anyLanguage")} /><Select label={t("filters.region")} value={region} onChange={setRegion} options={regions.map((value) => ({ value, label: value }))} all={t("allRegions")} /><Select label={t("filters.format")} value={format} onChange={setFormat} options={CONTENT_FORMATS.map((value) => ({ value, label: t(`formats.${value}`) }))} all={t("filters.anyFormat")} /></div>
      <label className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={blitzOnly} onChange={(event) => setBlitzOnly(event.target.checked)} className="size-4 accent-amber-500" /><Filter className="size-4" />{t("filters.blitzReady")}</label>
      {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>

    <section aria-label={t("feedLabel")} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {visible.map((item) => <article key={item.id} className="flex flex-col overflow-hidden rounded-2xl border bg-card"><div className="border-b bg-gradient-to-br from-amber-50 to-orange-50 p-5 dark:from-amber-950/20 dark:to-orange-950/10"><div className="flex items-center justify-between gap-3"><span className="rounded-full border bg-background/80 px-2.5 py-1 text-xs font-medium">{item.origin === "trend" ? t("trend") : t("manual")}</span>{item.score !== null && <span className="text-sm font-semibold text-amber-700">{t("score", { score: Math.round(item.score / 100) })}</span>}</div><h2 dir="auto" className="mt-4 text-lg font-semibold leading-snug">{item.title}</h2><p dir="auto" className="mt-2 text-sm text-muted-foreground">{String(item.payload.sourceName)} · {String(item.payload.region || t("allRegions"))}</p></div><div className="flex flex-1 flex-col p-5"><div className="flex flex-wrap gap-2"><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t(`rights.${String(item.payload.rightsStatus)}`)}</span>{item.freshness && <span className="rounded-full bg-muted px-2 py-1 text-xs">{t(`freshness.${item.freshness}`)}</span>}<span className="rounded-full bg-muted px-2 py-1 text-xs">{t(`formats.${String(item.payload.format)}`)}</span>{item.payload.trendEvidence?.source?.sourceKind && <span className="rounded-full bg-muted px-2 py-1 text-xs">{t(`sourceKinds.${item.payload.trendEvidence.source.sourceKind}`)}</span>}</div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><Metric label={t("metrics.views")} value={Number(item.payload.metrics?.views ?? 0).toLocaleString(locale)} /><Metric label={t("metrics.likes")} value={Number(item.payload.metrics?.likes ?? 0).toLocaleString(locale)} /></dl><p className="mt-3 text-xs text-muted-foreground">{t("observedAt", { date: formatter.format(new Date(item.metricsObservedAt)) })}</p>{item.sourcePublishedAt && <p className="mt-1 text-xs text-muted-foreground">{t("publishedAt", { date: formatter.format(new Date(item.sourcePublishedAt)) })}</p>}<div className="mt-4 flex flex-wrap gap-2">{(item.payload.whyThisAppears ?? []).slice(0, 4).map((reason) => <span key={reason} className="rounded-lg border px-2 py-1 text-xs">{item.origin === "trend" && REASON_CODES.has(reason) ? t(`reasons.${reason}`) : reason}</span>)}</div><div className="mt-auto flex gap-3 pt-6"><a href={String(item.payload.sourceUrl)} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><ExternalLink className="size-4" />{t("source")}</a><button onClick={() => queue(item)} disabled={busy || !item.eligibleForBlitz} title={!item.eligibleForBlitz ? t("blitzUnavailable") : undefined} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-stone-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><BookmarkPlus className="size-4" />{t("queue")}</button></div>{!item.eligibleForBlitz && <p className="mt-2 text-xs text-muted-foreground">{t("blitzUnavailable")}</p>}</div></article>)}
      {visible.length === 0 && <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground md:col-span-2 xl:col-span-3">{items.length ? t("noMatches") : t("empty")}</p>}
    </section>

    <details className="rounded-3xl border bg-card" open={items.length === 0 ? true : undefined}><summary className="cursor-pointer list-none p-6 text-xl font-semibold">{t("addTitle")}</summary><form onSubmit={submit} className="grid gap-4 border-t p-6 md:grid-cols-2"><Input name="title" label={t("fields.title")} /><Input name="sourceAssetId" label={t("fields.sourceAssetId")} /><Input name="rightsSnapshotId" label={t("fields.rightsSnapshotId")} /><Input name="sourceName" label={t("fields.source")} /><Input name="region" label={t("fields.region")} /><label className="grid gap-2 text-sm font-medium">{t("fields.format")}<select name="format" className="min-h-11 rounded-xl border bg-background px-3">{CONTENT_FORMATS.map((value) => <option value={value} key={value}>{t(`formats.${value}`)}</option>)}</select></label><label className="grid gap-2 text-sm font-medium">{t("fields.language")}<select name="language" className="min-h-11 rounded-xl border bg-background px-3"><option value="ar">{t("languages.ar")}</option><option value="en">{t("languages.en")}</option></select></label><Input name="tags" label={t("fields.tags")} required={false} /><button disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-xl bg-amber-300 px-4 font-semibold text-stone-950 disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("add")}</button></form></details>
  </div>;
}

function Input({ name, label, required = true }: { name: string; label: string; required?: boolean }) { return <label className="grid gap-2 text-sm font-medium">{label}<input dir="auto" name={name} required={required} className="min-h-11 rounded-xl border bg-background px-3 font-normal" /></label>; }
function Select({ label, value, onChange, options, all }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; all: string }) { return <label className="grid gap-1 text-xs font-medium text-muted-foreground"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 rounded-xl border bg-background px-3 text-sm text-foreground"><option value="">{all}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>; }
