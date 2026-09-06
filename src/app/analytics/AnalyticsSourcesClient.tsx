"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Globe2, LoaderCircle, Radar } from "lucide-react";
import { productRequest } from "@/components/product-surfaces/ProductApi";

export function AnalyticsSourcesClient() {
  const t = useTranslations("product.analytics");
  const router = useRouter();
  const [busy, setBusy] = useState<"website" | "geo" | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>, kind: "website" | "geo") {
    event.preventDefault();
    setBusy(kind);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      if (kind === "website") {
        const hostname = String(data.get("hostname")).trim().toLowerCase();
        await productRequest("/api/product-analytics/sources", {
          kind: "website_analytics_source",
          title: hostname,
          idempotencyKey: crypto.randomUUID(),
          payload: { hostname },
        });
      } else {
        const domain = String(data.get("domain")).trim().toLowerCase();
        const topics = String(data.get("topics")).split(",").map((topic) => topic.trim()).filter(Boolean);
        await productRequest("/api/product-analytics/sources", {
          kind: "geo_analytics_source",
          title: domain,
          idempotencyKey: crypto.randomUUID(),
          payload: { domain, topics },
        });
      }
      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error"));
    } finally {
      setBusy(null);
    }
  }

  return <section className="grid gap-4 lg:grid-cols-2">
    <form onSubmit={(event) => submit(event, "website")} className="rounded-2xl border bg-card p-5">
      <Globe2 className="size-5 text-amber-600" />
      <h2 className="mt-4 text-lg font-semibold">{t("sources.websiteTitle")}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("sources.websiteHelp")}</p>
      <label className="mt-4 block text-sm font-medium" htmlFor="analytics-hostname">{t("sources.hostname")}</label>
      <input id="analytics-hostname" name="hostname" required inputMode="url" placeholder={t("sources.hostnamePlaceholder")} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" />
      <button disabled={busy !== null} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-300 font-semibold text-stone-950 disabled:opacity-60">
        {busy === "website" ? <LoaderCircle className="size-4 animate-spin" /> : <Globe2 className="size-4" />}{t("sources.connectWebsite")}
      </button>
    </form>
    <form onSubmit={(event) => submit(event, "geo")} className="rounded-2xl border bg-card p-5">
      <Radar className="size-5 text-amber-600" />
      <h2 className="mt-4 text-lg font-semibold">{t("sources.geoTitle")}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("sources.geoHelp")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="block text-sm font-medium" htmlFor="geo-domain">{t("sources.domain")}</label><input id="geo-domain" name="domain" required inputMode="url" placeholder={t("sources.domainPlaceholder")} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" /></div>
        <div><label className="block text-sm font-medium" htmlFor="geo-topics">{t("sources.topics")}</label><input id="geo-topics" name="topics" required placeholder={t("sources.topicsPlaceholder")} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" /></div>
      </div>
      <button disabled={busy !== null} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-stone-950 font-semibold text-white disabled:opacity-60">
        {busy === "geo" ? <LoaderCircle className="size-4 animate-spin" /> : <Radar className="size-4" />}{t("sources.trackGeo")}
      </button>
    </form>
    {error && <p role="alert" className="text-sm text-destructive lg:col-span-2">{error}</p>}
  </section>;
}
