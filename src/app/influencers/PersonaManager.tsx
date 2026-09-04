"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, LoaderCircle, ShieldCheck, UserRoundPlus } from "lucide-react";
import { ProductRequestError, productRequest } from "@/components/product-surfaces/ProductApi";
import { ARABIC_VARIETIES } from "@/lib/product-surfaces/definitions";
import type { CreatorPersona } from "@/lib/creator-personas/types";
import type { ManagedCreditQuote } from "@/lib/model-routing/budget-authority";

type PersonaLifecycle = Record<string, { activeConsentEvidenceId: string | null }>;
type PendingTrainingQuote = { persona: CreatorPersona; idempotencyKey: string; quote: ManagedCreditQuote };

function managedQuote(value: unknown): ManagedCreditQuote | null {
  if (!value || typeof value !== "object") return null;
  const quote = value as Partial<ManagedCreditQuote>;
  return quote.schema === "managed-generation-credit-quote/v1" && typeof quote.quoteId === "string" && typeof quote.intentId === "string" && Number.isSafeInteger(quote.totalDebitUnits) && quote.currency === "USD" && typeof quote.subtotalMinor === "number" && typeof quote.taxMinor === "number" && typeof quote.totalMinor === "number" && typeof quote.expiresAt === "string" && typeof quote.confirmationDigest === "string" ? quote as ManagedCreditQuote : null;
}

