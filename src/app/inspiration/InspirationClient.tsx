"use client";

import { createContext, useContext, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BookmarkPlus, ExternalLink, Filter, LoaderCircle, Pause, Play, Plus, RefreshCw, Search, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";
import { productRequest } from "@/components/product-surfaces/ProductApi";
import type { WorkspaceOwnedPerformanceSource } from "@/lib/product-surfaces/workspace-owned-trend-adapter";

type Payload = Record<string, unknown> & {
  metrics?: { views?: number | null; likes?: number | null; comments?: number | null };
  whyThisAppears?: string[];
  tags?: string[];
  trendEvidence?: { source?: { sourceKind?: string; observationProvenance?: { kind?: string } | null } } | null;
};
export type InspirationDiscoveryItem = {
  id: string; title: string; revision: number; state: string; payload: Payload;
  score: number | null; freshness: "live" | "recent" | "aging" | null;
  metricsObservedAt: string; sourcePublishedAt: string | null;
  eligibleForBlitz: boolean; origin: "trend" | "manual";
};

const REASON_CODES = new Set(["fresh_metrics", "stale_metrics", "recent_source", "strong_performance", "brand_topic_match", "mena_region_match", "mena_region_relevant", "content_language_match", "arabic_variety_match", "preferred_format", "licensed_rights", "user_submitted_rights", "embeddable_rights", "metadata_only_rights", "rights_restricted", "explicit_preference_excluded", "explicit_preference_match", "rights_expired"]);
const InspirationDefaultsContext = createContext<{ contentLanguage: "ar" | "en"; contentMarket: string }>({ contentLanguage: "ar", contentMarket: "" });

export function InspirationClient({ items, performanceSources = [], defaultContentLanguage = "ar", defaultContentMarket = "" }: { items: InspirationDiscoveryItem[]; performanceSources?: WorkspaceOwnedPerformanceSource[]; defaultContentLanguage?: "ar" | "en"; defaultContentMarket?: string }) {
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
  async function recordPerformance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const data = new FormData(event.currentTarget);
    const source = performanceSources.find((candidate) => candidate.id === String(data.get("performanceSource")));
    try {
      if (!source) throw new Error("PERFORMANCE_SOURCE_REQUIRED");
      const language = String(data.get("performanceLanguage")) as "ar" | "en";
      const variety = String(data.get("performanceArabicVariety"));
      await productRequest("/api/product-inspiration/performance", {
        postId: source.postId, sourceAssetId: source.sourceAssetId, rightsSnapshot: source.rightsSnapshot,
        sourceRef: String(data.get("performanceSourceRef")), metrics: { views: Number(data.get("performanceViews")), likes: Number(data.get("performanceLikes")), comments: Number(data.get("performanceComments") || 0) },
        observedAt: new Date(String(data.get("performanceObservedAt"))).toISOString(), region: String(data.get("performanceRegion")), contentLanguage: language,
        arabicVariety: language === "ar" && variety ? variety : null, format: String(data.get("performanceFormat")),
        tags: String(data.get("performanceTags")).split(",").map((tag) => tag.trim()).filter(Boolean), idempotencyKey: crypto.randomUUID(),
      });
      const refreshResponse = await productRequest("/api/product-inspiration", { action: "refresh", idempotencyKey: crypto.randomUUID() });
      const result = refreshResponse.result as { scheduled?: number } | undefined;
      setNotice(t("performance.recorded", { count: result?.scheduled ?? 0 }));
      event.currentTarget.reset(); router.refresh();
    } catch { setError(t("performance.error")); } finally { setBusy(false); }
  }
  async function configureVerifiedSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const data = new FormData(event.currentTarget);
    const source = performanceSources.find((candidate) => candidate.id === String(data.get("syncSource")));
    try {
      if (!source?.verifiedSyncSupported || source.requiresReauth) throw new Error("PERFORMANCE_SYNC_SOURCE_REQUIRED");
      const contentLanguage = String(data.get("syncLanguage")) as "ar" | "en";
      const variety = String(data.get("syncArabicVariety"));
      await productRequest("/api/product-inspiration/performance/syncs", { action: "enable", postId: source.postId, sourceAssetId: source.sourceAssetId, rightsSnapshot: source.rightsSnapshot, scheduleMinutes: Number(data.get("syncScheduleMinutes")), region: String(data.get("syncRegion")), contentLanguage, arabicVariety: contentLanguage === "ar" && variety ? variety : null, format: String(data.get("syncFormat")), tags: String(data.get("syncTags")).split(",").map((tag) => tag.trim()).filter(Boolean) });
      setNotice(t("performance.sync.saved")); router.refresh();
    } catch { setError(t("performance.sync.error")); } finally { setBusy(false); }
  }
  async function updateVerifiedSync(syncId: string, action: "pause" | "resume" | "run_now") {
    setBusy(true); setError(""); setNotice("");
    try { await productRequest("/api/product-inspiration/performance/syncs", { action, syncId }); setNotice(t(`performance.sync.${action === "run_now" ? "queued" : action === "pause" ? "paused" : "resumed"}`)); router.refresh(); }
    catch { setError(t("performance.sync.error")); } finally { setBusy(false); }
  }

  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return <InspirationDefaultsContext.Provider value={{ contentLanguage: defaultContentLanguage, contentMarket: defaultContentMarket }}><div className="space-y-7">
    <section className="rounded-3xl border bg-card p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div><div className="flex items-center gap-2"><Sparkles className="size-5 text-amber-600" /><h2 className="text-xl font-semibold">{t("discoveryTitle")}</h2></div><p className="mt-1 text-sm text-muted-foreground">{t("discoveryDescription")}</p></div><button type="button" onClick={refresh} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />{t("refresh")}</button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><label className="relative xl:col-span-2"><span className="sr-only">{t("filters.search")}</span><Search className="absolute start-3 top-3.5 size-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filters.search")} className="min-h-11 w-full rounded-xl border bg-background ps-10 pe-3" /></label><Select label={t("filters.language")} value={language} onChange={setLanguage} options={[{ value: "ar", label: t("languages.ar") }, { value: "en", label: t("languages.en") }]} all={t("filters.anyLanguage")} /><Select label={t("filters.region")} value={region} onChange={setRegion} options={regions.map((value) => ({ value, label: value }))} all={t("allRegions")} /><Select label={t("filters.format")} value={format} onChange={setFormat} options={CONTENT_FORMATS.map((value) => ({ value, label: t(`formats.${value}`) }))} all={t("filters.anyFormat")} /></div>
      <label className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={blitzOnly} onChange={(event) => setBlitzOnly(event.target.checked)} className="size-4 accent-amber-500" /><Filter className="size-4" />{t("filters.blitzReady")}</label>
      {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>

    <section aria-label={t("feedLabel")} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {visible.map((item) => <article key={item.id} className="flex flex-col overflow-hidden rounded-2xl border bg-card"><div className="border-b bg-gradient-to-br from-amber-50 to-orange-50 p-5 dark:from-amber-950/20 dark:to-orange-950/10"><div className="flex items-center justify-between gap-3"><span className="rounded-full border bg-background/80 px-2.5 py-1 text-xs font-medium">{item.origin === "trend" ? t("trend") : t("manual")}</span>{item.score !== null && <span className="text-sm font-semibold text-amber-700">{t("score", { score: Math.round(item.score / 100) })}</span>}</div><h2 dir="auto" className="mt-4 text-lg font-semibold leading-snug">{item.title}</h2><p dir="auto" className="mt-2 text-sm text-muted-foreground">{String(item.payload.sourceName)} · {String(item.payload.region || t("allRegions"))}</p></div><div className="flex flex-1 flex-col p-5"><div className="flex flex-wrap gap-2"><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t(`rights.${String(item.payload.rightsStatus)}`)}</span>{item.freshness && <span className="rounded-full bg-muted px-2 py-1 text-xs">{t(`freshness.${item.freshness}`)}</span>}<span className="rounded-full bg-muted px-2 py-1 text-xs">{t(`formats.${String(item.payload.format)}`)}</span>{item.payload.trendEvidence?.source?.sourceKind && <span className="rounded-full bg-muted px-2 py-1 text-xs">{t(`sourceKinds.${item.payload.trendEvidence.source.sourceKind}`)}</span>}{item.payload.trendEvidence?.source?.observationProvenance?.kind && <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-1 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-100"><ShieldCheck className="size-3" />{t(`performance.provenance.${item.payload.trendEvidence.source.observationProvenance.kind}`)}</span>}</div><dl className="mt-4 grid grid-cols-3 gap-3 text-sm"><Metric label={t("metrics.views")} value={formatMetric(item.payload.metrics?.views, locale)} /><Metric label={t("metrics.likes")} value={formatMetric(item.payload.metrics?.likes, locale)} /><Metric label={t("metrics.comments")} value={formatMetric(item.payload.metrics?.comments, locale)} /></dl><p className="mt-3 text-xs text-muted-foreground">{t("observedAt", { date: formatter.format(new Date(item.metricsObservedAt)) })}</p>{item.sourcePublishedAt && <p className="mt-1 text-xs text-muted-foreground">{t("publishedAt", { date: formatter.format(new Date(item.sourcePublishedAt)) })}</p>}<div className="mt-4 flex flex-wrap gap-2">{(item.payload.whyThisAppears ?? []).slice(0, 4).map((reason) => <span key={reason} className="rounded-lg border px-2 py-1 text-xs">{item.origin === "trend" && REASON_CODES.has(reason) ? t(`reasons.${reason}`) : reason}</span>)}</div><div className="mt-auto flex gap-3 pt-6"><a href={String(item.payload.sourceUrl)} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><ExternalLink className="size-4" />{t("source")}</a><button onClick={() => queue(item)} disabled={busy || !item.eligibleForBlitz} title={!item.eligibleForBlitz ? t("blitzUnavailable") : undefined} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-stone-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><BookmarkPlus className="size-4" />{t("queue")}</button></div>{!item.eligibleForBlitz && <p className="mt-2 text-xs text-muted-foreground">{t("blitzUnavailable")}</p>}</div></article>)}
      {visible.length === 0 && <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground md:col-span-2 xl:col-span-3">{items.length ? t("noMatches") : t("empty")}</p>}
    </section>

    <details className="rounded-3xl border bg-card" open={performanceSources.length > 0 && items.length === 0 ? true : undefined}><summary className="cursor-pointer list-none p-6 text-xl font-semibold"><span className="inline-flex items-center gap-2"><TrendingUp className="size-5 text-amber-600" />{t("performance.title")}</span></summary><div className="space-y-8 border-t p-6"><p className="text-sm text-muted-foreground">{performanceSources.length ? t("performance.description") : t("performance.empty")}</p>{performanceSources.some((source) => source.verifiedSyncSupported) && <section><div className="mb-4"><h3 className="inline-flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-sky-600" />{t("performance.sync.title")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("performance.sync.description")}</p></div><form onSubmit={configureVerifiedSync} className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium md:col-span-2">{t("performance.fields.post")}<select name="syncSource" required className="min-h-11 rounded-xl border bg-background px-3"><option value="">{t("performance.selectPost")}</option>{performanceSources.filter((source) => source.verifiedSyncSupported).map((source) => <option key={source.id} value={source.id} disabled={source.requiresReauth}>{source.title} · {source.channel}{source.requiresReauth ? ` · ${t("performance.sync.reauth")}` : ""}</option>)}</select></label><Input name="syncRegion" label={t("performance.fields.region")} /><LanguageAndVariety prefix="sync" t={t} /><FormatField name="syncFormat" t={t} /><Input name="syncTags" label={t("performance.fields.tags")} required={false} /><label className="grid gap-2 text-sm font-medium">{t("performance.sync.interval")}<select name="syncScheduleMinutes" defaultValue="60" className="min-h-11 rounded-xl border bg-background px-3"><option value="60">{t("performance.sync.hourly")}</option><option value="360">{t("performance.sync.sixHours")}</option><option value="1440">{t("performance.sync.daily")}</option></select></label><button disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-xl bg-sky-600 px-4 font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{t("performance.sync.enable")}</button></form><div className="mt-4 space-y-2">{performanceSources.filter((source) => source.sync).map((source) => <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"><div><p dir="auto" className="font-medium">{source.title}</p><p className="text-muted-foreground">{t(`performance.sync.states.${source.sync!.state}`)}{source.sync!.lastObservedAt ? ` · ${formatter.format(new Date(source.sync!.lastObservedAt))}` : ""}</p></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => updateVerifiedSync(source.sync!.id, source.sync!.state === "active" ? "pause" : "resume")} className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-3">{source.sync!.state === "active" ? <Pause className="size-3" /> : <Play className="size-3" />}{t(source.sync!.state === "active" ? "performance.sync.pause" : "performance.sync.resume")}</button><button type="button" disabled={busy || source.sync!.state !== "active"} onClick={() => updateVerifiedSync(source.sync!.id, "run_now")} className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-3"><RefreshCw className="size-3" />{t("performance.sync.runNow")}</button></div></div>)}</div></section>}{performanceSources.length > 0 && <section className="border-t pt-7"><h3 className="mb-1 font-semibold">{t("performance.manual.title")}</h3><p className="mb-4 text-sm text-muted-foreground">{t("performance.manual.description")}</p><form onSubmit={recordPerformance} className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium md:col-span-2">{t("performance.fields.post")}<select name="performanceSource" required className="min-h-11 rounded-xl border bg-background px-3"><option value="">{t("performance.selectPost")}</option>{performanceSources.map((source) => <option key={source.id} value={source.id}>{source.title} · {source.channel}</option>)}</select></label><Input name="performanceSourceRef" label={t("performance.fields.sourceRef")} /><Input name="performanceObservedAt" label={t("performance.fields.observedAt")} type="datetime-local" /><Input name="performanceViews" label={t("performance.fields.views")} type="number" min="0" /><Input name="performanceLikes" label={t("performance.fields.likes")} type="number" min="0" /><Input name="performanceComments" label={t("performance.fields.comments")} type="number" min="0" required={false} /><Input name="performanceRegion" label={t("performance.fields.region")} /><LanguageAndVariety prefix="performance" t={t} /><FormatField name="performanceFormat" t={t} /><Input name="performanceTags" label={t("performance.fields.tags")} required={false} /><button disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-xl bg-amber-300 px-4 font-semibold text-stone-950 disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <TrendingUp className="size-4" />}{t("performance.submit")}</button></form></section>}</div></details>

    <details className="rounded-3xl border bg-card" open={items.length === 0 ? true : undefined}>
      <summary className="cursor-pointer list-none p-6 text-xl font-semibold">{t("addTitle")}</summary>
      <form onSubmit={submit} className="grid gap-4 border-t p-6 md:grid-cols-2">
        <Input name="title" label={t("fields.title")} />
        <Input name="sourceAssetId" label={t("fields.sourceAssetId")} />
        <Input name="rightsSnapshotId" label={t("fields.rightsSnapshotId")} />
        <Input name="sourceName" label={t("fields.source")} />
        <Input name="region" label={t("fields.region")} />
        <label className="grid gap-2 text-sm font-medium">{t("fields.format")}<select name="format" className="min-h-11 rounded-xl border bg-background px-3">{CONTENT_FORMATS.map((value) => <option value={value} key={value}>{t(`formats.${value}`)}</option>)}</select></label>
        <label className="grid gap-2 text-sm font-medium">{t("fields.language")}<select name="language" defaultValue={defaultContentLanguage} className="min-h-11 rounded-xl border bg-background px-3"><option value="ar">{t("languages.ar")}</option><option value="en">{t("languages.en")}</option></select></label>
        <Input name="tags" label={t("fields.tags")} required={false} />
        <button disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-xl bg-amber-300 px-4 font-semibold text-stone-950 disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("add")}</button>
      </form>
    </details>
  </div></InspirationDefaultsContext.Provider>;
}

