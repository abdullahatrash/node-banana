import Link from "next/link";
import { CheckIcon, SparklesIcon } from "lucide-react";
import arMessages from "@/i18n/messages/ar.json";
import enMessages from "@/i18n/messages/en.json";
import { DEFAULT_BILLING_PLANS, DEFAULT_CREDIT_PACKS, type CommercialLocale } from "@/lib/commercial/catalog";

type PricingPageProps = {
  locale: CommercialLocale;
  signInUrl: string;
  signUpUrl: string;
};

const messages = { ar: arMessages.pricing, en: enMessages.pricing } as const;
const format = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), template);

export function PricingPage({ locale, signInUrl, signUpUrl }: PricingPageProps) {
  const copy = messages[locale];
  const currency = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  return (
    <div lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-[#fbf7ef] text-[#102d2a]">
      <header className="border-b border-[#143f38]/10 bg-[#fbf7ef]/95">
        <nav aria-label={copy.navigation} className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
          <Link href={`/${locale}`} className="flex items-center gap-2.5 font-bold">
            <span className="flex size-9 items-center justify-center rounded-[13px] bg-[#0d4f45] text-lg text-[#fffaf0]">
              {copy.brandGlyph}
            </span>
            <span className="text-xl tracking-[-0.03em]">{copy.brand}</span>
          </Link>
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Link className="hidden text-[#294b46] hover:text-[#e75f45] sm:inline" href={`/${locale}`}>{copy.home}</Link>
            <Link className="hidden text-[#294b46] hover:text-[#e75f45] sm:inline" href={signInUrl}>{copy.signIn}</Link>
            <Link className="rounded-full bg-[#0d4f45] px-4 py-2.5 text-white hover:bg-[#0a4038]" href={signUpUrl}>{copy.start}</Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="px-5 pb-16 pt-16 text-center sm:px-8 sm:pt-24 lg:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#e75f45]">{copy.eyebrow}</p>
          <h1 className="mx-auto mt-5 max-w-4xl text-balance text-4xl font-bold tracking-[-0.05em] sm:text-6xl">{copy.title}</h1>
          <p className="mx-auto mt-6 max-w-3xl text-pretty text-lg leading-8 text-[#526a65]">{copy.description}</p>
        </section>

        <section aria-label={copy.title} className="mx-auto grid max-w-7xl gap-4 px-5 pb-20 sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:px-10">
          {DEFAULT_BILLING_PLANS.map((plan) => {
            const planCopy = copy.plans[plan.planId];
            const recommended = plan.planId === "growth";
            return (
              <article key={`${plan.planId}:${plan.version}`} className={`relative flex flex-col rounded-[28px] border p-6 ${recommended ? "border-[#e75f45] bg-white shadow-[0_22px_70px_rgba(16,45,42,0.14)]" : "border-[#143f38]/12 bg-white/60"}`}>
                {recommended ? <span className="absolute -top-3 start-5 rounded-full bg-[#e75f45] px-3 py-1 text-xs font-bold text-white">{copy.recommended}</span> : null}
                <p className="text-sm font-bold text-[#0d4f45]">{plan.authoredName[locale]}</p>
                <p className="mt-2 min-h-12 text-sm leading-6 text-[#607570]">{planCopy.tagline}</p>
                <div className="mt-5 flex items-end gap-2">
                  <strong className="text-4xl tracking-[-0.05em]">{plan.priceMinor === 0 ? copy.freePrice : currency.format(plan.priceMinor / 100)}</strong>
                  <span className="pb-1 text-xs text-[#607570]">{copy.monthly}</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-[#e75f45]">{format(copy.credits, { count: integer.format(plan.entitlements.generationCreditsPerPeriod) })}</p>
                <p className="mt-1 text-xs text-[#71847f]">{plan.trialDays > 0 ? format(copy.trial, { days: integer.format(plan.trialDays), credits: integer.format(plan.trialCreditUnits) }) : copy.noTrial}</p>
                <ul className="mt-6 flex-1 space-y-3">
                  {planCopy.features.map((feature) => <li className="flex gap-2 text-sm leading-6" key={feature}><CheckIcon className="mt-1 size-4 shrink-0 text-[#0d4f45]" aria-hidden="true" /><span>{feature}</span></li>)}
                </ul>
                <Link href={signUpUrl} className={`mt-7 inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-bold ${recommended ? "bg-[#e75f45] text-white hover:bg-[#d85139]" : "bg-[#0d4f45] text-white hover:bg-[#0a4038]"}`}>
                  {format(copy.choose, { plan: plan.authoredName[locale] })}
                </Link>
                <p className="mt-3 text-center text-[11px] text-[#71847f]">{format(copy.currentTerms, { version: plan.version })}</p>
              </article>
            );
          })}
        </section>

        <section className="border-y border-white/10 bg-[#102d2a] px-5 py-20 text-[#fffaf0] sm:px-8 lg:px-10">
          <div className="mx-auto max-w-7xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#a9d7c3]">{copy.packs.eyebrow}</p>
            <div className="mt-4 grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
              <div><h2 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{copy.packs.title}</h2><p className="mt-4 max-w-xl text-sm leading-7 text-white/65">{copy.packs.description}</p></div>
              <div className="grid gap-3 sm:grid-cols-3">
                {DEFAULT_CREDIT_PACKS.map((pack) => <article className="rounded-2xl border border-white/12 bg-white/6 p-5" key={`${pack.packId}:${pack.version}`}><p className="text-sm font-bold">{pack.authoredName[locale]}</p><p className="mt-4 text-2xl font-bold">{currency.format((pack.priceMinor + pack.taxMinor) / 100)}</p><p className="mt-1 text-xs text-white/55">{format(copy.packs.credits, { count: integer.format(pack.creditUnits) })} · {copy.packs.oneTime}</p></article>)}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-5 py-20 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:px-10">
          <h2 className="text-3xl font-bold tracking-[-0.04em]">{copy.boundary.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="rounded-2xl border border-[#143f38]/10 bg-white/55 p-5 text-sm leading-7 text-[#526a65]">{copy.boundary.managed}</p>
            <p className="rounded-2xl border border-[#143f38]/10 bg-white/55 p-5 text-sm leading-7 text-[#526a65]">{copy.boundary.byok}</p>
            <p className="text-xs leading-6 text-[#71847f] sm:col-span-2">{copy.boundary.tax}</p>
          </div>
        </section>

        <section className="px-5 pb-20 sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-7 rounded-[32px] bg-[#e75f45] p-8 text-white sm:p-10 lg:flex-row lg:items-center">
            <div><h2 className="text-3xl font-bold tracking-[-0.04em]">{copy.cta.title}</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-white/80">{copy.cta.description}</p></div>
            <Link href={signUpUrl} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-[#fffaf0] px-6 text-sm font-bold text-[#0d4f45] hover:bg-white">{copy.cta.action}<SparklesIcon className="size-4" aria-hidden="true" /></Link>
          </div>
        </section>
      </main>
    </div>
  );
}
