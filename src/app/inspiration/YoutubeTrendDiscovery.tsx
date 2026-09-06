"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BookmarkPlus, ExternalLink, LoaderCircle, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { productRequest } from "@/components/product-surfaces/ProductApi";
import { WORKSPACE_CONTENT_MARKETS, type WorkspaceContentMarket } from "@/lib/product-surfaces/workspace-preferences-contract";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";

type Capability = { configured: boolean; enabled: boolean; keyConfigured: boolean; disclosuresConfigured: boolean; contentAdaptationApproved: boolean; contentAdaptationConfigured: boolean; privacyUrl: string | null; termsUrl: string | null };
type Source = { id: string; regionCode: string; categoryId: string; displayName: string; state: string; scheduleMinutes: number; pageSize: number; nextRunAt: string; lastRefreshedAt: string | null; lastErrorCode: string | null; estimatedDailyQuotaUnits: number };
type Entry = { sourceId: string; videoId: string; providerRank: number; title: string; channelTitle: string; sourceUrl: string; thumbnailUrl: string | null; publishedAt: string; viewCount: string | null; likeCount: string | null; commentCount: string | null; observedAt: string; expiresAt: string };
export type YoutubeTrendDiscoveryData = { capability: Capability; sources: Source[]; entries: Entry[] };

