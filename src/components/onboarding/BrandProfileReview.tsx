import { useState } from "react";
import { AlertTriangle, Check, Pencil, ShieldCheck } from "lucide-react";
import type { BrandProfileCorrection, BrandProfileV1 } from "@/lib/onboarding/schemas";
import type { InterfaceLocale } from "@/lib/onboarding/contracts";
import { useOnboardingCopy } from "./copy";

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-stone-500">—</span>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm leading-6 text-stone-300">
          <Check className="mt-1 size-4 shrink-0 text-amber-300" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function BrandProfileReview({
  profile,
  locale: _locale,
  saving,
  onSave,
}: {
  profile: BrandProfileV1;
  locale: InterfaceLocale;
  saving: boolean;
  onSave(correction: BrandProfileCorrection): Promise<boolean>;
}) {
  const copy = useOnboardingCopy();
  const [correction, setCorrection] = useState<BrandProfileCorrection | null>(null);
  const labels = copy.profileLabels;

  const startEditing = () => {
    setCorrection({
      coreIdentity: profile.identity.coreIdentity,
      offering: profile.offering,
      benefits: profile.benefits,
      differentiators: profile.differentiators,
      mission: profile.mission,
      positioning: profile.positioning,
      ownedSpace: profile.ownedSpace,
      voice: profile.voice,
      prohibitedClaims: profile.prohibitedClaims,
      prohibitedTopics: profile.prohibitedTopics,
      contentAngles: profile.contentAngles,
      uncertainties: profile.uncertainties,
    });
  };

  if (correction) {
    const textClass =
      "mt-2 min-h-24 w-full rounded-xl border border-white/12 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-amber-300";
    const setLines = (key: keyof Pick<BrandProfileCorrection, "offering" | "benefits" | "differentiators" | "prohibitedClaims" | "prohibitedTopics" | "contentAngles" | "uncertainties">, value: string) => {
      setCorrection({
        ...correction,
        [key]: value.split("\n").map((line) => line.trim()).filter(Boolean),
      });
    };
    const fields = copy.profileFields;
    const lineFields = [
      ["offering", fields.offering], ["benefits", fields.benefits],
      ["differentiators", fields.differentiators], ["prohibitedClaims", fields.claims],
      ["prohibitedTopics", fields.topics], ["contentAngles", fields.angles],
      ["uncertainties", fields.uncertainties],
    ] as const;
    return (
      <form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); if (await onSave(correction)) setCorrection(null); }}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-stone-300">{fields.core}<textarea required className={textClass} value={correction.coreIdentity} onChange={(event) => setCorrection({ ...correction, coreIdentity: event.target.value })} /></label>
          <label className="text-sm text-stone-300">{fields.mission}<textarea required className={textClass} value={correction.mission} onChange={(event) => setCorrection({ ...correction, mission: event.target.value })} /></label>
          <label className="text-sm text-stone-300">{fields.positioning}<textarea required className={textClass} value={correction.positioning} onChange={(event) => setCorrection({ ...correction, positioning: event.target.value })} /></label>
          <label className="text-sm text-stone-300">{fields.owned}<textarea required className={textClass} value={correction.ownedSpace} onChange={(event) => setCorrection({ ...correction, ownedSpace: event.target.value })} /></label>
          {lineFields.map(([key, label]) => <label key={key} className="text-sm text-stone-300">{label}<textarea required={key === "offering"} className={textClass} value={correction[key].join("\n")} onChange={(event) => setLines(key, event.target.value)} /></label>)}
          {(["descriptors", "do", "doNot"] as const).map((key) => <label key={key} className="text-sm text-stone-300">{fields[key]}<textarea required={key === "descriptors"} className={textClass} value={correction.voice[key].join("\n")} onChange={(event) => setCorrection({ ...correction, voice: { ...correction.voice, [key]: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) } })} /></label>)}
        </div>
        <div className="flex flex-wrap gap-3">
          <button disabled={saving} className="rounded-xl bg-amber-300 px-5 py-3 text-sm font-bold text-stone-950 disabled:opacity-50">{copy.saveProfile}</button>
          <button type="button" disabled={saving} onClick={() => setCorrection(null)} className="rounded-xl border border-white/12 px-5 py-3 text-sm text-stone-200">{copy.cancel}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/8 p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
        <p className="text-sm leading-6 text-stone-300">{copy.profileSubtitle}</p>
      </div>
      <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
          {labels.identity}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white">{profile.identity.companyName}</h2>
        <p className="mt-2 text-sm leading-7 text-stone-300">{profile.identity.coreIdentity}</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          [labels.offering, profile.offering],
          [labels.benefits, profile.benefits],
          [labels.voice, profile.voice.descriptors],
          [labels.angles, profile.contentAngles],
        ].map(([label, items]) => (
          <section key={label as string} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">{label as string}</h3>
            <List items={items as string[]} />
          </section>
        ))}
      </div>
      <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <h3 className="text-sm font-semibold text-white">{labels.audiences}</h3>
        <div className="mt-3 space-y-3">
          {profile.audiences.map((audience) => (
            <div key={audience.name}>
              <div className="flex justify-between gap-4 text-sm text-stone-200">
                <span>{audience.name}</span><span>{audience.weight}%</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-stone-500">{audience.description}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <h3 className="text-sm font-semibold text-white">{labels.positioning}</h3>
        <p className="mt-2 text-sm leading-7 text-stone-300">{profile.positioning}</p>
      </section>
      {profile.uncertainties.length > 0 && (
        <section className="rounded-2xl border border-orange-400/20 bg-orange-400/[0.06] p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-orange-200">
            <AlertTriangle className="size-4" aria-hidden /> {labels.uncertainty}
          </h3>
          <div className="mt-3"><List items={profile.uncertainties} /></div>
        </section>
      )}
      <button type="button" onClick={startEditing} className="flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm text-stone-200 hover:border-amber-300/50"><Pencil className="size-4" />{copy.editProfile}</button>
    </div>
  );
}
