import { AlertTriangle, Check, ShieldCheck } from "lucide-react";
import type { BrandProfileV1 } from "@/lib/onboarding/schemas";
import type { InterfaceLocale } from "@/lib/onboarding/contracts";
import { copyFor } from "./copy";

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
  locale,
}: {
  profile: BrandProfileV1;
  locale: InterfaceLocale;
}) {
  const copy = copyFor(locale);
  const labels =
    locale === "ar"
      ? {
          identity: "جوهر العلامة",
          offering: "ما الذي تقدمه",
          audiences: "الجمهور",
          benefits: "الفوائد",
          positioning: "التموضع",
          voice: "نبرة الصوت",
          angles: "زوايا المحتوى",
          uncertainty: "نقاط تحتاج إلى مراجعتك",
        }
      : {
          identity: "Brand essence",
          offering: "Offering",
          audiences: "Audiences",
          benefits: "Benefits",
          positioning: "Positioning",
          voice: "Voice",
          angles: "Content angles",
          uncertainty: "Items requiring your review",
        };

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
    </div>
  );
}