function Input({ name, label, required = true, type = "text", min, defaultValue }: { name: string; label: string; required?: boolean; type?: string; min?: string; defaultValue?: string }) { const defaults = useContext(InspirationDefaultsContext); const resolvedDefault = defaultValue ?? (["region", "syncRegion", "performanceRegion"].includes(name) ? defaults.contentMarket : undefined); return <label className="grid gap-2 text-sm font-medium">{label}<input dir={type === "number" || type === "datetime-local" ? "ltr" : "auto"} name={name} type={type} min={min} step={type === "number" ? "1" : undefined} required={required} defaultValue={resolvedDefault} className="min-h-11 rounded-xl border bg-background px-3 font-normal" /></label>; }
function Select({ label, value, onChange, options, all }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; all: string }) { return <label className="grid gap-1 text-xs font-medium text-muted-foreground"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 rounded-xl border bg-background px-3 text-sm text-foreground"><option value="">{all}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>; }
function formatMetric(value: number | null | undefined, locale: string) { return value === null || value === undefined ? "—" : value.toLocaleString(locale); }
function LanguageAndVariety({ prefix, t }: { prefix: "sync" | "performance"; t: (key: string) => string }) { const defaults = useContext(InspirationDefaultsContext); return <><label className="grid gap-2 text-sm font-medium">{t("performance.fields.language")}<select name={`${prefix}Language`} defaultValue={defaults.contentLanguage} className="min-h-11 rounded-xl border bg-background px-3"><option value="ar">{t("languages.ar")}</option><option value="en">{t("languages.en")}</option></select></label><label className="grid gap-2 text-sm font-medium">{t("performance.fields.variety")}<select name={`${prefix}ArabicVariety`} className="min-h-11 rounded-xl border bg-background px-3"><option value="">{t("performance.noVariety")}</option>{ARABIC_VARIETIES.map((value) => <option key={value} value={value}>{t(`performance.varieties.${value}`)}</option>)}</select></label></>; }
function FormatField({ name, t }: { name: string; t: (key: string) => string }) { return <label className="grid gap-2 text-sm font-medium">{t("performance.fields.format")}<select name={name} className="min-h-11 rounded-xl border bg-background px-3">{CONTENT_FORMATS.map((value) => <option value={value} key={value}>{t(`formats.${value}`)}</option>)}</select></label>; }
