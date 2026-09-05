"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, ExternalLink, Languages, LibraryBig, LoaderCircle, ShieldCheck } from "lucide-react";
import { productRequest } from "@/components/product-surfaces/ProductApi";
import type { LicensedTrendCatalogCard } from "@/lib/product-surfaces/licensed-trend-types";

export function LicensedTrendCatalog({ items }: { items: LicensedTrendCatalogCard[] }) {
  const t = useTranslations("product.inspiration.licensedCatalog") as (key: string, values?: Record<string, string | number>) => string;
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [variety, setVariety] = useState("");
  const [region, setRegion] = useState("");
  const regions = useMemo(() => [...new Set(items.map((item) => item.document.classification.region))].sort(), [items]);
  const varieties = useMemo(() => [...new Set(items.flatMap((item) => item.document.classification.arabicVariety ? [item.document.classification.arabicVariety] : []))].sort(), [items]);
  const visible = useMemo(() => {
    const normalized = query.normalize("NFKC").toLocaleLowerCase("und");
    return items.filter((item) => {
      const document = item.document;
      const searchable = [document.title, document.sourceName, ...document.classification.tags, ...document.classification.creativePrimitives.topics].join(" ").normalize("NFKC").toLocaleLowerCase("und");
      return (!normalized || searchable.includes(normalized)) && (!language || document.classification.contentLanguage === language) && (!variety || document.classification.arabicVariety === variety) && (!region || document.classification.region === region);
    });
  }, [items, query, language, variety, region]);

  async function importItem(item: LicensedTrendCatalogCard) {
    setBusy(item.entitlementId); setError(""); setNotice("");
    try {
      await productRequest("/api/product-inspiration/licensed-catalog", item.state === "failed" && item.importJobId ? { action: "retry", jobId: item.importJobId } : { action: "import", entitlementId: item.entitlementId, idempotencyKey: crypto.randomUUID() });
      setNotice(t("importQueued"));
      router.refresh();
    } catch { setError(t("error")); } finally { setBusy(null); }
  }

  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return <section className="min-w-0 rounded-3xl border bg-card p-5 sm:p-6 [&_input]:min-w-0 [&_select]:min-w-0 [&_select]:w-full">
    <div className="flex items-start gap-3"><div className="rounded-xl bg-emerald-100 p-2 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><LibraryBig className="size-5" /></div><div><h2 className="text-xl font-semibold">{t("title")}</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("description")}</p><p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"><ShieldCheck className="size-3.5" />{t("noCreditCharge")}</p></div></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input dir="auto" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} className="min-h-11 rounded-xl border bg-background px-3"/><CatalogSelect value={language} setValue={(value) => { setLanguage(value); if (value !== "ar") setVariety(""); }} all={t("anyLanguage")} options={[{ value: "ar", label: t("arabic") }, { value: "en", label: t("english") }]} /><CatalogSelect value={variety} setValue={setVariety} all={t("anyVariety")} disabled={language !== "ar"} options={varieties.map((value) => ({ value, label: t(`varieties.${value}`) }))}/><CatalogSelect value={region} setValue={setRegion} all={t("anyRegion")} options={regions.map((value) => ({ value, label: value }))}/></div>
    {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {visible.map((item) => {
        const document = item.document;
        return <article key={`${item.catalogId}:${item.revision}`} className="flex flex-col overflow-hidden rounded-2xl border">
          <div className="relative aspect-[9/16] max-h-80 w-full bg-stone-950">{document.media.type === "video" ? <video src={item.previewUrl} controls preload="metadata" className="size-full object-cover" aria-label={document.title} /> : <Image src={item.previewUrl} alt={document.title} fill unoptimized className="object-cover" />}</div>
          <div className="flex flex-1 flex-col p-4"><div className="flex items-center justify-between gap-3"><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t("licensed")}</span><span className="text-xs text-muted-foreground">{document.classification.region}</span></div><h3 dir="auto" className="mt-3 font-semibold">{document.title}</h3><p dir="auto" className="mt-1 text-sm text-muted-foreground">{document.sourceName} · {date.format(new Date(document.publishedAt))}</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1"><Languages className="size-3" />{document.classification.contentLanguage === "ar" ? t("arabic") : t("english")}{document.classification.arabicVariety ? ` · ${t(`varieties.${document.classification.arabicVariety}`)}` : ""}</span><span className="rounded-lg bg-muted px-2 py-1">{document.classification.format}</span></div><p dir="auto" className="mt-3 line-clamp-2 text-sm">{document.classification.creativePrimitives.hookPattern ?? document.classification.creativePrimitives.topics.join(" · ")}</p><div className="mt-auto flex gap-2 pt-5"><a href={document.provider.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm"><ExternalLink className="size-4" />{t("source")}</a><button type="button" disabled={Boolean(busy) || (item.state !== "available" && item.state !== "failed")} onClick={() => importItem(item)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy === item.entitlementId ? <LoaderCircle className="size-4 animate-spin" /> : item.state === "imported" ? <CheckCircle2 className="size-4" /> : <Download className="size-4" />}{t(item.state === "failed" ? "retry" : item.state)}</button></div></div>
        </article>;
      })}
      {visible.length === 0 && <p className="rounded-2xl border border-dashed p-7 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">{items.length ? t("noMatches") : t("empty")}</p>}
    </div>
  </section>;
}

function CatalogSelect({ value, setValue, all, options, disabled = false }: { value: string; setValue: (value: string) => void; all: string; options: Array<{ value: string; label: string }>; disabled?: boolean }) {
  return <select value={value} disabled={disabled} aria-label={all} onChange={(event) => setValue(event.target.value)} className="min-h-11 rounded-xl border bg-background px-3 disabled:opacity-50"><option value="">{all}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}
