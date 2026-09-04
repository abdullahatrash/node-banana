"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Compass, LoaderCircle, Save, Sparkles } from "lucide-react";
import { useToast } from "@/components/Toast";
import { getActiveWorkspaceId } from "@/lib/studio/client";
import {
  MARKET_DEFAULT_TIMEZONE,
  WORKSPACE_CONTENT_MARKETS,
  WORKSPACE_TIMEZONES,
  type WorkspaceCalendarPreferences,
  type WorkspaceContentMarket,
  type WorkspaceWeekStart,
} from "@/lib/product-surfaces/workspace-preferences-contract";

type PreferenceResponse = {
  success: boolean;
  code?: string;
  preferences?: WorkspaceCalendarPreferences;
};

export function WorkspacePreferencesSettings({
  initialPreferences,
  canManage,
}: {
  initialPreferences: WorkspaceCalendarPreferences;
  canManage: boolean;
}) {
  const t = useTranslations("product.workspacePreferences") as (key: string, values?: Record<string, string | number>) => string;
  const locale = useLocale();
  const { show: showToast } = useToast();
  const [preferences, setPreferences] = useState(initialPreferences);
  const [savedPreferences, setSavedPreferences] = useState(initialPreferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(preferences) !== JSON.stringify(savedPreferences);
  const recommendedTimezone = MARKET_DEFAULT_TIMEZONE[preferences.contentMarket];
  const timezoneOptions = useMemo(
    () => [...new Set([preferences.timezone, ...WORKSPACE_TIMEZONES])],
    [preferences.timezone],
  );

  function update<Key extends keyof WorkspaceCalendarPreferences>(key: Key, value: WorkspaceCalendarPreferences[Key]) {
    setPreferences((current) => ({ ...current, [key]: value }));
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !dirty) return;
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) {
      setError(t("errors.workspace"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/studio/calendar/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify(preferences),
      });
      const result = await response.json() as PreferenceResponse;
      if (!response.ok || !result.success || !result.preferences) throw new Error(result.code ?? "REQUEST_FAILED");
      setPreferences(result.preferences);
      setSavedPreferences(result.preferences);
      showToast(t("saved"), "success");
    } catch {
      setError(t("errors.save"));
      showToast(t("errors.save"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-5 sm:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p>
        <h2 className="mt-2 text-2xl font-semibold">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {!canManage ? <p role="note" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">{t("readOnly")}</p> : null}

      <form onSubmit={save} className="mt-6 space-y-6">
        <fieldset disabled={!canManage || busy} className="grid gap-5 disabled:opacity-65 lg:grid-cols-2">
          <section className="rounded-2xl border bg-card p-5 lg:col-span-2" aria-labelledby="market-heading">
            <div className="flex items-start gap-3">
              <Compass className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div>
                <h3 id="market-heading" className="font-semibold">{t("market.title")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("market.description")}</p>
              </div>
            </div>
            <label className="mt-4 grid max-w-xl gap-2 text-sm font-medium">
              {t("market.label")}
              <select
                value={preferences.contentMarket}
                onChange={(event) => update("contentMarket", event.target.value as WorkspaceContentMarket)}
                className="min-h-11 rounded-xl border bg-background px-3"
              >
                {WORKSPACE_CONTENT_MARKETS.map((market) => <option key={market} value={market}>{t(`markets.${market}`)}</option>)}
              </select>
            </label>
            <p className="mt-3 text-xs text-muted-foreground">{t("market.governanceSeparation")}</p>
          </section>

          <section className="rounded-2xl border bg-card p-5" aria-labelledby="timezone-heading">
            <h3 id="timezone-heading" className="font-semibold">{t("timezone.title")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("timezone.description")}</p>
            <label className="mt-4 grid gap-2 text-sm font-medium">
              {t("timezone.label")}
              <input
                list="workspace-timezones"
                value={preferences.timezone}
                onChange={(event) => update("timezone", event.target.value)}
                maxLength={100}
                required
                dir="ltr"
                className="min-h-11 rounded-xl border bg-background px-3 text-start"
              />
              <datalist id="workspace-timezones">
                {timezoneOptions.map((timezone) => <option key={timezone} value={timezone} />)}
              </datalist>
            </label>
            <button
              type="button"
              onClick={() => update("timezone", recommendedTimezone)}
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
            >
              <Sparkles className="size-4" />
              {t("timezone.useRecommended", { timezone: recommendedTimezone })}
            </button>
          </section>

          <section className="rounded-2xl border bg-card p-5" aria-labelledby="week-heading">
            <h3 id="week-heading" className="font-semibold">{t("weekStart.title")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("weekStart.description")}</p>
            <label className="mt-4 grid gap-2 text-sm font-medium">
              {t("weekStart.label")}
              <select
                value={preferences.weekStartsOn}
                onChange={(event) => update("weekStartsOn", Number(event.target.value) as WorkspaceWeekStart)}
                className="min-h-11 rounded-xl border bg-background px-3"
              >
                {[0, 1, 2, 3, 4, 5, 6].map((day) => <option key={day} value={day}>{t(`weekdays.${day}`)}</option>)}
              </select>
            </label>
            <p className="mt-3 text-xs text-muted-foreground">{t("weekStart.localeHint", { locale: locale === "ar" ? t("locales.ar") : t("locales.en") })}</p>
          </section>
        </fieldset>

        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100" aria-labelledby="effects-heading">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
            <div><h3 id="effects-heading" className="font-semibold">{t("effects.title")}</h3><p className="mt-1">{t("effects.description")}</p><Link href="/inspiration" className="mt-3 inline-flex underline underline-offset-4">{t("effects.openTrends")}</Link></div>
          </div>
        </section>

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!canManage || busy || !dirty} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-5 font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? t("saving") : t("save")}
          </button>
          <span role="status" className="text-sm text-muted-foreground">{dirty ? t("unsaved") : t("current")}</span>
        </div>
      </form>
    </div>
  );
}
