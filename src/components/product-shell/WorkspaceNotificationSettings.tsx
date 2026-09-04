"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Bell, Clock3, Languages, LoaderCircle, Mail, Save, ShieldAlert } from "lucide-react";
import type { AppLocale } from "@/i18n/config";
import { useToast } from "@/components/Toast";
import {
  SOCIAL_NOTIFICATION_CATEGORIES,
  defaultSocialNotificationPreferences,
  readSocialNotificationPreferencesDocument,
  type SocialNotificationPreferencesDocument,
} from "@/lib/social/notification-preferences";

type DeliveryState = {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  muteAll: boolean;
  document: SocialNotificationPreferencesDocument;
};

export function WorkspaceNotificationSettings({ workspaceId, interfaceLocale, workspaceTimeZone }: { workspaceId: string; interfaceLocale: AppLocale; workspaceTimeZone: string }) {
  const t = useTranslations("product.notificationPreferences") as (key: string) => string;
  const { show } = useToast();
  const [state, setState] = useState<DeliveryState>(() => ({ inAppEnabled: true, emailEnabled: false, muteAll: false, document: defaultSocialNotificationPreferences({ locale: interfaceLocale, timeZone: workspaceTimeZone }) }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch("/api/social/notifications/preferences", { headers: { "x-workspace-id": workspaceId }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { success?: boolean; preferences?: { inAppEnabled?: boolean; emailEnabled?: boolean; muteAll?: boolean; preferences?: unknown } };
        if (!response.ok || !result.success || !result.preferences) throw new Error("NOTIFICATION_PREFERENCES_LOAD_FAILED");
        setState({
          inAppEnabled: result.preferences.inAppEnabled ?? true,
          emailEnabled: result.preferences.emailEnabled ?? false,
          muteAll: result.preferences.muteAll ?? false,
          document: readSocialNotificationPreferencesDocument(result.preferences.preferences, { locale: interfaceLocale, timeZone: workspaceTimeZone }),
        });
      })
      .catch((cause) => { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(t("errors.load")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [interfaceLocale, t, workspaceId, workspaceTimeZone]);

  function updateDocument(patch: Partial<SocialNotificationPreferencesDocument>) {
    setState((current) => ({ ...current, document: { ...current.document, ...patch } }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/social/notifications/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify({ inAppEnabled: state.inAppEnabled, emailEnabled: state.emailEnabled, muteAll: state.muteAll, preferences: state.document }),
      });
      const result = await response.json() as { success?: boolean; preferences?: { inAppEnabled: boolean; emailEnabled: boolean; muteAll: boolean; preferences: unknown } };
      if (!response.ok || !result.success || !result.preferences) throw new Error("NOTIFICATION_PREFERENCES_SAVE_FAILED");
      setState({ inAppEnabled: result.preferences.inAppEnabled, emailEnabled: result.preferences.emailEnabled, muteAll: result.preferences.muteAll, document: readSocialNotificationPreferencesDocument(result.preferences.preferences, { locale: interfaceLocale, timeZone: workspaceTimeZone }) });
      show(t("saved"), "success");
    } catch { setError(t("errors.save")); show(t("errors.save"), "error"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex min-h-56 items-center justify-center"><LoaderCircle aria-label={t("loading")} className="size-6 animate-spin" /></div>;

  return <form onSubmit={save} className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
    <header><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p><h2 className="mt-2 text-2xl font-semibold">{t("title")}</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p></header>
    <section className="grid gap-4 md:grid-cols-3">
      <Toggle icon={Bell} label={t("channels.inApp.title")} description={t("channels.inApp.description")} checked={state.inAppEnabled} onChange={(value) => setState((current) => ({ ...current, inAppEnabled: value }))} />
      <Toggle icon={Mail} label={t("channels.email.title")} description={t("channels.email.description")} checked={state.emailEnabled} onChange={(value) => setState((current) => ({ ...current, emailEnabled: value }))} />
      <Toggle icon={Bell} label={t("channels.mute.title")} description={t("channels.mute.description")} checked={state.muteAll} onChange={(value) => setState((current) => ({ ...current, muteAll: value }))} />
    </section>
    <section className="grid gap-5 rounded-2xl border bg-card p-5 md:grid-cols-2">
      <div><div className="flex items-center gap-2"><Languages className="size-4 text-amber-600" /><h3 className="font-semibold">{t("delivery.title")}</h3></div><p className="mt-1 text-sm text-muted-foreground">{t("delivery.description")}</p></div>
      <label className="grid gap-2 text-sm font-medium">{t("delivery.language")}<select value={state.document.deliveryLocale} onChange={(event) => updateDocument({ deliveryLocale: event.target.value as AppLocale })} className="min-h-11 rounded-xl border bg-background px-3"><option value="ar">{t("languages.ar")}</option><option value="en">{t("languages.en")}</option></select></label>
      <label className="grid gap-2 text-sm font-medium">{t("delivery.cadence")}<select value={state.document.digestCadence} onChange={(event) => updateDocument({ digestCadence: event.target.value as "daily" | "weekly" })} className="min-h-11 rounded-xl border bg-background px-3"><option value="daily">{t("cadence.daily")}</option><option value="weekly">{t("cadence.weekly")}</option></select></label>
      {state.document.digestCadence === "weekly" ? <label className="grid gap-2 text-sm font-medium">{t("delivery.weeklyDay")}<select value={state.document.weeklyDigestDay} onChange={(event) => updateDocument({ weeklyDigestDay: Number(event.target.value) })} className="min-h-11 rounded-xl border bg-background px-3">{Array.from({ length: 7 }, (_, day) => <option key={day} value={day}>{t(`weekdays.${day}`)}</option>)}</select></label> : <div />}
    </section>
    <section className="rounded-2xl border bg-card p-5"><div className="flex items-center gap-2"><Clock3 className="size-4 text-amber-600" /><h3 className="font-semibold">{t("quiet.title")}</h3></div><p className="mt-1 text-sm text-muted-foreground">{t("quiet.description")}</p><label className="mt-4 inline-flex min-h-10 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={state.document.quietHours.enabled} onChange={(event) => updateDocument({ quietHours: { ...state.document.quietHours, enabled: event.target.checked } })} className="size-4 accent-amber-500" />{t("quiet.enable")}</label><fieldset disabled={!state.document.quietHours.enabled} className="mt-3 grid gap-4 disabled:opacity-55 sm:grid-cols-3"><TimeField label={t("quiet.start")} value={state.document.quietHours.start} onChange={(value) => updateDocument({ quietHours: { ...state.document.quietHours, start: value } })} /><TimeField label={t("quiet.end")} value={state.document.quietHours.end} onChange={(value) => updateDocument({ quietHours: { ...state.document.quietHours, end: value } })} /><label className="grid gap-2 text-sm font-medium">{t("quiet.timeZone")}<input dir="ltr" value={state.document.quietHours.timeZone} onChange={(event) => updateDocument({ quietHours: { ...state.document.quietHours, timeZone: event.target.value } })} className="min-h-11 rounded-xl border bg-background px-3 text-start" /></label></fieldset></section>
    <section className="rounded-2xl border bg-card p-5"><h3 className="font-semibold">{t("categories.title")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("categories.description")}</p><div className="mt-4 grid gap-3 md:grid-cols-3">{SOCIAL_NOTIFICATION_CATEGORIES.map((category) => <label key={category} className="flex min-h-14 items-start gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={state.document.categories[category]} onChange={(event) => updateDocument({ categories: { ...state.document.categories, [category]: event.target.checked } })} className="mt-0.5 size-4 accent-amber-500" /><span><strong className="block font-medium">{t(`categories.${category}.title`)}</strong><span className="text-xs text-muted-foreground">{t(`categories.${category}.description`)}</span></span></label>)}</div></section>
    <p role="note" className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{t("mandatory")}</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <button disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-5 font-semibold text-background disabled:opacity-50">{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? t("saving") : t("save")}</button>
  </form>;
}

function Toggle({ icon: Icon, label, description, checked, onChange }: { icon: typeof Bell; label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex min-h-28 cursor-pointer items-start gap-3 rounded-2xl border bg-card p-4"><Icon className="mt-0.5 size-5 shrink-0 text-amber-600" /><span className="min-w-0 flex-1"><strong className="block font-semibold">{label}</strong><span className="mt-1 block text-xs text-muted-foreground">{description}</span></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 size-4 accent-amber-500" /></label>; }
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="grid gap-2 text-sm font-medium">{label}<input dir="ltr" type="time" value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 rounded-xl border bg-background px-3 text-start" /></label>; }
