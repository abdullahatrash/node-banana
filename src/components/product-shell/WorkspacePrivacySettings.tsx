"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, CheckCircle2, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import { getDirection } from "@/i18n/config";

type TelemetryConsent = {
  schema: "product-telemetry-consent/v1";
  workspaceId: string;
  userId: string;
  revision: number;
  purpose: "product_analytics";
  status: "active" | "revoked";
  issuedAt: string;
  expiresAt: string;
};

const durationDays = [30, 90, 365] as const;

export function WorkspacePrivacySettings({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("product.privacySettings") as (key: string, values?: Record<string, string | number | Date>) => string;
  const locale = useLocale() as "ar" | "en";
  const [consent, setConsent] = useState<TelemetryConsent | null>(null);
  const [days, setDays] = useState<(typeof durationDays)[number]>(90);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/studio/product-telemetry/consent", { headers: { "x-workspace-id": workspaceId }, cache: "no-store" });
    const body = await response.json() as { success?: boolean; consent?: TelemetryConsent | null; code?: string };
    if (!response.ok || !body.success) throw new Error(body.code ?? "REQUEST_FAILED");
    setConsent(body.consent ?? null);
    setLoaded(true);
  }, [workspaceId]);

  useEffect(() => { void load().catch(() => { setError("REQUEST_FAILED"); setLoaded(true); }); }, [load]);

  const active = Boolean(consent?.status === "active" && new Date(consent.expiresAt) > new Date());

  async function update(status: "active" | "revoked") {
    setBusy(true); setError("");
    try {
      const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
      const response = await fetch("/api/studio/product-telemetry/consent", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), "x-workspace-id": workspaceId },
        body: JSON.stringify(status === "active" ? { status, expiresAt } : { status }),
      });
      const body = await response.json() as { success?: boolean; consent?: TelemetryConsent; code?: string };
      if (!response.ok || !body.success || !body.consent) throw new Error(body.code ?? "REQUEST_FAILED");
      setConsent(body.consent);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "REQUEST_FAILED"); }
    finally { setBusy(false); }
  }

  const errorText = t(`errors.${error === "INVALID_INPUT" || error === "IDEMPOTENCY_CONFLICT" ? error : "REQUEST_FAILED"}`);

  return <div lang={locale} dir={getDirection(locale)} className="space-y-6 p-5 sm:p-8">
    <header><h2 className="text-2xl font-semibold">{t("title")}</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p></header>
    {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorText}</p> : null}
    <section className="rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 gap-3"><BarChart3 className="mt-0.5 size-5 shrink-0" /><div><h3 className="font-semibold">{t("analytics.title")}</h3><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("analytics.description")}</p></div></div>{loaded ? <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>{active ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{t(active ? "status.active" : "status.inactive")}</span> : <LoaderCircle className="size-5 animate-spin" aria-label={t("loading")} />}</div>
      <ul className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><li>{t("analytics.contentFree")}</li><li>{t("analytics.pseudonymous")}</li><li>{t("analytics.retention")}</li><li>{t("analytics.noAdvertising")}</li></ul>
      {active && consent ? <p className="mt-4 text-xs text-muted-foreground">{t("analytics.current", { revision: consent.revision, date: new Date(consent.expiresAt) })}</p> : null}
      <div className="mt-5 flex flex-wrap items-end gap-3">{!active ? <label className="grid gap-1 text-sm"><span className="font-medium">{t("analytics.duration")}</span><select value={days} onChange={(event) => setDays(Number(event.target.value) as typeof days)} className="min-h-11 rounded-lg border bg-background px-3">{durationDays.map((value) => <option key={value} value={value}>{t("analytics.days", { count: value })}</option>)}</select></label> : null}<button disabled={!loaded || busy} onClick={() => void update(active ? "revoked" : "active")} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50 ${active ? "text-destructive" : ""}`}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{t(active ? "analytics.revoke" : "analytics.enable")}</button></div>
      {active ? <p className="mt-3 text-xs text-muted-foreground">{t("analytics.revokeEffect")}</p> : null}
    </section>
    <section className="rounded-2xl border p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold">{t("xAds.title")}</h3><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("xAds.description")}</p></div><span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"><XCircle className="size-3.5" />{t("status.inactive")}</span></div><p className="mt-4 rounded-xl bg-muted/60 p-3 text-sm">{t("xAds.boundary")}</p><p className="mt-3 text-xs text-muted-foreground">{t("xAds.sentWarning")}</p></section>
    <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("separation.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("separation.description")}</p></section>
  </div>;
}
