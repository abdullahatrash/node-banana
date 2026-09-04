"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, CheckCircle2, ExternalLink, LoaderCircle, Megaphone, ShieldCheck, XCircle } from "lucide-react";
import { getDirection } from "@/i18n/config";

type TelemetryConsent = { schema: "product-telemetry-consent/v1"; workspaceId: string; userId: string; revision: number; purpose: "product_analytics"; status: "active" | "revoked"; issuedAt: string; expiresAt: string };
type AttributionConsent = { schema: "marketing-attribution-consent/v1"; workspaceId: string; userId: string; provider: "x_ads"; revision: number; purpose: "advertising_attribution"; status: "active" | "revoked"; noticeVersion: string; regionReviewVersion: string; issuedAt: string; expiresAt: string };
type AttributionStatus = { schema: "marketing-attribution-status/v1"; readiness: { available: boolean; deliveryMode: "server_conversion_api"; browserPixelLoaded: false; privacyNoticeUrl: string | null; noticeVersion: string | null; regionReviewVersion: string | null; blockers: string[] }; consent: AttributionConsent | null; active: boolean; counts: { pending: number; delivered: number } };

const durationDays = [30, 90, 365] as const;
type Duration = (typeof durationDays)[number];

export function WorkspacePrivacySettings({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("product.privacySettings") as (key: string, values?: Record<string, string | number | Date>) => string;
  const locale = useLocale() as "ar" | "en";
  const [telemetryConsent, setTelemetryConsent] = useState<TelemetryConsent | null>(null);
  const [attribution, setAttribution] = useState<AttributionStatus | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState<Duration>(90);
  const [attributionDays, setAttributionDays] = useState<Duration>(90);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"analytics" | "x_ads" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const headers = { "x-workspace-id": workspaceId };
    const [telemetryResponse, attributionResponse] = await Promise.all([
      fetch("/api/studio/product-telemetry/consent", { headers, cache: "no-store" }),
      fetch("/api/studio/marketing-attribution", { headers, cache: "no-store" }),
    ]);
    const telemetryBody = await telemetryResponse.json() as { success?: boolean; consent?: TelemetryConsent | null; code?: string };
    const attributionBody = await attributionResponse.json() as { success?: boolean; status?: AttributionStatus; code?: string };
    if (!telemetryResponse.ok || !telemetryBody.success || !attributionResponse.ok || !attributionBody.success || !attributionBody.status) throw new Error(telemetryBody.code ?? attributionBody.code ?? "REQUEST_FAILED");
    setTelemetryConsent(telemetryBody.consent ?? null); setAttribution(attributionBody.status); setLoaded(true);
  }, [workspaceId]);

  useEffect(() => { void load().catch(() => { setError("REQUEST_FAILED"); setLoaded(true); }); }, [load]);
  const analyticsActive = Boolean(telemetryConsent?.status === "active" && new Date(telemetryConsent.expiresAt) > new Date());

  async function updateAnalytics(status: "active" | "revoked") {
    setBusy("analytics"); setError("");
    try {
      const expiresAt = new Date(Date.now() + analyticsDays * 86_400_000).toISOString();
      const response = await fetch("/api/studio/product-telemetry/consent", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), "x-workspace-id": workspaceId }, body: JSON.stringify(status === "active" ? { status, expiresAt } : { status }) });
      const body = await response.json() as { success?: boolean; consent?: TelemetryConsent; code?: string };
      if (!response.ok || !body.success || !body.consent) throw new Error(body.code ?? "REQUEST_FAILED");
      setTelemetryConsent(body.consent);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "REQUEST_FAILED"); }
    finally { setBusy(null); }
  }

  async function updateAttribution(status: "active" | "revoked") {
    setBusy("x_ads"); setError("");
    try {
      const expiresAt = new Date(Date.now() + attributionDays * 86_400_000).toISOString();
      const response = await fetch("/api/studio/marketing-attribution", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), "x-workspace-id": workspaceId }, body: JSON.stringify(status === "active" ? { status, expiresAt } : { status }) });
      const body = await response.json() as { success?: boolean; consent?: AttributionConsent; code?: string };
      if (!response.ok || !body.success || !body.consent) throw new Error(body.code ?? "REQUEST_FAILED");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "REQUEST_FAILED"); }
    finally { setBusy(null); }
  }

  const normalizedError = ["INVALID_INPUT", "IDEMPOTENCY_CONFLICT", "ATTRIBUTION_NOT_CONFIGURED", "ATTRIBUTION_CONSENT_EXPIRY_INVALID"].includes(error) ? error : "REQUEST_FAILED";
  const xActive = Boolean(attribution?.active);

  return <div lang={locale} dir={getDirection(locale)} className="space-y-6 p-5 sm:p-8">
    <header><h2 className="text-2xl font-semibold">{t("title")}</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p></header>
    {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{t(`errors.${normalizedError}`)}</p> : null}
    <section className="rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 gap-3"><BarChart3 className="mt-0.5 size-5 shrink-0" /><div><h3 className="font-semibold">{t("analytics.title")}</h3><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("analytics.description")}</p></div></div>{loaded ? <StatusBadge active={analyticsActive} label={t(analyticsActive ? "status.active" : "status.inactive")} /> : <LoaderCircle className="size-5 animate-spin" aria-label={t("loading")} />}</div>
      <ul className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><li>{t("analytics.contentFree")}</li><li>{t("analytics.pseudonymous")}</li><li>{t("analytics.retention")}</li><li>{t("analytics.noAdvertising")}</li></ul>
      {analyticsActive && telemetryConsent ? <p className="mt-4 text-xs text-muted-foreground">{t("analytics.current", { revision: telemetryConsent.revision, date: new Date(telemetryConsent.expiresAt) })}</p> : null}
      <ConsentControls active={analyticsActive} loaded={loaded} busy={busy === "analytics"} days={analyticsDays} setDays={setAnalyticsDays} onChange={(status) => void updateAnalytics(status)} durationLabel={t("analytics.duration")} daysLabel={(count) => t("analytics.days", { count })} enableLabel={t("analytics.enable")} revokeLabel={t("analytics.revoke")} />
      {analyticsActive ? <p className="mt-3 text-xs text-muted-foreground">{t("analytics.revokeEffect")}</p> : null}
    </section>
    <section className="rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 gap-3"><Megaphone className="mt-0.5 size-5 shrink-0" /><div><h3 className="font-semibold">{t("xAds.title")}</h3><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("xAds.description")}</p></div></div>{loaded && attribution ? <StatusBadge active={xActive} label={t(xActive ? "status.active" : attribution.readiness.available ? "status.inactive" : "status.unavailable")} /> : <LoaderCircle className="size-5 animate-spin" aria-label={t("loading")} />}</div>
      <ul className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><li>{t("xAds.serverOnly")}</li><li>{t("xAds.identifiers")}</li><li>{t("xAds.events")}</li><li>{t("xAds.retention")}</li></ul>
      <p className="mt-4 rounded-xl bg-muted/60 p-3 text-sm">{t("xAds.boundary")}</p>
      {attribution && !attribution.readiness.available ? <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 text-sm text-amber-950"><p className="font-medium">{t("xAds.unavailable")}</p><ul className="mt-2 list-inside list-disc text-xs">{attribution.readiness.blockers.map((blocker) => <li key={blocker}>{t(`xAds.blockers.${blocker}`)}</li>)}</ul></div> : null}
      {attribution?.readiness.privacyNoticeUrl ? <a className="mt-4 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4" href={attribution.readiness.privacyNoticeUrl} target="_blank" rel="noreferrer">{t("xAds.notice")}<ExternalLink className="size-3.5" /></a> : null}
      {xActive && attribution?.consent ? <p className="mt-4 text-xs text-muted-foreground">{t("xAds.current", { revision: attribution.consent.revision, date: new Date(attribution.consent.expiresAt), pending: attribution.counts.pending, delivered: attribution.counts.delivered })}</p> : null}
      {attribution?.readiness.available ? <ConsentControls active={xActive} loaded={loaded} busy={busy === "x_ads"} days={attributionDays} setDays={setAttributionDays} onChange={(status) => void updateAttribution(status)} durationLabel={t("xAds.duration")} daysLabel={(count) => t("analytics.days", { count })} enableLabel={t("xAds.enable")} revokeLabel={t("xAds.revoke")} /> : null}
      <p className="mt-3 text-xs text-muted-foreground">{t("xAds.sentWarning")}</p>
    </section>
    <section className="rounded-2xl border p-5"><h3 className="font-semibold">{t("separation.title")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("separation.description")}</p></section>
  </div>;
}

function StatusBadge({ active, label }: { active: boolean; label: string }) { return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>{active ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{label}</span>; }

function ConsentControls({ active, loaded, busy, days, setDays, onChange, durationLabel, daysLabel, enableLabel, revokeLabel }: { active: boolean; loaded: boolean; busy: boolean; days: Duration; setDays: (days: Duration) => void; onChange: (status: "active" | "revoked") => void; durationLabel: string; daysLabel: (count: number) => string; enableLabel: string; revokeLabel: string }) {
  return <div className="mt-5 flex flex-wrap items-end gap-3">{!active ? <label className="grid gap-1 text-sm"><span className="font-medium">{durationLabel}</span><select value={days} onChange={(event) => setDays(Number(event.target.value) as Duration)} className="min-h-11 rounded-lg border bg-background px-3">{durationDays.map((value) => <option key={value} value={value}>{daysLabel(value)}</option>)}</select></label> : null}<button disabled={!loaded || busy} onClick={() => onChange(active ? "revoked" : "active")} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50 ${active ? "text-destructive" : ""}`}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{active ? revokeLabel : enableLabel}</button></div>;
}
