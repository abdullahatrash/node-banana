"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, FileText, Globe2, ImagePlus, Sparkles } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  ACQUISITION_SOURCES,
  BUSINESS_CATEGORIES,
  BUSINESS_MODELS,
  EXPECTED_OUTCOMES,
  MONTHLY_REVENUE_RANGES,
  ONBOARDING_STEPS,
  PROFESSIONAL_ROLES,
  SIGNUP_INTENTS,
  TEAM_SIZES,
  type InterfaceLocale,
} from "@/lib/onboarding/contracts";
import type { ParsedOnboardingSnapshot } from "@/lib/onboarding/schemas";
import { useDirectionStore } from "@/store/directionStore";
import { BrandProfileReview } from "./BrandProfileReview";
import { PreparationStatus } from "./PreparationStatus";
import { useOnboardingCopy, useOnboardingOptionLabels } from "./copy";
import { ChoiceGrid } from "./steps/ChoiceGrid";

interface ApiResponse {
  success: boolean;
  snapshot?: ParsedOnboardingSnapshot;
  code?: string;
  error?: string;
}

const inputClass =
  "mt-2 w-full rounded-2xl border border-white/12 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-stone-600 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20";

function localizedOptions<RecordType extends Record<string, string>>(
  record: RecordType,
) {
  return Object.entries(record).map(([value, label]) => ({
    value: value as keyof RecordType & string,
    label,
  }));
}

