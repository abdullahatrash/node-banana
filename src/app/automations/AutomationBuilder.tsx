"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Archive, Check, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, Pause, Play, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import { ProductRequestError, productRequest } from "@/components/product-surfaces/ProductApi";
import type { CampaignAuthoringOptions, CampaignSelectorOption } from "@/lib/product-surfaces/campaign-authoring";
import type { WorkspaceCalendarPreferences } from "@/lib/product-surfaces/calendar-preferences";
import { ARABIC_VARIETIES, AUTOMATION_STEPS, CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";

type Automation = { id: string; title: string; state: string; revision: number; payload: Record<string, unknown> };
type Occurrence = { id: string; campaignId: string; state: string; scheduledAt: string; format: string; workflowRunId: string | null; quotedAmount: string | null; currency: string | null; failureCode: string | null; updatedAt: string };
type WorkflowBinding = { workflowId: string; workflowRevisionId: string; inputs: Record<string, string>; inputArtifactIds: string[] };
type CampaignDraft = {
  currentStep: number; name: string; formatMix: Record<string, number>; remixRatio: number; inspirationIds: string[];
  brandProfileRef: { id: string; revision: number; digest: string } | null; contentLanguage: "ar" | "en"; arabicVariety: string | null;
  personaIds: string[]; demoAssetIds: string[]; mediaSetIds: string[]; themeRevisionRefs: Array<{ themeId: string; revision: number; digest: string }>;
  channelIds: string[]; variantsPerChannel: number; cadence: { timezone: string; weekStart: number; startAt: string | null; endAt: string | null; postsPerWeek: number; calendarCapacity: number };
  execution: { mode: "managed" | "byok"; modelPolicy: string; creditCeiling: number; budgetCents: number; replenishmentMode: "daily" | "manual"; blitzTargetCapacity: number; blitzMaximumCreatesPerRun: number; workflow: WorkflowBinding | null };
  reviewMode: "request_human" | "evaluate_policy"; autoPublishGrantId: string | null; validationErrors: string[]; runtime: Record<string, unknown> | null;
};
type Admission = { admissible: boolean; denialReasons: string[]; warnings: string[]; evaluatedAt: string; quote?: { quoteId: string; amount: string; currency: string; expiresAt: string; maximumProviderAttempts: number; providerModels: Array<{ provider: string; model: string; pricePerAttempt: string; automaticAttempts: number }> } };
type Translator = (key: string, values?: Record<string, string | number>) => string;

const DEFAULT_MIX = Object.fromEntries(CONTENT_FORMATS.map((format) => [format, ["slideshow", "wall_of_text", "green_screen_meme", "video_hook_demo"].includes(format) ? 25 : 0]));
const MENA_TIMEZONES = ["Asia/Riyadh", "Asia/Dubai", "Asia/Qatar", "Asia/Kuwait", "Asia/Bahrain", "Asia/Muscat", "Africa/Cairo", "Africa/Casablanca", "Asia/Beirut", "Asia/Amman"];

function initialPayload(name: string, options: CampaignAuthoringOptions, calendarPreferences: WorkspaceCalendarPreferences): CampaignDraft {
  return {
    currentStep: 1, name, formatMix: { ...DEFAULT_MIX }, remixRatio: 50, inspirationIds: [],
    brandProfileRef: options.brand ? { id: options.brand.id, revision: options.brand.revision, digest: options.brand.digest } : null,
    contentLanguage: "ar", arabicVariety: "msa", personaIds: [], demoAssetIds: [], mediaSetIds: [], themeRevisionRefs: [], channelIds: [], variantsPerChannel: 1,
    cadence: { timezone: calendarPreferences.timezone, weekStart: calendarPreferences.weekStartsOn, startAt: null, endAt: null, postsPerWeek: 3, calendarCapacity: 20 },
    execution: { mode: "managed", modelPolicy: "workspace-default", creditCeiling: 20, budgetCents: 5000, replenishmentMode: "manual", blitzTargetCapacity: 20, blitzMaximumCreatesPerRun: 10, workflow: null },
    reviewMode: "request_human", autoPublishGrantId: null, validationErrors: [], runtime: null,
  };
}

function draft(value: Record<string, unknown>): CampaignDraft { return value as unknown as CampaignDraft; }
function localDate(value: string | null) { return value ? value.slice(0, 16) : ""; }
function isoDate(value: string) { if (!value) return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); }

