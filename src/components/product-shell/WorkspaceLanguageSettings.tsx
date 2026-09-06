"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, Languages, LoaderCircle, Save } from "lucide-react";
import type { AppLocale } from "@/i18n/config";
import { saveInterfaceLocalePreference } from "@/lib/interface-locale/client";
import type { WorkspaceContentLanguage } from "@/lib/product-surfaces/workspace-language-preferences";
import { useDirectionStore } from "@/store/directionStore";
import { useToast } from "@/components/Toast";

export function WorkspaceLanguageSettings({
  initialInterfaceLocale,
  initialContentLanguage,
  canManageContent,
  workspaceId,
}: {
  initialInterfaceLocale: AppLocale;
  initialContentLanguage: WorkspaceContentLanguage;
  canManageContent: boolean;
  workspaceId: string;
}) {
  const t = useTranslations("product.workspaceLanguage") as (key: string) => string;
  const router = useRouter();
  const setDocumentLocale = useDirectionStore((state) => state.setLocale);
  const { show: showToast } = useToast();
  const [interfaceLocale, setInterfaceLocale] = useState(initialInterfaceLocale);
  const [savedInterfaceLocale, setSavedInterfaceLocale] = useState(initialInterfaceLocale);
  const [contentLanguage, setContentLanguage] = useState(initialContentLanguage);
  const [savedContentLanguage, setSavedContentLanguage] = useState(initialContentLanguage);
  const [interfaceBusy, setInterfaceBusy] = useState(false);
  const [contentBusy, setContentBusy] = useState(false);
  const [interfaceError, setInterfaceError] = useState("");
  const [contentError, setContentError] = useState("");

  async function saveInterface(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (interfaceBusy || interfaceLocale === savedInterfaceLocale) return;
    setInterfaceBusy(true);
    setInterfaceError("");
    setDocumentLocale(interfaceLocale);
    try {
      await saveInterfaceLocalePreference({ locale: interfaceLocale, workspaceId });
      setSavedInterfaceLocale(interfaceLocale);
      showToast(t("interface.saved"), "success");
      router.refresh();
    } catch {
      setDocumentLocale(savedInterfaceLocale);
      setInterfaceLocale(savedInterfaceLocale);
      setInterfaceError(t("interface.error"));
      showToast(t("interface.error"), "error");
    } finally {
      setInterfaceBusy(false);
    }
  }

  async function saveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageContent || contentBusy || contentLanguage === savedContentLanguage) return;
    setContentBusy(true);
    setContentError("");
    try {
      const response = await fetch("/api/studio/preferences/content-language", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
        body: JSON.stringify({ contentLanguage }),
      });
      const result = await response.json() as { success?: boolean; contentLanguage?: WorkspaceContentLanguage };
      if (!response.ok || !result.success || !result.contentLanguage) throw new Error("CONTENT_LANGUAGE_SAVE_FAILED");
      setContentLanguage(result.contentLanguage);
      setSavedContentLanguage(result.contentLanguage);
      showToast(t("content.saved"), "success");
      router.refresh();
    } catch {
      setContentError(t("content.error"));
      showToast(t("content.error"), "error");
    } finally {
      setContentBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-5 sm:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p>
        <h2 className="mt-2 text-2xl font-semibold">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form onSubmit={saveInterface} className="rounded-2xl border bg-card p-5">
          <div className="flex items-start gap-3"><Languages className="mt-0.5 size-5 shrink-0 text-amber-600" /><div><h3 className="font-semibold">{t("interface.title")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("interface.description")}</p></div></div>
          <label className="mt-5 grid gap-2 text-sm font-medium">
            {t("interface.label")}
            <select value={interfaceLocale} onChange={(event) => { setInterfaceLocale(event.target.value as AppLocale); setInterfaceError(""); }} className="min-h-11 rounded-xl border bg-background px-3">
              <option value="ar">{t("languages.ar")}</option>
              <option value="en">{t("languages.en")}</option>
            </select>
          </label>
          <p className="mt-3 text-xs text-muted-foreground">{t("interface.scope")}</p>
          {interfaceError ? <p role="alert" className="mt-3 text-sm text-destructive">{interfaceError}</p> : null}
          <button type="submit" disabled={interfaceBusy || interfaceLocale === savedInterfaceLocale} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-5 font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45">
            {interfaceBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{interfaceBusy ? t("saving") : t("interface.save")}
          </button>
        </form>

        <form onSubmit={saveContent} className="rounded-2xl border bg-card p-5">
          <div className="flex items-start gap-3"><FileText className="mt-0.5 size-5 shrink-0 text-amber-600" /><div><h3 className="font-semibold">{t("content.title")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("content.description")}</p></div></div>
          {!canManageContent ? <p role="note" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">{t("content.readOnly")}</p> : null}
          <fieldset disabled={!canManageContent || contentBusy} className="disabled:opacity-65">
            <label className="mt-5 grid gap-2 text-sm font-medium">
              {t("content.label")}
              <select value={contentLanguage} onChange={(event) => { setContentLanguage(event.target.value as WorkspaceContentLanguage); setContentError(""); }} className="min-h-11 rounded-xl border bg-background px-3">
                <option value="ar">{t("languages.ar")}</option>
                <option value="en">{t("languages.en")}</option>
              </select>
            </label>
            <p className="mt-3 text-xs text-muted-foreground">{t("content.scope")}</p>
            {contentError ? <p role="alert" className="mt-3 text-sm text-destructive">{contentError}</p> : null}
            <button type="submit" disabled={contentLanguage === savedContentLanguage} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-5 font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45">
              {contentBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{contentBusy ? t("saving") : t("content.save")}
            </button>
          </fieldset>
        </form>
      </div>

      <p className="mt-6 rounded-2xl border bg-muted/50 p-5 text-sm text-muted-foreground">{t("separation")}</p>
    </div>
  );
}