export function YoutubeTrendDiscovery({ data, defaultRegion, defaultContentLanguage }: { data: YoutubeTrendDiscoveryData; defaultRegion: WorkspaceContentMarket; defaultContentLanguage: "ar" | "en" }) {
  const t = useTranslations("product.inspiration.youtube") as (key: string, values?: Record<string, string | number>) => string;
  const tr = useTranslations("product.inspiration.youtubeRemix") as (key: string) => string;
  const tq = useTranslations("product.inspiration.youtubeQueue") as (key: string) => string;
  const tg = useTranslations("product.inspiration.youtubeAdaptationGate") as (key: string) => string;
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [contentLanguage, setContentLanguage] = useState<"ar" | "en">(defaultContentLanguage);
  const [arabicVariety, setArabicVariety] = useState("msa");
  const [format, setFormat] = useState("video_hook_demo");
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      await productRequest("/api/product-inspiration/youtube", { action: "enable", regionCode: String(form.get("regionCode")), categoryId: String(form.get("categoryId") || "0"), displayName: String(form.get("displayName")), scheduleMinutes: Number(form.get("scheduleMinutes")), pageSize: Number(form.get("pageSize")) });
      setNotice(t("sourceSaved")); router.refresh();
    } catch { setError(t("sourceError")); } finally { setBusy(false); }
  }

  async function update(sourceId: string, action: "pause" | "resume" | "run_now" | "remove") {
    if (action === "remove" && !window.confirm(t("removeConfirm"))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await productRequest("/api/product-inspiration/youtube", { action, sourceId });
      setNotice(t(action === "run_now" ? "queued" : action === "remove" ? "removed" : action === "pause" ? "paused" : "resumed")); router.refresh();
    } catch { setError(t("sourceError")); } finally { setBusy(false); }
  }

  async function queue(entry: Entry) {
    setBusy(true); setError(""); setNotice("");
    try {
      await productRequest("/api/product-inspiration/youtube/queue", { sourceId: entry.sourceId, videoId: entry.videoId, contentLanguage, arabicVariety: contentLanguage === "ar" ? arabicVariety : null, format, idempotencyKey: crypto.randomUUID() });
      setNotice(tq("queued")); router.push("/blitz");
    } catch { setError(tq("error")); } finally { setBusy(false); }
  }

  return <section className="min-w-0 rounded-3xl border bg-card p-5 sm:p-6 [&_input]:min-w-0 [&_select]:min-w-0 [&_select]:w-full" aria-labelledby="youtube-trends-title">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
      <div><div className="flex items-center gap-2"><YoutubeIcon /><h2 id="youtube-trends-title" className="text-xl font-semibold">{t("title")}</h2></div><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p><p className="mt-2 max-w-3xl text-xs text-muted-foreground">{data.capability.contentAdaptationApproved ? tr("separation") : t("separation")}</p></div>
      <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${data.capability.configured ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}>{t(data.capability.configured ? "configured" : "notConfigured")}</span>
    </div>

    {!data.capability.configured && <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">{t("setupTitle")}</p><ul className="mt-2 list-inside list-disc space-y-2"><SetupCheck message={t(data.capability.enabled ? "checks.switchReady" : "checks.switchMissing")} identifiers={data.capability.enabled ? [] : ["YOUTUBE_TREND_DISCOVERY_ENABLED=true"]} /><SetupCheck message={t(data.capability.keyConfigured ? "checks.keyReady" : "checks.keyMissing")} identifiers={data.capability.keyConfigured ? [] : ["YOUTUBE_DATA_API_KEY"]} /><SetupCheck message={t(data.capability.disclosuresConfigured ? "checks.legalReady" : "checks.legalMissing")} identifiers={data.capability.disclosuresConfigured ? [] : ["NEXT_PUBLIC_TERMS_URL", "NEXT_PUBLIC_PRIVACY_URL"]} /></ul></div>}
    {data.capability.configured && !data.capability.contentAdaptationApproved && <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">{tg("title")}</p><p className="mt-2">{tg("description")}</p><SetupCheck message={tg("action")} identifiers={["YOUTUBE_CONTENT_ADAPTATION_APPROVED=true"]} /></div>}

    {data.capability.configured && <form onSubmit={enable} className="mt-5 grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 xl:grid-cols-5"><label className="grid gap-1 text-sm font-medium">{t("fields.region")}<select name="regionCode" defaultValue={defaultRegion} className="min-h-11 rounded-xl border bg-background px-3">{WORKSPACE_CONTENT_MARKETS.map((region) => <option key={region} value={region}>{t(`regions.${region}`)}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">{t("fields.category")}<input name="categoryId" inputMode="numeric" defaultValue="0" pattern="0|[1-9][0-9]*" className="min-h-11 rounded-xl border bg-background px-3" dir="ltr" /></label><label className="grid gap-1 text-sm font-medium">{t("fields.name")}<input name="displayName" defaultValue={t("defaultName")} maxLength={200} required className="min-h-11 rounded-xl border bg-background px-3" dir="auto" /></label><label className="grid gap-1 text-sm font-medium">{t("fields.interval")}<select name="scheduleMinutes" defaultValue="360" className="min-h-11 rounded-xl border bg-background px-3"><option value="60">{t("intervals.hourly")}</option><option value="360">{t("intervals.sixHours")}</option><option value="720">{t("intervals.twelveHours")}</option><option value="1440">{t("intervals.daily")}</option></select></label><label className="grid gap-1 text-sm font-medium">{t("fields.results")}<select name="pageSize" defaultValue="25" className="min-h-11 rounded-xl border bg-background px-3"><option value="10">10</option><option value="25">25</option><option value="50">50</option></select></label><button disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2 xl:col-span-5">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <YoutubeIcon />}{t("enable")}</button></form>}

    {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

    {data.sources.length > 0 && <div className="mt-5 space-y-2">{data.sources.map((source) => <div key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"><div><p dir="auto" className="font-medium">{source.displayName} · {regionLabel(source.regionCode, t)}</p><p className="text-muted-foreground">{t(`states.${source.state}`)} · {t("quotaEstimate", { count: source.estimatedDailyQuotaUnits })}{source.lastRefreshedAt ? ` · ${t("refreshed", { date: formatter.format(new Date(source.lastRefreshedAt)) })}` : ""}</p>{source.lastErrorCode && <p className="text-xs text-destructive">{source.lastErrorCode}</p>}</div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || (source.state !== "active" && !data.capability.configured)} onClick={() => update(source.id, source.state === "active" ? "pause" : "resume")} className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-3">{source.state === "active" ? <Pause className="size-3" /> : <Play className="size-3" />}{t(source.state === "active" ? "pause" : "resume")}</button><button type="button" disabled={busy || source.state !== "active" || !data.capability.configured} onClick={() => update(source.id, "run_now")} className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-3"><RefreshCw className="size-3" />{t("refresh")}</button><button type="button" disabled={busy} onClick={() => update(source.id, "remove")} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-destructive/40 px-3 text-destructive"><Trash2 className="size-3" />{t("remove")}</button></div></div>)}</div>}

    {data.entries.length > 0 && data.capability.contentAdaptationApproved && <div className="mt-5 grid gap-3 rounded-2xl border bg-muted/30 p-4 sm:grid-cols-3"><label className="grid gap-1 text-sm font-medium">{tr("language")}<select value={contentLanguage} onChange={(event) => setContentLanguage(event.target.value as "ar" | "en")} className="min-h-11 rounded-xl border bg-background px-3"><option value="ar">{tr("languages.ar")}</option><option value="en">{tr("languages.en")}</option></select></label><label className="grid gap-1 text-sm font-medium">{tr("variety")}<select value={arabicVariety} onChange={(event) => setArabicVariety(event.target.value)} disabled={contentLanguage !== "ar"} className="min-h-11 rounded-xl border bg-background px-3 disabled:opacity-50">{ARABIC_VARIETIES.map((value) => <option key={value} value={value}>{tr(`varieties.${value}`)}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">{tr("format")}<select value={format} onChange={(event) => setFormat(event.target.value)} className="min-h-11 rounded-xl border bg-background px-3">{CONTENT_FORMATS.map((value) => <option key={value} value={value}>{tr(`formats.${value}`)}</option>)}</select></label><p className="text-xs text-muted-foreground sm:col-span-3">{tr("topicOnlyNotice")}</p></div>}

    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.entries.map((entry) => <article key={`${entry.sourceId}:${entry.videoId}`} className="overflow-hidden rounded-2xl border bg-background">{entry.thumbnailUrl && <>
      {/* Direct display is deliberate: YouTube thumbnails must remain unmodified and are not ingested or proxied into Workspace storage. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={entry.thumbnailUrl} alt="" className="aspect-video w-full bg-black object-contain" referrerPolicy="strict-origin-when-cross-origin" />
    </>}<div className="p-4"><div className="flex items-center justify-between gap-3"><a href={entry.sourceUrl} target="_blank" rel="noopener" aria-label={t("openOnYoutube")}><YoutubeIcon /></a><span className="text-xs font-semibold text-muted-foreground">#{entry.providerRank}</span></div><h3 dir="auto" className="mt-3 font-semibold leading-snug">{entry.title}</h3><p dir="auto" className="mt-1 text-sm text-muted-foreground">{entry.channelTitle}</p><dl className="mt-4 grid grid-cols-3 gap-2 text-sm"><Metric label={t("metrics.views")} value={formatCounter(entry.viewCount, locale)} /><Metric label={t("metrics.likes")} value={formatCounter(entry.likeCount, locale)} /><Metric label={t("metrics.comments")} value={formatCounter(entry.commentCount, locale)} /></dl><p className="mt-3 text-xs text-muted-foreground">{t("observed", { date: formatter.format(new Date(entry.observedAt)) })}</p><div className="mt-4 flex flex-wrap gap-2"><a href={entry.sourceUrl} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><ExternalLink className="size-4" />{t("openOnYoutube")}</a><button type="button" disabled={busy || !data.capability.contentAdaptationApproved} onClick={() => queue(entry)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-amber-300 px-3 text-sm font-semibold text-stone-950 disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <BookmarkPlus className="size-4" />}{tr("createOriginal")}</button></div></div></article>)}</div>
    {data.sources.length > 0 && data.entries.length === 0 && <p className="mt-5 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}

    <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 border-t pt-4 text-xs text-muted-foreground"><span>{t("legalNotice")}</span><a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener" className="underline">{t("youtubeTerms")}</a><a href="https://policies.google.com/privacy" target="_blank" rel="noopener" className="underline">{t("googlePrivacy")}</a>{data.capability.termsUrl && <a href={data.capability.termsUrl} target="_blank" rel="noopener" className="underline">{t("ourTerms")}</a>}{data.capability.privacyUrl && <a href={data.capability.privacyUrl} target="_blank" rel="noopener" className="underline">{t("ourPrivacy")}</a>}</div>
  </section>;
}

function YoutubeIcon() { return <span aria-hidden="true" className="inline-block h-[17px] w-6 shrink-0 bg-no-repeat" style={{ backgroundImage: "url(https://developers.google.com/static/youtube/images/youtube-icons-2x.png)", backgroundSize: "104px 142px", backgroundPosition: "-40px -14px" }} />; }
function SetupCheck({ message, identifiers }: { message: string; identifiers: string[] }) {
  const parts = identifiers.length > 0 ? message.split(new RegExp(`(${identifiers.join("|")})`, "u")) : [message];
  return <li>{parts.map((part, index) => identifiers.includes(part) ? <code dir="ltr" key={`${part}:${index}`} className="inline-block max-w-full [overflow-wrap:anywhere] align-baseline font-mono text-[.8em] font-semibold">{part}</code> : part)}</li>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums" dir="ltr">{value}</dd></div>; }
function formatCounter(value: string | null, locale: string) { if (value === null) return "—"; try { return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(BigInt(value)); } catch { return "—"; } }
function regionLabel(value: string, t: (key: string) => string) { return WORKSPACE_CONTENT_MARKETS.includes(value as WorkspaceContentMarket) ? t(`regions.${value}`) : value; }