export function AutomationBuilder({ automations, occurrences, options, calendarPreferences, selectedAutomationId }: { automations: Automation[]; occurrences: Occurrence[]; options: CampaignAuthoringOptions; calendarPreferences: WorkspaceCalendarPreferences; selectedAutomationId: string | null }) {
  const t = useTranslations("product.automations") as Translator;
  const router = useRouter();
  const selectedFromServer = selectedAutomationId ? automations.find((item) => item.id === selectedAutomationId) ?? null : null;
  const [record, setRecord] = useState<Automation | null>(selectedFromServer);
  const [payload, setPayload] = useState<CampaignDraft>(() => selectedFromServer ? draft(selectedFromServer.payload) : initialPayload(t("defaultName"), options, calendarPreferences));
  const [step, setStep] = useState(Number(selectedFromServer?.payload.currentStep ?? 1));
  const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false); const [error, setError] = useState(""); const [admission, setAdmission] = useState<Admission | null>(null);
  const latestPayload = useRef(payload); const busyRef = useRef(false); const saveIdempotencyKey = useRef<string | null>(null);
  latestPayload.current = payload;
  const canEdit = !record || record.state === "draft";
  const currentWorkflow = options.workflows.find((item) => item.revisionId === payload.execution.workflow?.workflowRevisionId) ?? null;
  const displayAutomations = useMemo(() => {
    if (!record) return automations;
    return automations.some((item) => item.id === record.id)
      ? automations.map((item) => item.id === record.id ? record : item)
      : [record, ...automations];
  }, [automations, record]);

  function change(mutator: (next: CampaignDraft) => void) {
    setPayload((current) => { const next = structuredClone(current); mutator(next); latestPayload.current = next; return next; });
    setDirty(true); setAdmission(null); setError("");
  }

  async function persist(snapshot: CampaignDraft, navigate: boolean): Promise<Automation | null> {
    if (busyRef.current || !canEdit) return null;
    busyRef.current = true; setBusy(true); setError("");
    try {
      saveIdempotencyKey.current ??= crypto.randomUUID();
      const result = await productRequest("/api/product-campaigns", { action: "save_draft", ...(record ? { id: record.id, expectedRevision: record.revision } : {}), title: snapshot.name, payload: snapshot, idempotencyKey: saveIdempotencyKey.current }) as { record: Automation };
      setRecord(result.record);
      saveIdempotencyKey.current = null;
      if (JSON.stringify(latestPayload.current) === JSON.stringify(snapshot)) setDirty(false);
      if (!record || navigate) router.replace(`/automations/${encodeURIComponent(result.record.id)}/edit`);
      router.refresh();
      return result.record;
    } catch (value) { setError(errorMessage(value, t)); return null; }
    finally { busyRef.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (!record || record.state !== "draft" || !dirty || busy) return;
    const snapshot = payload;
    const timer = window.setTimeout(() => { void persist(snapshot, false); }, 1_200);
    return () => window.clearTimeout(timer);
    // `persist` intentionally follows the latest optimistic record revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, record?.id, record?.revision, dirty, busy]);

  async function saveAndContinue(event: FormEvent) {
    event.preventDefault();
    const next = structuredClone(payload); next.currentStep = Math.min(step + 1, 10);
    const saved = await persist(next, !record);
    if (!saved) return;
    latestPayload.current = next; setPayload(next); setStep(next.currentStep); setDirty(false);
  }

  async function control(action: "activate" | "pause" | "resume" | "archive" | "discard", item = record) {
    if (!item || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await productRequest("/api/product-campaigns", { action, id: item.id, expectedRevision: item.revision, idempotencyKey: crypto.randomUUID() }) as { record: Automation };
      setRecord(result.record); setAdmission(null); setDirty(false);
      if (action === "archive" || action === "discard") router.replace("/automations");
      router.refresh();
    } catch (value) { setError(errorMessage(value, t)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function previewAdmission() {
    if (!record || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setAdmission(null);
    try { const result = await productRequest("/api/product-campaigns", { action: "preview", id: record.id, expectedRevision: record.revision }) as { admission: Admission }; setAdmission(result.admission); }
    catch (value) { setError(errorMessage(value, t)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function fillBlitz(item: Automation) { setBusy(true); setError(""); try { await productRequest("/api/blitz/replenish", { campaignId: item.id, idempotencyKey: crypto.randomUUID() }); router.refresh(); } catch (value) { setError(errorMessage(value, t)); } finally { setBusy(false); } }
  const mixTotal = Object.values(payload.formatMix).reduce((sum, value) => sum + value, 0);

  return <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
    <aside className="h-fit rounded-3xl border bg-card p-4"><p className="px-2 text-sm font-semibold">{t("stepsTitle")}</p><ol className="mt-3 space-y-1">{AUTOMATION_STEPS.map((key, index) => <li key={key}><button type="button" disabled={!record && index > 0} onClick={() => setStep(index + 1)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm disabled:cursor-not-allowed disabled:opacity-45 ${step === index + 1 ? "bg-amber-100 font-semibold text-amber-950" : "hover:bg-muted"}`}><span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${index + 1 < payload.currentStep ? "bg-emerald-600 text-white" : "bg-muted"}`}>{index + 1 < payload.currentStep ? <Check className="size-3" /> : index + 1}</span>{t(`steps.${key}`)}</button></li>)}</ol><p className="mt-4 rounded-xl bg-muted p-3 text-xs text-muted-foreground">{record ? t("durableDraft", { revision: record.revision }) : t("provisionalHelp")}</p></aside>
    <form onSubmit={saveAndContinue} className="min-w-0 rounded-3xl border bg-card p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-600">{t("step", { current: step, total: 10 })}</p><h2 className="mt-2 text-2xl font-semibold">{t(`steps.${AUTOMATION_STEPS[step - 1]}`)}</h2></div>{record ? <span className="rounded-full bg-muted px-3 py-1 text-xs">{t(`states.${record.state}`)} · v{record.revision}</span> : <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900">{t("provisional")}</span>}</div>
      <fieldset disabled={!canEdit || busy} className="mt-6 space-y-5 disabled:opacity-70">
        {step === 1 ? <Field label={t("fields.name")} value={payload.name} onChange={(value) => change((next) => { next.name = value; })} required /> : null}
        {step === 2 ? <div className="grid gap-4 sm:grid-cols-2">{CONTENT_FORMATS.map((format) => <NumberField key={format} label={t(`formats.${format}`)} value={payload.formatMix[format] ?? 0} min={0} max={100} onChange={(value) => change((next) => { next.formatMix[format] = value; })} />)}<p role="status" className={`sm:col-span-2 rounded-xl p-3 text-sm ${mixTotal === 100 ? "bg-emerald-50 text-emerald-900" : "bg-destructive/10 text-destructive"}`}>{t("mixTotal", { total: mixTotal })}</p></div> : null}
        {step === 3 ? <><NumberField label={t("fields.remix")} value={payload.remixRatio} min={0} max={100} onChange={(value) => change((next) => { next.remixRatio = value; })} /><MultiSelector legend={t("fields.inspiration")} empty={t("selectors.noInspiration")} options={options.inspirations} selected={payload.inspirationIds} onChange={(ids) => change((next) => { next.inspirationIds = ids; })} /></> : null}
        {step === 4 ? <><div className="rounded-xl border p-4"><p className="text-sm font-medium">{t("fields.brand")}</p>{options.brand ? <p className="mt-2 text-sm text-muted-foreground">{t("brandPinned", { revision: options.brand.revision })}<span dir="ltr" className="ms-2 font-mono text-xs">{options.brand.digest}</span></p> : <p role="alert" className="mt-2 text-sm text-destructive">{t("selectors.noBrand")}</p>}</div><SingleSelect label={t("fields.language")} value={payload.contentLanguage} options={[{ id: "ar", label: t("languages.ar"), detail: null }, { id: "en", label: t("languages.en"), detail: null }]} onChange={(value) => change((next) => { next.contentLanguage = value as "ar" | "en"; next.arabicVariety = value === "ar" ? next.arabicVariety ?? "msa" : null; })} /><SingleSelect label={t("fields.variety")} value={payload.arabicVariety ?? ""} disabled={payload.contentLanguage !== "ar"} options={ARABIC_VARIETIES.map((id) => ({ id, label: t(`varieties.${id}`), detail: null }))} onChange={(value) => change((next) => { next.arabicVariety = value || null; })} /></> : null}
        {step === 5 ? <><MultiSelector legend={t("fields.personas")} empty={t("selectors.noPersonas")} options={options.personas} selected={payload.personaIds} onChange={(ids) => change((next) => { next.personaIds = ids; })} /><MultiSelector legend={t("fields.demoMedia")} empty={t("selectors.noAssets")} options={options.demoAssets} selected={payload.demoAssetIds} onChange={(ids) => change((next) => { next.demoAssetIds = ids; })} /><MultiSelector legend={t("fields.mediaSets")} empty={t("selectors.noMediaSets")} options={options.mediaSets} selected={payload.mediaSetIds} onChange={(ids) => change((next) => { next.mediaSetIds = ids; })} /><MultiSelector legend={t("fields.themes")} empty={t("selectors.noThemes")} options={options.themes} selected={payload.themeRevisionRefs.map((item) => `${item.themeId}:${item.revision}`)} onChange={(ids) => change((next) => { next.themeRevisionRefs = ids.map((id) => options.themes.find((item) => item.id === id)).filter((item): item is CampaignAuthoringOptions["themes"][number] => Boolean(item)).map(({ themeId, revision, digest }) => ({ themeId, revision, digest })); })} /></> : null}
        {step === 6 ? <><MultiSelector legend={t("fields.channels")} empty={t("selectors.noChannels")} options={options.channels} selected={payload.channelIds} onChange={(ids) => change((next) => { next.channelIds = ids; next.autoPublishGrantId = null; next.reviewMode = "request_human"; })} /><NumberField label={t("fields.variants")} value={payload.variantsPerChannel} min={1} max={10} onChange={(value) => change((next) => { next.variantsPerChannel = value; })} /></> : null}
        {step === 7 ? <><SingleSelect label={t("fields.timezone")} value={payload.cadence.timezone} options={[...new Set([payload.cadence.timezone, ...MENA_TIMEZONES])].map((id) => ({ id, label: id, detail: null }))} onChange={(value) => change((next) => { next.cadence.timezone = value; })} /><SingleSelect label={t("fields.weekStart")} value={String(payload.cadence.weekStart)} options={[0, 1, 6].map((id) => ({ id: String(id), label: t(`weekdays.${id}`), detail: null }))} onChange={(value) => change((next) => { next.cadence.weekStart = Number(value); })} /><div className="grid gap-4 sm:grid-cols-2"><DateField label={t("fields.startAt")} value={localDate(payload.cadence.startAt)} onChange={(value) => change((next) => { next.cadence.startAt = isoDate(value); })} /><DateField label={t("fields.endAt")} value={localDate(payload.cadence.endAt)} onChange={(value) => change((next) => { next.cadence.endAt = isoDate(value); })} /><NumberField label={t("fields.frequency")} value={payload.cadence.postsPerWeek} min={1} max={100} onChange={(value) => change((next) => { next.cadence.postsPerWeek = value; })} /><NumberField label={t("fields.calendarCapacity")} value={payload.cadence.calendarCapacity} min={1} max={1000} onChange={(value) => change((next) => { next.cadence.calendarCapacity = value; })} /></div></> : null}
        {step === 8 ? <><div className="grid gap-4 sm:grid-cols-2"><SingleSelect label={t("fields.mode")} value={payload.execution.mode} options={["managed", "byok"].map((id) => ({ id, label: t(`modes.${id}`), detail: null }))} onChange={(value) => change((next) => { next.execution.mode = value as "managed" | "byok"; })} /><SingleSelect label={t("fields.modelPolicy")} value={payload.execution.modelPolicy} options={options.modelPolicies} onChange={(value) => change((next) => { next.execution.modelPolicy = value; })} /></div><SingleSelect label={t("fields.workflowRevisionId")} value={payload.execution.workflow?.workflowRevisionId ?? ""} emptyLabel={t("selectors.chooseWorkflow")} options={options.workflows} onChange={(value) => change((next) => { const selected = options.workflows.find((item) => item.revisionId === value); next.execution.workflow = selected ? { workflowId: selected.workflowId, workflowRevisionId: selected.revisionId, inputs: {}, inputArtifactIds: [] } : null; })} />{currentWorkflow ? <div className="space-y-4 rounded-xl border p-4"><p dir="ltr" className="text-xs text-muted-foreground">{currentWorkflow.workflowId} · {currentWorkflow.definitionDigest}</p>{currentWorkflow.inputs.filter((input) => input.kind === "text").map((input) => <Field key={input.name} label={input.name} value={payload.execution.workflow?.inputs[input.name] ?? ""} required={input.required} onChange={(value) => change((next) => { if (next.execution.workflow) next.execution.workflow.inputs[input.name] = value; })} />)}{currentWorkflow.inputs.some((input) => input.kind === "image") ? <MultiSelector legend={t("fields.workflowArtifacts")} empty={t("selectors.noAssets")} options={options.demoAssets} selected={payload.execution.workflow?.inputArtifactIds ?? []} onChange={(ids) => change((next) => { if (next.execution.workflow) next.execution.workflow.inputArtifactIds = ids; })} /> : null}</div> : null}<div className="grid gap-4 sm:grid-cols-2"><NumberField label={t("fields.credits")} value={payload.execution.creditCeiling} min={0} max={1_000_000} onChange={(value) => change((next) => { next.execution.creditCeiling = value; })} /><NumberField label={t("fields.budget")} value={payload.execution.budgetCents} min={0} max={100_000_000} onChange={(value) => change((next) => { next.execution.budgetCents = value; })} /><SingleSelect label={t("fields.replenishmentMode")} value={payload.execution.replenishmentMode} options={["daily", "manual"].map((id) => ({ id, label: t(`replenishmentModes.${id}`), detail: null }))} onChange={(value) => change((next) => { next.execution.replenishmentMode = value as "daily" | "manual"; })} /><NumberField label={t("fields.blitzTargetCapacity")} value={payload.execution.blitzTargetCapacity} min={1} max={100} onChange={(value) => change((next) => { next.execution.blitzTargetCapacity = value; })} /><NumberField label={t("fields.blitzMaximumCreatesPerRun")} value={payload.execution.blitzMaximumCreatesPerRun} min={1} max={50} onChange={(value) => change((next) => { next.execution.blitzMaximumCreatesPerRun = value; })} /></div><p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">{t("admissionBoundary")}</p></> : null}
        {step === 9 ? <><SingleSelect label={t("fields.reviewMode")} value={payload.reviewMode} options={["request_human", "evaluate_policy"].map((id) => ({ id, label: t(`reviewModes.${id}`), detail: null }))} onChange={(value) => change((next) => { next.reviewMode = value as "request_human" | "evaluate_policy"; next.autoPublishGrantId = null; })} />{payload.reviewMode === "evaluate_policy" ? <SingleSelect label={t("fields.grant")} value={payload.autoPublishGrantId ?? ""} emptyLabel={t("selectors.chooseGrant")} options={options.grants.filter((grant) => payload.channelIds.includes(grant.channelId))} onChange={(value) => change((next) => { next.autoPublishGrantId = value || null; })} /> : <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{t("humanReviewDefault")}</p>}</> : null}
        {step === 10 ? <ValidationStep payload={payload} record={record} admission={admission} options={options} busy={busy} t={t} onPreview={() => void previewAdmission()} /> : null}
      </fieldset>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={step === 1} onClick={() => setStep((value) => value - 1)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 disabled:opacity-40"><ChevronLeft className="size-4 rtl:rotate-180" />{t("back")}</button><div className="flex flex-wrap justify-end gap-2">{record && record.state === "draft" ? <button type="button" disabled={busy} onClick={() => void control("discard")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-destructive/30 px-4 text-sm text-destructive"><Trash2 className="size-4" />{t("discard")}</button> : null}{record && ["active", "paused", "validating"].includes(record.state) ? <button type="button" disabled={busy} onClick={() => void control("archive")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm"><Archive className="size-4" />{t("archive")}</button> : null}{step < 10 && canEdit ? <button disabled={busy || (step === 2 && mixTotal !== 100)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-300 px-5 font-semibold text-stone-950 disabled:opacity-45">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{t("saveContinue")}<ChevronRight className="size-4 rtl:rotate-180" /></button> : null}{step === 10 && record?.state === "draft" ? <button type="button" disabled={busy || !admission?.admissible} onClick={() => void control("activate")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 font-semibold text-white disabled:opacity-45"><Play className="size-4" />{t("activate")}</button> : null}{step === 10 && record?.state === "validating" ? <button type="button" disabled={busy} onClick={() => void control("activate")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-300 px-5 font-semibold text-stone-950"><RotateCcw className="size-4" />{t("recoverActivation")}</button> : null}{record?.state === "paused" ? <button type="button" disabled={busy} onClick={() => void control("resume")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 font-semibold text-white"><Play className="size-4" />{t("resume")}</button> : null}</div></div>{dirty && record?.state === "draft" ? <p role="status" className="mt-3 text-xs text-muted-foreground">{busy ? t("autosaving") : t("autosavePending")}</p> : null}{error ? <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
    </form>
    <aside className="space-y-5">{displayAutomations.length ? displayAutomations.map((item) => <CampaignSummary key={item.id} item={item} occurrences={occurrences} busy={busy} t={t} control={control} fillBlitz={fillBlitz} selected={item.id === record?.id} />) : <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">{t("noAutomations")}</div>}</aside>
  </div>;
}

function ValidationStep({ payload, record, admission, options, busy, t, onPreview }: { payload: CampaignDraft; record: Automation | null; admission: Admission | null; options: CampaignAuthoringOptions; busy: boolean; t: Translator; onPreview: () => void }) {
  const checks = [
    { ok: Object.values(payload.formatMix).reduce((sum, value) => sum + value, 0) === 100, label: t("validation.formatMix") },
    { ok: Boolean(payload.brandProfileRef && options.brand?.id === payload.brandProfileRef.id), label: t("validation.brand") },
    { ok: payload.channelIds.length > 0, label: t("validation.channels") },
    { ok: Boolean(payload.execution.workflow), label: t("validation.workflow") },
    { ok: payload.reviewMode === "request_human" || Boolean(payload.autoPublishGrantId), label: t("validation.review") },
  ];
  return <div className="space-y-4"><div className="space-y-2">{checks.map((check) => <div key={check.label} className={`flex items-center gap-3 rounded-xl p-3 text-sm ${check.ok ? "bg-emerald-50 text-emerald-900" : "bg-destructive/10 text-destructive"}`}>{check.ok ? <Check className="size-4" /> : <CircleAlert className="size-4" />}{check.label}</div>)}</div><p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">{t("activationBoundary")}</p><button type="button" disabled={!record || busy || checks.some((check) => !check.ok)} onClick={onPreview} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 font-semibold disabled:opacity-45">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{t("previewAdmission")}</button>{admission ? <div role="status" className={`rounded-xl border p-4 ${admission.admissible ? "border-emerald-300 bg-emerald-50" : "border-destructive/30 bg-destructive/5"}`}><p className="font-semibold">{admission.admissible ? t("admission.admitted") : t("admission.denied")}</p>{admission.quote ? <><p dir="ltr" className="mt-2 text-2xl font-semibold">{admission.quote.amount} {admission.quote.currency}</p><p className="mt-1 text-xs text-muted-foreground">{t("admission.expires", { time: admission.quote.expiresAt })}</p><ul className="mt-3 space-y-1 text-xs">{admission.quote.providerModels.map((model) => <li key={`${model.provider}:${model.model}`} dir="ltr">{model.provider} · {model.model} · {model.pricePerAttempt} × {model.automaticAttempts}</li>)}</ul></> : <ul className="mt-2 list-disc ps-5 text-sm">{admission.denialReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}</div> : null}</div>;
}

function CampaignSummary({ item, occurrences, busy, t, control, fillBlitz, selected }: { item: Automation; occurrences: Occurrence[]; busy: boolean; t: Translator; control: (action: "activate" | "pause" | "resume" | "archive" | "discard", item?: Automation | null) => Promise<void>; fillBlitz: (item: Automation) => Promise<void>; selected: boolean }) {
  const format = useFormatter(); const runtime = item.payload.runtime && typeof item.payload.runtime === "object" && !Array.isArray(item.payload.runtime) ? item.payload.runtime as Record<string, unknown> : null; const runId = typeof runtime?.runId === "string" ? runtime.runId : null; const recent = occurrences.filter((occurrence) => occurrence.campaignId === item.id).slice(0, 5);
  return <article className={`rounded-2xl border bg-card p-4 ${selected ? "ring-2 ring-amber-300" : ""}`}><div className="flex justify-between gap-3"><Link href={`/automations/${encodeURIComponent(item.id)}/edit`} className="font-semibold hover:underline"><span dir="auto">{item.title}</span></Link><span className="text-xs text-muted-foreground">v{item.revision}</span></div><p className="mt-2 text-sm text-muted-foreground">{t(`states.${item.state}`)}</p>{runId ? <Link href={`/studio/operations?selected=${encodeURIComponent(`workflow_run:${runId}`)}`} className="mt-3 block rounded-lg bg-muted p-3 text-xs"><span className="font-medium">{t("fields.workflowId")}</span><span dir="ltr" className="mt-1 block break-all font-mono text-muted-foreground">{runId}</span>{typeof runtime?.quotedAmount === "string" && typeof runtime?.currency === "string" ? <span dir="ltr" className="mt-1 block text-muted-foreground">{runtime.quotedAmount} {runtime.currency}</span> : null}</Link> : null}{item.state === "active" ? <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void control("pause", item)} className="inline-flex items-center gap-2 text-sm"><Pause className="size-4" />{t("pause")}</button><button type="button" disabled={busy} onClick={() => void fillBlitz(item)} className="inline-flex items-center gap-2 text-sm"><RefreshCw className="size-4" />{t("fillBlitz")}</button></div> : null}{item.state === "paused" ? <button type="button" disabled={busy} onClick={() => void control("resume", item)} className="mt-4 inline-flex items-center gap-2 text-sm"><Play className="size-4" />{t("resume")}</button> : null}<h3 className="mt-5 text-sm font-semibold">{t("occurrencesTitle")}</h3>{recent.length ? <ul className="mt-2 space-y-2">{recent.map((occurrence) => <li key={occurrence.id}><Link href={`/studio/operations?selected=${encodeURIComponent(`campaign_automation:${occurrence.id}`)}`} className="block rounded-lg bg-muted p-3 text-xs"><span className="flex justify-between gap-2"><span>{t(`occurrenceStates.${occurrence.state}`)}</span>{occurrence.quotedAmount && occurrence.currency ? <span dir="ltr">{occurrence.quotedAmount} {occurrence.currency}</span> : null}</span><time dateTime={occurrence.scheduledAt} className="mt-1 block text-muted-foreground">{format.dateTime(new Date(occurrence.scheduledAt), { dateStyle: "medium", timeStyle: "short" })}</time>{occurrence.failureCode ? <span className="mt-1 block text-destructive">{t("occurrenceFailure")}</span> : null}</Link></li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">{t("noOccurrences")}</p>}</article>;
}

function errorMessage(value: unknown, t: Translator) { return value instanceof ProductRequestError ? t(`errors.${value.code}`) : t("error"); }
function Field({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) { return <label className="grid gap-2 text-sm font-medium">{label}<input dir="auto" value={value} onChange={(event) => onChange(event.target.value)} required={required} className="min-h-11 rounded-xl border bg-background px-3 font-normal" /></label>; }
function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) { return <label className="grid gap-2 text-sm font-medium">{label}<input dir="ltr" type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className="min-h-11 rounded-xl border bg-background px-3 text-start" /></label>; }
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="grid gap-2 text-sm font-medium">{label}<input dir="ltr" type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 rounded-xl border bg-background px-3 text-start" /></label>; }
function SingleSelect({ label, value, options, onChange, emptyLabel, disabled = false }: { label: string; value: string; options: CampaignSelectorOption[]; onChange: (value: string) => void; emptyLabel?: string; disabled?: boolean }) { return <label className="grid gap-2 text-sm font-medium">{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="min-h-11 rounded-xl border bg-background px-3 font-normal">{emptyLabel ? <option value="">{emptyLabel}</option> : null}{options.map((option) => <option key={option.id} value={option.id}>{option.label}{option.detail ? ` · ${option.detail}` : ""}</option>)}</select></label>; }
function MultiSelector({ legend, empty, options, selected, onChange }: { legend: string; empty: string; options: CampaignSelectorOption[]; selected: string[]; onChange: (ids: string[]) => void }) { const selectedSet = new Set(selected); return <fieldset className="grid gap-2"><legend className="text-sm font-medium">{legend}</legend>{options.length ? <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border p-2">{options.map((option) => <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted"><input type="checkbox" checked={selectedSet.has(option.id)} onChange={() => onChange(selectedSet.has(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id])} className="mt-1" /><span className="min-w-0"><span dir="auto" className="block truncate text-sm font-medium">{option.label}</span>{option.detail ? <span dir="auto" className="block truncate text-xs text-muted-foreground">{option.detail}</span> : null}</span></label>)}</div> : <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">{empty}</p>}</fieldset>; }
