"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, LoaderCircle, Save } from "lucide-react";
import type { BrandProfileV1 } from "@/lib/onboarding/schemas";
import { getActiveWorkspaceId } from "@/lib/studio/client";

export function BrandEditor({ activeRevision, profile, draft }: { activeRevision: number; profile: BrandProfileV1; draft: { id: string; revision: number } | null }) {
  const t = useTranslations("product.brand");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [currentDraft, setCurrentDraft] = useState(draft);
  const [editing, setEditing] = useState(false);
  const headers = () => ({ "content-type": "application/json", "x-workspace-id": getActiveWorkspaceId() ?? "" });
  const lines = (value: FormDataEntryValue | null) => String(value ?? "").split("\n").map((item) => item.trim()).filter(Boolean);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const correction = {
      coreIdentity: String(data.get("coreIdentity")), offering: lines(data.get("offering")), benefits: lines(data.get("benefits")), differentiators: lines(data.get("differentiators")), mission: String(data.get("mission")), positioning: String(data.get("positioning")), ownedSpace: String(data.get("ownedSpace")),
      voice: { descriptors: lines(data.get("descriptors")), do: lines(data.get("voiceDo")), doNot: lines(data.get("voiceDoNot")) },
      prohibitedClaims: lines(data.get("prohibitedClaims")), prohibitedTopics: lines(data.get("prohibitedTopics")), contentAngles: lines(data.get("contentAngles")), uncertainties: lines(data.get("uncertainties")),
    };
    try {
      const response = await fetch("/api/brand/profile", { method: "POST", headers: headers(), body: JSON.stringify({ action: "create_revision", expectedActiveRevision: activeRevision, correction, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as { success: boolean; error?: string; profileId?: string; revision?: number };
      if (!response.ok || !result.profileId || !result.revision) throw new Error(result.error || t("error"));
      setCurrentDraft({ id: result.profileId, revision: result.revision }); setEditing(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("error")); } finally { setBusy(false); }
  }

  async function activate() {
    if (!currentDraft) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/brand/profile", { method: "POST", headers: headers(), body: JSON.stringify({ action: "activate_revision", profileId: currentDraft.id, expectedRevision: currentDraft.revision, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as { success: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || t("error"));
      setCurrentDraft(null); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("error")); } finally { setBusy(false); }
  }

  return <section className="rounded-3xl border bg-card p-6 sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{t("editorTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("editorHelp")}</p></div>{currentDraft ? <button onClick={activate} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-50"><Check className="size-4" />{t("approveRevision", { revision: currentDraft.revision })}</button> : <button onClick={() => setEditing((value) => !value)} className="min-h-11 rounded-xl border px-4 font-semibold">{editing ? t("cancel") : t("edit")}</button>}</div>
    {currentDraft && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("draftReady", { revision: currentDraft.revision })}</p>}
    {editing && <form onSubmit={save} className="mt-6 grid gap-5 lg:grid-cols-2">
      <Field name="coreIdentity" label={t("fields.identity")} value={profile.identity.coreIdentity} />
      <Field name="mission" label={t("fields.mission")} value={profile.mission} />
      <Field name="positioning" label={t("fields.positioning")} value={profile.positioning} />
      <Field name="ownedSpace" label={t("fields.ownedSpace")} value={profile.ownedSpace} />
      <Field name="offering" label={t("fields.offering")} value={profile.offering.join("\n")} />
      <Field name="benefits" label={t("fields.benefits")} value={profile.benefits.join("\n")} />
      <Field name="differentiators" label={t("fields.differentiators")} value={profile.differentiators.join("\n")} />
      <Field name="descriptors" label={t("fields.voice")} value={profile.voice.descriptors.join("\n")} />
      <Field name="voiceDo" label={t("fields.do")} value={profile.voice.do.join("\n")} />
      <Field name="voiceDoNot" label={t("fields.doNot")} value={profile.voice.doNot.join("\n")} />
      <Field name="prohibitedClaims" label={t("fields.claims")} value={profile.prohibitedClaims.join("\n")} />
      <Field name="prohibitedTopics" label={t("fields.topics")} value={profile.prohibitedTopics.join("\n")} />
      <Field name="contentAngles" label={t("fields.angles")} value={profile.contentAngles.join("\n")} />
      <Field name="uncertainties" label={t("fields.uncertainties")} value={profile.uncertainties.join("\n")} />
      <button disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 font-semibold text-stone-950 disabled:opacity-50 lg:col-span-2">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{t("saveDraft")}</button>
    </form>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
  </section>;
}

function Field({ name, label, value }: { name: string; label: string; value: string }) { return <label className="grid gap-2 text-sm font-medium">{label}<textarea dir="auto" name={name} defaultValue={value} required className="min-h-28 rounded-xl border bg-background p-3 font-normal" /></label>; }