export function PersonaManager({ personas, lifecycle }: { personas: CreatorPersona[]; lifecycle: PersonaLifecycle }) {
  const t = useTranslations("product.personas") as (key: string, values?: Record<string, string | number>) => string;
  const admissionT = useTranslations("simpleStudio.admission");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pendingTrainingQuote, setPendingTrainingQuote] = useState<PendingTrainingQuote | null>(null);
  async function call(path: string, body: Record<string, unknown>) {
    setBusy(path); setError("");
    try { const response = await productRequest(path, body); router.refresh(); return response; }
    catch (cause) { setError(cause instanceof Error ? t(`errors.${cause.message}`) : t("error")); }
    finally { setBusy(null); }
  }
  async function requestTraining(persona: CreatorPersona, pending?: PendingTrainingQuote) {
    const path = `/api/studio/personas/${encodeURIComponent(persona.id)}/commands`;
    const idempotencyKey = pending?.idempotencyKey ?? crypto.randomUUID();
    setBusy(path); setError("");
    try {
      await productRequest(path, { action: "request_training", expectedRevision: persona.revision, idempotencyKey, managedQuoteAcceptance: pending ? { quoteId: pending.quote.quoteId, confirmationDigest: pending.quote.confirmationDigest } : null });
      setPendingTrainingQuote(null); router.refresh();
    } catch (cause) {
      if (cause instanceof ProductRequestError && cause.code === "MANAGED_CREDIT_CONFIRMATION_REQUIRED") {
        const quote = managedQuote(cause.details.managedCreditQuote);
        if (quote) { setPendingTrainingQuote({ persona, idempotencyKey, quote }); return; }
      }
      setError(cause instanceof Error ? t(`errors.${cause.message}`) : t("error"));
    } finally { setBusy(null); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const language = String(data.get("language"));
    await call("/api/studio/personas", { action: "create", name: String(data.get("name")), kind: String(data.get("kind")), contentLanguage: language, arabicVariety: language === "ar" ? String(data.get("variety")) : null, disclosure: String(data.get("disclosure")), retentionUntil: new Date(String(data.get("retentionUntil"))).toISOString(), idempotencyKey: crypto.randomUUID() });
    form.reset();
  }
  async function submitCommand(event: FormEvent<HTMLFormElement>, persona: CreatorPersona, action: string) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const base = { action, expectedRevision: persona.revision, idempotencyKey: crypto.randomUUID() }; let body: Record<string, unknown> = base;
    if (action === "attach_sources") body = { ...base, assetIds: split(data, "assetIds"), consentEvidenceId: value(data, "consentEvidenceId") };
    if (action === "record_consent") body = { ...base, subjectReference: String(data.get("subjectReference")), sourceAssetIds: split(data, "assetIds"), allowedPurposes: data.getAll("allowedPurposes").map(String), geographies: split(data, "geographies"), effectiveAt: new Date(String(data.get("effectiveAt"))).toISOString(), expiresAt: new Date(String(data.get("expiresAt"))).toISOString() };
    if (action === "bind_usage") body = { ...base, purpose: String(data.get("purpose")), resourceId: String(data.get("resourceId")) };
    if (action === "suspend") body = { ...base, reasonCode: String(data.get("reasonCode")) };
    if (action === "revoke_consent") body = { ...base, evidenceId: lifecycle[persona.id]?.activeConsentEvidenceId, reasonCode: String(data.get("reasonCode")) };
    await call(`/api/studio/personas/${encodeURIComponent(persona.id)}/commands`, body);
  }
  return <div className="space-y-7">
    <form onSubmit={create} className="grid gap-4 rounded-3xl border bg-card p-6 md:grid-cols-2">
      <h2 className="text-xl font-semibold md:col-span-2">{t("createTitle")}</h2>
      <Field name="name" label={t("fields.name")} /><Select name="kind" label={t("fields.kind")} options={["synthetic", "consented_likeness"]} t={t} prefix="kinds" />
      <Select name="language" label={t("fields.language")} options={["ar", "en"]} t={t} prefix="languages" /><Select name="variety" label={t("fields.variety")} options={[...ARABIC_VARIETIES]} t={t} prefix="varieties" />
      <Field name="disclosure" label={t("fields.disclosure")} /><Field name="retentionUntil" label={t("fields.retention")} type="datetime-local" />
      <button disabled={busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-300 font-semibold text-stone-950 md:col-span-2">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <UserRoundPlus className="size-4" />}{t("create")}</button>
    </form>
    {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <section className="grid gap-4 lg:grid-cols-2">{personas.map((persona) => <article key={persona.id} className="rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 dir="auto" className="font-semibold">{persona.name}</h2><p className="mt-1 text-xs text-muted-foreground">{t(`kinds.${persona.kind}`)} · v{persona.revision}</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs">{t(`states.${persona.state}`)}</span></div>
      <div className="mt-4 grid gap-2 text-sm"><p><ShieldCheck className="me-2 inline size-4 text-emerald-600" />{t("retention", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(persona.retentionUntil)) })}</p><p><CircleCheck className="me-2 inline size-4 text-emerald-600" />{persona.disclosure}</p></div>
      {persona.state === "consent_review" && persona.kind === "consented_likeness" && <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={(event) => submitCommand(event, persona, "record_consent")}><Field name="subjectReference" label={t("fields.subjectReference")} /><Field name="assetIds" label={t("fields.consentAssets")} /><Field name="geographies" label={t("fields.geographies")} /><Field name="effectiveAt" label={t("fields.effectiveAt")} type="datetime-local" /><Field name="expiresAt" label={t("fields.expiresAt")} type="datetime-local" /><fieldset className="grid gap-2 rounded-xl border p-3 text-sm sm:col-span-2"><legend className="px-1 font-medium">{t("fields.allowedPurposes")}</legend>{["training", "generation", "content_set", "channel", "blitz"].map((purpose) => <label key={purpose} className="flex items-center gap-2"><input type="checkbox" name="allowedPurposes" value={purpose} />{t(`purposes.${purpose}`)}</label>)}</fieldset><button className="min-h-10 rounded-lg border px-3 text-sm sm:col-span-2">{t("actions.recordConsent")}</button></form>}
      {!["deleted", "suspended"].includes(persona.state) && <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={(event) => submitCommand(event, persona, "attach_sources")}><Field name="assetIds" label={t("fields.assets")} /><Field name="consentEvidenceId" label={t("fields.consentEvidence")} required={false} /><button className="min-h-10 rounded-lg border px-3 text-sm sm:col-span-2">{t("actions.attachSources")}</button></form>}
      {persona.state === "consent_review" && <p className="mt-5 rounded-lg bg-muted p-3 text-xs leading-5">{t("evidenceBoundary")}</p>}
      {["ready_to_train", "training_failed"].includes(persona.state) && <div className="mt-5 grid gap-3"><p className="text-xs text-muted-foreground">{t("providerBoundary")}</p><button type="button" disabled={busy !== null} onClick={() => requestTraining(persona)} className="min-h-10 rounded-lg bg-stone-950 px-3 text-sm font-semibold text-white">{persona.state === "training_failed" ? t("actions.retryTraining") : t("actions.training")}</button></div>}
      {persona.state === "training" && <Link href="/studio/operations" className="mt-5 inline-flex min-h-10 w-full items-center justify-center rounded-lg border px-3 text-sm">{t("actions.viewOperations")}</Link>}
      {persona.state === "review" && <form className="mt-5" onSubmit={(event) => submitCommand(event, persona, "activate")}><button className="min-h-10 w-full rounded-lg bg-amber-300 px-3 text-sm font-semibold text-stone-950">{t("actions.active")}</button></form>}
      {persona.state === "active" && <><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={(event) => submitCommand(event, persona, "bind_usage")}><Select name="purpose" label={t("fields.purpose")} options={["generation", "content_set", "channel", "blitz"]} t={t} prefix="purposes" /><Field name="resourceId" label={t("fields.resource")} /><button className="min-h-10 rounded-lg border px-3 text-sm sm:col-span-2">{t("actions.bind")}</button></form><div className="mt-4 flex gap-3"><Link href={`/content?persona=${persona.id}`} className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg bg-amber-300 px-3 text-sm font-semibold text-stone-950">{t("usePersona")}</Link><form onSubmit={(event) => submitCommand(event, persona, "suspend")}><input type="hidden" name="reasonCode" value="workspace.manual_suspension" /><button className="min-h-10 rounded-lg border px-3 text-sm">{t("actions.suspended")}</button></form></div></>}
      {persona.state !== "deleted" && <form className="mt-4" onSubmit={(event) => submitCommand(event, persona, "delete")}><button className="text-xs text-destructive">{t("actions.deleted")}</button></form>}
      {lifecycle[persona.id]?.activeConsentEvidenceId && persona.state !== "deleted" && <form className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={(event) => submitCommand(event, persona, "revoke_consent")}><Field name="reasonCode" label={t("fields.revokeReason")} defaultValue="subject.withdrawn" pattern="[a-z][a-z0-9_.-]{2,99}" /><button className="self-end min-h-11 rounded-lg border border-destructive px-3 text-xs text-destructive">{t("actions.revokeConsent")}</button></form>}
    </article>)}{personas.length === 0 && <p className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground lg:col-span-2">{t("empty")}</p>}</section>
    {pendingTrainingQuote && <div role="dialog" aria-modal="true" aria-labelledby="persona-training-quote-title" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className="w-full max-w-md rounded-xl border bg-background p-5 shadow-xl"><h2 id="persona-training-quote-title" className="text-base font-semibold">{admissionT("managedQuote.title")}</h2><p className="mt-2 text-sm text-muted-foreground">{admissionT("managedQuote.description")}</p><dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><dt className="text-muted-foreground">{admissionT("managedQuote.creditDebit")}</dt><dd className="text-end font-medium">{new Intl.NumberFormat(locale).format(pendingTrainingQuote.quote.totalDebitUnits)}</dd><dt className="text-muted-foreground">{admissionT("managedQuote.subtotal")}</dt><dd className="text-end font-medium">{money(locale, pendingTrainingQuote.quote.subtotalMinor)}</dd><dt className="text-muted-foreground">{admissionT("managedQuote.tax")}</dt><dd className="text-end font-medium">{money(locale, pendingTrainingQuote.quote.taxMinor)}</dd><dt className="text-muted-foreground">{admissionT("managedQuote.total")}</dt><dd className="text-end font-semibold">{money(locale, pendingTrainingQuote.quote.totalMinor)}</dd><dt className="text-muted-foreground">{admissionT("managedQuote.expires")}</dt><dd className="text-end font-medium">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(pendingTrainingQuote.quote.expiresAt))}</dd></dl><p className="mt-3 break-all text-[10px] text-muted-foreground">{t("trainingQuoteBinding", { id: pendingTrainingQuote.quote.intentId })}</p><div className="mt-5 flex justify-end gap-2"><button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => setPendingTrainingQuote(null)}>{admissionT("managedQuote.decline")}</button><button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => requestTraining(pendingTrainingQuote.persona, pendingTrainingQuote)}>{admissionT("managedQuote.accept")}</button></div></div></div>}
  </div>;
}
const money = (locale: string, minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(minor / 100);
const split = (data: FormData, key: string) => String(data.get(key) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim() || null;
function Field({ name, label, type = "text", required = true, defaultValue, pattern }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; pattern?: string }) { return <label className="grid gap-2 text-sm font-medium">{label}<input name={name} type={type} required={required} defaultValue={defaultValue} pattern={pattern} dir="auto" className="min-h-11 rounded-xl border bg-background px-3 font-normal" /></label>; }
function Select({ name, label, options, t, prefix }: { name: string; label: string; options: string[]; t: (key: string) => string; prefix: string }) { return <label className="grid gap-2 text-sm font-medium">{label}<select name={name} className="min-h-11 rounded-xl border bg-background px-3 font-normal">{options.map((option) => <option key={option} value={option}>{t(`${prefix}.${option}`)}</option>)}</select></label>; }