function toggle<Value extends string>(values: Value[], value: Value): Value[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

export function OnboardingFlow() {
  const router = useRouter();
  const locale = useDirectionStore((state) => state.locale) as InterfaceLocale;
  const copy = useOnboardingCopy();
  const optionLabels = useOnboardingOptionLabels();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [snapshot, setSnapshot] = useState<ParsedOnboardingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<"website" | "description">("website");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contentLanguage, setContentLanguage] = useState("ar");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [teamSize, setTeamSize] = useState<(typeof TEAM_SIZES)[number] | null>(null);
  const [revenue, setRevenue] = useState<(typeof MONTHLY_REVENUE_RANGES)[number] | null>(null);
  const [role, setRole] = useState<(typeof PROFESSIONAL_ROLES)[number] | null>(null);
  const [otherRole, setOtherRole] = useState("");
  const [businessModel, setBusinessModel] = useState<(typeof BUSINESS_MODELS)[number] | null>(null);
  const [categories, setCategories] = useState<Array<(typeof BUSINESS_CATEGORIES)[number]>>([]);
  const [otherCategory, setOtherCategory] = useState("");
  const [intent, setIntent] = useState<(typeof SIGNUP_INTENTS)[number] | null>(null);
  const [outcomes, setOutcomes] = useState<Array<(typeof EXPECTED_OUTCOMES)[number]>>([]);
  const [otherOutcome, setOtherOutcome] = useState("");
  const [sources, setSources] = useState<Array<(typeof ACQUISITION_SOURCES)[number]>>([]);
  const [otherSource, setOtherSource] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const hydrate = useCallback((next: ParsedOnboardingSnapshot) => {
    setSnapshot(next);
    const answers = next.answers;
    if (answers.identity) {
      setFullName(answers.identity.fullName);
      setCompanyName(answers.identity.companyName);
      setContentLanguage(answers.identity.contentLanguage ?? next.contentLanguage);
    } else {
      setContentLanguage(next.contentLanguage);
    }
    if (answers.brandSource?.kind === "website") {
      setSourceKind("website");
      setWebsite(answers.brandSource.url);
    } else if (answers.brandSource?.kind === "description") {
      setSourceKind("description");
      setDescription(answers.brandSource.description);
    }
    if (answers.companyStage) {
      setTeamSize(answers.companyStage.teamSize);
      setRevenue(answers.companyStage.monthlyRevenue);
    }
    if (answers.role) {
      setRole(answers.role.role);
      setOtherRole(answers.role.otherRole ?? "");
    }
    if (answers.businessClassification) {
      setBusinessModel(answers.businessClassification.businessModel);
      setCategories(answers.businessClassification.categories);
      setOtherCategory(answers.businessClassification.otherCategory ?? "");
    }
    if (answers.goals) {
      setIntent(answers.goals.signupIntent);
      setOutcomes(answers.goals.expectedOutcomes);
      setOtherOutcome(answers.goals.otherOutcome ?? "");
    }
    if (answers.attribution) {
      setSources(answers.attribution.sources);
      setOtherSource(answers.attribution.otherSource ?? "");
    }
  }, []);

  const fetchSnapshot = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/onboarding", { cache: "no-store" });
      const body = (await response.json()) as ApiResponse;
      if (response.status === 401) {
        router.replace("/sign-in?next=/onboarding");
        return;
      }
      if (body.code === "EMAIL_VERIFICATION_REQUIRED") {
        router.replace("/verify-email");
        return;
      }
      if (!response.ok || !body.snapshot) throw new Error(body.error);
      if (body.snapshot.status === "completed" || body.snapshot.status === "completed_legacy") {
        router.replace("/dashboard");
        return;
      }
      hydrate(body.snapshot);
      setError(null);
    } catch (requestError) {
      if (!quiet) {
        setError(requestError instanceof Error && requestError.message ? requestError.message : copy.error);
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [copy.error, hydrate, router]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    const analysis = snapshot?.analysis;
    if (!analysis || (analysis.status !== "queued" && analysis.status !== "running")) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let delay = 2_000;
    const poll = async () => {
      if (document.visibilityState === "visible") await fetchSnapshot(true);
      if (cancelled) return;
      delay = Math.min(Math.round(delay * 1.5), 10_000);
      timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, delay);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchSnapshot(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchSnapshot, snapshot?.analysis]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [snapshot?.currentStep]);

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  const send = useCallback(async (
    type: string,
    payload: unknown,
    baseSnapshot: ParsedOnboardingSnapshot | null = snapshot,
  ): Promise<ParsedOnboardingSnapshot | null> => {
    if (!baseSnapshot || submitting) return null;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          expectedRevision: baseSnapshot.revision,
          idempotencyKey: crypto.randomUUID(),
          payload,
        }),
      });
      const body = (await response.json()) as ApiResponse;
      if (!response.ok || !body.snapshot) {
        if (response.status === 409) await fetchSnapshot(true);
        throw new Error(body.error);
      }
      hydrate(body.snapshot);
      return body.snapshot;
    } catch (submitError) {
      setError(submitError instanceof Error && submitError.message ? submitError.message : copy.error);
      return null;
    } finally {
      setSubmitting(false);
    }
  }, [copy.error, fetchSnapshot, hydrate, snapshot, submitting]);

  const goBack = () => void send("go_back", {});
  const backButton = () => (
    <button type="button" disabled={submitting} onClick={goBack} className="mt-4 flex items-center gap-2 text-sm text-stone-400 hover:text-white disabled:opacity-50">
      {locale === "ar" ? <ArrowRight className="size-4" /> : <ArrowLeft className="size-4" />}{copy.back}
    </button>
  );

  const stepIndex = snapshot ? ONBOARDING_STEPS.indexOf(snapshot.currentStep) : 0;
  const directionIcon = locale === "ar" ? ArrowLeft : ArrowRight;
  const ContinueIcon = directionIcon;
  const progress = useMemo(() => Math.max(0, stepIndex) / (ONBOARDING_STEPS.length - 1), [stepIndex]);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#100e0c] text-stone-300">
        <div className="flex items-center gap-3"><Sparkles className="size-5 animate-pulse text-amber-300" />{copy.loading}</div>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#100e0c] px-5 text-stone-100">
        <div className="text-center"><p>{error ?? copy.error}</p><button className="mt-4 text-amber-300 underline" onClick={() => void fetchSnapshot()}>{copy.retry}</button></div>
      </main>
    );
  }

  const submitButton = (disabled = false, label = copy.continue) => (
    <button
      type="submit"
      disabled={disabled || submitting}
      className="mt-7 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 py-3 text-sm font-bold text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {submitting ? copy.saving : label}
      {!submitting && <ContinueIcon className="size-4" aria-hidden />}
    </button>
  );

  let content: React.ReactNode;
  switch (snapshot.currentStep) {
    case "identity":
      content = (
        <form onSubmit={async (event) => {
          event.preventDefault();
          const next = await send("save_identity", {
            fullName,
            companyName,
            logoAssetId: snapshot.answers.identity?.logoAssetId ?? null,
            interfaceLocale: locale,
            contentLanguage,
          });
          if (!next || !logoFile) return;
          setSubmitting(true);
          try {
            const form = new FormData();
            form.set("logo", logoFile);
            const response = await fetch("/api/onboarding/logo", { method: "POST", body: form });
            const body = (await response.json()) as { success: boolean; assetId?: string; error?: string };
            if (!response.ok || !body.assetId) throw new Error(body.error);
            await send("save_logo", { assetId: body.assetId }, next);
            setLogoFile(null);
            if (logoPreview) URL.revokeObjectURL(logoPreview);
            setLogoPreview(null);
          } catch (uploadError) {
            setError(uploadError instanceof Error && uploadError.message ? uploadError.message : copy.error);
          } finally {
            setSubmitting(false);
          }
        }}>
          <h2 className="text-2xl font-semibold text-white">{copy.identityTitle}</h2>
          <div className="mt-6 space-y-5">
            <label className="block text-sm text-stone-300">{copy.fullName}<input className={inputClass} required minLength={2} maxLength={120} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
            <label className="block text-sm text-stone-300">{copy.companyName}<input className={inputClass} required minLength={1} maxLength={160} value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></label>
            <label className="block text-sm text-stone-300">
              {copy.logo}
              <span className="mt-2 flex min-h-24 cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-4 hover:border-amber-300/50">
                {logoPreview ? <Image src={logoPreview} alt="" width={64} height={64} unoptimized className="size-16 rounded-xl object-cover" /> : <span className="grid size-16 place-items-center rounded-xl bg-white/5"><ImagePlus className="size-6 text-stone-500" /></span>}
                <span><span className="block font-medium text-stone-200">{copy.uploadLogo}</span><span className="mt-1 block text-xs text-stone-500">{copy.logoHelp}</span></span>
              </span>
              <input className="sr-only" type="file" accept="image/png,image/jpeg" onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file && (!(["image/png", "image/jpeg"] as string[]).includes(file.type) || file.size > 5 * 1024 * 1024)) {
                  setError(copy.logoHelp);
                  event.target.value = "";
                  return;
                }
                if (logoPreview) URL.revokeObjectURL(logoPreview);
                setLogoFile(file);
                setLogoPreview(file ? URL.createObjectURL(file) : null);
                setError(null);
              }} />
            </label>
            <fieldset><legend className="mb-3 text-sm text-stone-300">{copy.contentLanguage}</legend><ChoiceGrid columns={2} options={[{ value: "ar", label: copy.arabic }, { value: "en", label: copy.english }]} value={contentLanguage as "ar" | "en"} onChange={setContentLanguage} /></fieldset>
          </div>
          {submitButton(!fullName.trim() || !companyName.trim())}
        </form>
      );
      break;
    case "brand_source":
      content = (
        <form onSubmit={(event) => { event.preventDefault(); void send("set_brand_source", sourceKind === "website" ? { kind: "website", url: website } : { kind: "description", description }); }}>
          <h2 className="text-2xl font-semibold text-white">{copy.sourceTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-stone-400">{copy.sourceSubtitle}</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {(["website", "description"] as const).map((kind) => (
              <button type="button" key={kind} onClick={() => setSourceKind(kind)} aria-pressed={sourceKind === kind} className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm ${sourceKind === kind ? "border-amber-300 bg-amber-300 text-stone-950" : "border-white/12 bg-white/5 text-stone-200"}`}>
                {kind === "website" ? <Globe2 className="size-4" /> : <FileText className="size-4" />}{copy[kind]}
              </button>
            ))}
          </div>
          {sourceKind === "website" ? (
            <label className="mt-6 block text-sm text-stone-300">{copy.website}<input dir="ltr" className={inputClass} required type="url" maxLength={2048} placeholder={copy.websitePlaceholder} value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
          ) : (
            <label className="mt-6 block text-sm text-stone-300">{copy.description}<textarea className={`${inputClass} min-h-40 resize-y`} required minLength={20} maxLength={50000} placeholder={copy.descriptionPlaceholder} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          )}
          {submitButton(sourceKind === "website" ? !website : description.trim().length < 20)}
          {backButton()}
        </form>
      );
      break;
    case "company_stage":
      content = (
        <form onSubmit={(event) => { event.preventDefault(); if (teamSize && revenue) void send("save_company_stage", { teamSize, monthlyRevenue: revenue }); }}>
          <h2 className="text-2xl font-semibold text-white">{copy.teamTitle}</h2>
          <fieldset className="mt-6"><legend className="mb-3 text-sm font-medium text-stone-300">{copy.teamSize}</legend><ChoiceGrid options={localizedOptions(optionLabels.teamSize)} value={teamSize ?? undefined} onChange={setTeamSize} /></fieldset>
          <fieldset className="mt-7"><legend className="mb-3 text-sm font-medium text-stone-300">{copy.revenue}</legend><ChoiceGrid options={localizedOptions(optionLabels.revenue)} value={revenue ?? undefined} onChange={setRevenue} /></fieldset>
          {submitButton(!teamSize || !revenue)}
          {backButton()}
        </form>
      );
      break;
    case "role":
      content = (
        <form onSubmit={(event) => { event.preventDefault(); if (role) void send("save_role", { role, ...(role === "other" ? { otherRole } : {}) }); }}>
          <h2 className="text-2xl font-semibold text-white">{copy.roleTitle}</h2>
          <div className="mt-6"><ChoiceGrid columns={2} options={localizedOptions(optionLabels.roles)} value={role ?? undefined} onChange={setRole} /></div>
          {role === "other" && <input className={inputClass} required maxLength={120} value={otherRole} onChange={(e) => setOtherRole(e.target.value)} />}
          {submitButton(!role || (role === "other" && !otherRole.trim()))}
          {backButton()}
        </form>
      );
      break;
    case "business_classification":
      content = (
        <form onSubmit={(event) => { event.preventDefault(); if (businessModel) void send("save_business_classification", { businessModel, categories, ...(categories.includes("other") ? { otherCategory } : {}) }); }}>
          <h2 className="text-2xl font-semibold text-white">{copy.businessTitle}</h2>
          <fieldset className="mt-6"><legend className="mb-3 text-sm font-medium text-stone-300">{copy.businessModel}</legend><ChoiceGrid options={localizedOptions(optionLabels.models)} value={businessModel ?? undefined} onChange={setBusinessModel} /></fieldset>
          <fieldset className="mt-7"><legend className="mb-3 text-sm font-medium text-stone-300">{copy.categories}</legend><ChoiceGrid columns={2} options={localizedOptions(optionLabels.categories)} values={categories} onChange={(value) => setCategories(toggle(categories, value))} /></fieldset>
          {categories.includes("other") && <input className={inputClass} required maxLength={120} value={otherCategory} onChange={(e) => setOtherCategory(e.target.value)} />}
          {submitButton(!businessModel || categories.length === 0 || (categories.includes("other") && !otherCategory.trim()))}
          {backButton()}
        </form>
      );
      break;
    case "goals":
      content = (
        <form onSubmit={(event) => { event.preventDefault(); if (intent) void send("save_goals", { signupIntent: intent, expectedOutcomes: outcomes, ...(outcomes.includes("other") ? { otherOutcome } : {}) }); }}>
          <h2 className="text-2xl font-semibold text-white">{copy.goalsTitle}</h2>
          <fieldset className="mt-6"><legend className="mb-3 text-sm font-medium text-stone-300">{copy.intent}</legend><ChoiceGrid options={localizedOptions(optionLabels.intents)} value={intent ?? undefined} onChange={setIntent} /></fieldset>
          <fieldset className="mt-7"><legend className="mb-3 text-sm font-medium text-stone-300">{copy.outcomes}</legend><ChoiceGrid columns={2} options={localizedOptions(optionLabels.outcomes)} values={outcomes} onChange={(value) => setOutcomes(toggle(outcomes, value))} /></fieldset>
          {outcomes.includes("other") && <input className={inputClass} required maxLength={240} value={otherOutcome} onChange={(e) => setOtherOutcome(e.target.value)} />}
          {submitButton(!intent || outcomes.length === 0 || (outcomes.includes("other") && !otherOutcome.trim()))}
          {backButton()}
        </form>
      );
      break;
    case "attribution":
      content = (
        <form onSubmit={(event) => { event.preventDefault(); void send("save_attribution", { sources, ...(sources.includes("other") ? { otherSource } : {}) }); }}>
          <h2 className="text-2xl font-semibold text-white">{copy.attributionTitle}</h2>
          <p className="mt-2 text-sm text-stone-500">{copy.attributionSubtitle}</p>
          <div className="mt-6"><ChoiceGrid columns={3} options={localizedOptions(optionLabels.sources)} values={sources} onChange={(value) => setSources(toggle(sources, value))} /></div>
          {sources.includes("other") && <input className={inputClass} required maxLength={160} value={otherSource} onChange={(e) => setOtherSource(e.target.value)} />}
          {submitButton(sources.includes("other") && !otherSource.trim())}
          {backButton()}
        </form>
      );
      break;
    case "review": {
      const failed = snapshot.analysis?.status.startsWith("failed_");
      const ready = snapshot.analysis?.status === "ready" && snapshot.draftBrandProfile;
      content = (
        <div>
          <h2 className="text-2xl font-semibold text-white">{failed ? copy.sourceFailed : copy.profileTitle}</h2>
          {failed ? (
            <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-5"><p className="text-sm leading-6 text-stone-300">{copy.sourceFailedDetail}</p><div className="mt-5 flex flex-wrap gap-3"><button disabled={submitting} onClick={() => void send("retry_analysis", {})} className="rounded-xl bg-amber-300 px-5 py-3 text-sm font-bold text-stone-950 disabled:opacity-50">{copy.retry}</button><button disabled={submitting} onClick={() => void send("change_brand_source", {})} className="rounded-xl border border-white/15 px-5 py-3 text-sm text-white disabled:opacity-50">{copy.changeSource}</button></div></div>
          ) : ready ? (
            <><div className="mt-6"><BrandProfileReview profile={snapshot.draftBrandProfile!} locale={locale} saving={submitting} onSave={async (correction) => Boolean(await send("edit_brand_profile", { profileId: snapshot.draftBrandProfileId, correction }))} /></div><button disabled={submitting} onClick={() => void send("accept_brand_profile", { profileId: snapshot.draftBrandProfileId })} className="mt-7 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 py-3 text-sm font-bold text-stone-950 disabled:opacity-40">{submitting ? copy.saving : copy.acceptProfile}<ContinueIcon className="size-4" /></button><button disabled={submitting} onClick={() => void send("change_brand_source", {})} className="mt-4 text-sm text-stone-400 underline hover:text-white">{copy.changeSource}</button></>
          ) : (
            <div className="mt-8 flex flex-col items-center rounded-3xl border border-white/10 bg-white/[0.035] px-6 py-14 text-center"><Sparkles className="size-8 animate-pulse text-amber-300" /><p className="mt-4 font-semibold text-white">{copy.preparing}</p><p className="mt-2 max-w-md text-sm leading-6 text-stone-500">{copy.preparingDetail}</p></div>
          )}
          {!ready && !failed && backButton()}
        </div>
      );
      break;
    }
    case "education":
      content = (
        <div className="text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-amber-300 text-stone-950"><Sparkles className="size-7" /></div>
          <h2 className="mt-6 text-3xl font-semibold text-white">{copy.educationTitle}</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-stone-400">{copy.educationSubtitle}</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">{[Globe2, Building2, FileText].map((Icon, index) => <div key={index} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><Icon className="mx-auto size-5 text-amber-300" /><p className="mt-3 text-xs text-stone-400">{copy.educationFeatures[index]}</p></div>)}</div>
          <button disabled={submitting} onClick={async () => { if (await send("complete", {})) router.replace("/dashboard"); }} className="mt-8 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 py-3 text-sm font-bold text-stone-950 disabled:opacity-40">{submitting ? copy.saving : copy.finish}<ContinueIcon className="size-4" /></button>
        </div>
      );
      break;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#100e0c] px-4 py-8 text-stone-100 sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(217,119,6,0.24),transparent_38%),linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:auto,36px_36px,36px_36px]" />
      <PreparationStatus analysis={snapshot.analysis} locale={locale} />
      <div className="relative mx-auto max-w-4xl">
        <header className="flex items-center justify-between gap-4"><div className="text-sm font-bold tracking-tight text-white">tasmeem<span className="text-amber-300">ai</span></div><LanguageSwitcher className="border border-white/10 bg-white/5 text-stone-200 hover:bg-white/10" /></header>
        <div className="mx-auto mt-12 max-w-2xl text-center"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">{copy.eyebrow}</p><h1 ref={headingRef} tabIndex={-1} className="mt-3 text-3xl font-semibold tracking-tight text-white outline-none sm:text-5xl">{copy.title}</h1><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-stone-400">{copy.subtitle}</p></div>
        <div className="mx-auto mt-8 h-1.5 max-w-xl overflow-hidden rounded-full bg-white/8" aria-label={`${stepIndex + 1} / ${ONBOARDING_STEPS.length}`}><div className="h-full rounded-full bg-amber-300 transition-[width] duration-500" style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>
        <section className="mx-auto mt-8 max-w-3xl rounded-[2rem] border border-white/12 bg-[#1a1714]/88 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">{content}{error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}</section>
      </div>
    </main>
  );
}
