import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  Globe2Icon,
  PlayIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import arMessages from "@/i18n/messages/ar.json";
import enMessages from "@/i18n/messages/en.json";
import type { Locale } from "@/store/directionStore";
import styles from "./marketing-home.module.css";

interface MarketingHomeProps {
  locale: Locale;
  contentStudioUrl: string;
  signInUrl: string;
  signUpUrl: string;
}

const arabicCopy = arMessages.marketingHome;
const englishCopy = enMessages.marketingHome;

const showcaseImages = [
  "/sample-images/new-bg-model-product.png",
  "/sample-images/desert.jpg",
  "/sample-images/cosmetics.jpg",
  "/sample-images/model-3.jpg",
];

export function MarketingHome({
  locale,
  contentStudioUrl,
  signInUrl,
  signUpUrl,
}: MarketingHomeProps) {
  const copy = locale === "ar" ? arabicCopy : englishCopy;
  const isArabic = locale === "ar";
  const ArrowIcon = isArabic ? ArrowLeftIcon : ArrowRightIcon;

  return (
    <div className={`${styles.page} min-h-screen overflow-hidden bg-[#fbf7ef] text-[#102d2a]`}>
      <header className="sticky top-0 z-50 border-b border-[#143f38]/10 bg-[#fbf7ef]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
          <Link href="/" className="group flex items-center gap-2.5" aria-label={copy.ui.home}>
            <span className="flex size-9 items-center justify-center rounded-[13px] bg-[#0d4f45] text-lg font-bold text-[#fffaf0] shadow-[0_6px_18px_rgba(13,79,69,0.2)] transition-transform group-hover:-rotate-3">
              {copy.ui.brandGlyph}
            </span>
            <span className="text-xl font-bold tracking-[-0.03em]">{copy.ui.brandName}</span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-[#294b46] md:flex" aria-label={copy.ui.navigation}>
            <a className="transition-colors hover:text-[#e75f45]" href="#product">{copy.nav.product}</a>
            <a className="transition-colors hover:text-[#e75f45]" href="#how">{copy.nav.how}</a>
            <a className="transition-colors hover:text-[#e75f45]" href="#platforms">{copy.nav.platforms}</a>
            <Link className="transition-colors hover:text-[#e75f45]" href={`/${locale}/pricing`}>{copy.nav.pricing}</Link>
            <a className="transition-colors hover:text-[#e75f45]" href="#faq">{copy.nav.faq}</a>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <LanguageSwitcher className="rounded-full px-2.5 text-[#294b46] hover:bg-[#e9e1d4] hover:text-[#102d2a] sm:px-3" />
            <Link className="hidden text-sm font-medium text-[#294b46] transition-colors hover:text-[#e75f45] sm:block" href={signInUrl}>
              {copy.nav.signIn}
            </Link>
            <Link className="rounded-full bg-[#0d4f45] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(13,79,69,0.18)] transition hover:-translate-y-0.5 hover:bg-[#0a4038]" href={signUpUrl}>
              {copy.nav.start}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative px-5 pb-20 pt-14 sm:px-8 sm:pt-20 lg:px-10 lg:pb-28 lg:pt-24">
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-16 lg:gap-20">
            <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center text-center">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#0d4f45]/14 bg-white/70 px-3.5 py-2 text-xs font-semibold text-[#0d4f45] shadow-sm">
                <SparklesIcon className="size-3.5 text-[#e75f45]" aria-hidden="true" />
                {copy.hero.badge}
              </div>
              <h1 className={`${styles.heroHeading} max-w-5xl text-balance text-[clamp(3.2rem,7vw,6.5rem)] font-bold leading-[0.98] tracking-[-0.065em] text-[#102d2a]`}>
                {copy.hero.titleBefore}{" "}
                <span className="mt-2 block text-[#e75f45]">{copy.hero.titleAccent}</span>
              </h1>
              <p className="mt-7 max-w-3xl text-pretty text-lg leading-8 text-[#47635e] sm:text-xl sm:leading-9">
                {copy.hero.body}
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#0d4f45] px-6 text-sm font-bold text-white shadow-[0_14px_32px_rgba(13,79,69,0.22)] transition hover:-translate-y-0.5 hover:bg-[#0a4038]" href={signUpUrl}>
                  {copy.hero.primary}
                  <ArrowIcon className="size-4 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
                <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#0d4f45]/18 bg-white/50 px-6 text-sm font-bold text-[#0d4f45] transition hover:bg-white" href="#how">
                  <PlayIcon className="size-4 fill-current" aria-hidden="true" />
                  {copy.hero.secondary}
                </a>
              </div>
              <p className="mt-4 flex items-center justify-center gap-2 text-xs text-[#647a75]">
                <CheckIcon className="size-3.5 rounded-full bg-[#cde6d8] p-0.5 text-[#0d4f45]" aria-hidden="true" />
                {copy.hero.note}
              </p>
            </div>

            <HeroPipelineMockup copy={copy.mockup} ui={copy.ui} isArabic={isArabic} />
          </div>
        </section>

        <section className="border-y border-white/10 bg-[#102d2a] px-5 py-5 text-white sm:px-8 lg:px-10" aria-label={copy.marketStrip.label}>
          <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-center">
            <div className="flex shrink-0 items-center gap-2 text-sm font-bold text-[#a9d7c3]">
              <Globe2Icon className="size-4" aria-hidden="true" />
              {copy.marketStrip.label}
            </div>
            <div className="flex flex-1 gap-2 overflow-x-auto pb-1 lg:justify-center" dir={isArabic ? "rtl" : "ltr"}>
              {copy.marketStrip.markets.map((market, index) => (
                <span className={`shrink-0 rounded-full border px-4 py-2 text-sm font-bold ${index === 0 ? "border-[#f19b7f] bg-[#e75f45] text-white" : "border-white/12 bg-white/5 text-white/70"}`} key={market}>{market}</span>
              ))}
            </div>
            <p className="shrink-0 text-xs text-white/45">{copy.marketStrip.note}</p>
          </div>
        </section>

        <section id="product" className="scroll-mt-24 px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
          <div className="mx-auto max-w-7xl">
            <SectionHeading eyebrow={copy.transformation.eyebrow} title={copy.transformation.title} body={copy.transformation.body} />
            <TrendTransformationDemo copy={copy.transformation} ui={copy.ui} />
          </div>
        </section>

        <section className="overflow-hidden bg-[#102d2a] px-5 py-24 text-[#fffaf0] sm:px-8 lg:px-10 lg:py-32">
          <div className="mx-auto max-w-7xl">
            <SectionHeading dark eyebrow={copy.showcase.eyebrow} title={copy.showcase.title} body={copy.showcase.body} />
            <ShortFormGallery copy={copy.showcase} brandName={copy.ui.brandName} />
          </div>
        </section>

        <section id="how" className="scroll-mt-24 px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
          <div className="mx-auto max-w-7xl">
            <SectionHeading eyebrow={copy.steps.eyebrow} title={copy.steps.title} />
            <CalendarAutomation copy={copy.steps} ui={copy.ui} />
          </div>
        </section>

        <section className="px-5 pb-24 sm:px-8 lg:px-10 lg:pb-32">
          <div className="mx-auto max-w-7xl overflow-hidden rounded-[38px] bg-[#e46549] p-7 text-[#fffaf0] sm:p-10 lg:p-14">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <div>
                <p className="text-xs font-bold tracking-[0.14em] text-[#ffd9ce]">{copy.mena.eyebrow}</p>
                <h2 className={`${styles.displayHeading} mt-5 max-w-xl text-balance text-4xl font-bold leading-[1.12] tracking-[-0.045em] sm:text-5xl`}>{copy.mena.title}</h2>
                <p className="mt-6 max-w-xl text-lg leading-8 text-[#fff4ec]/85">{copy.mena.body}</p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-3">
                {copy.mena.examples.map((example, index) => (
                  <li className={`${styles.marketExample} rounded-[26px] border border-white/18 bg-[#102d2a] p-5 shadow-[0_20px_55px_rgba(83,29,18,0.18)]`} key={example.market}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-white">{example.market}</span>
                      <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-white/60">{example.dialect}</span>
                    </div>
                    <p className="mt-10 text-2xl font-bold leading-snug text-white">{example.hook}</p>
                    <div className="mt-6 flex gap-1.5" aria-hidden="true">
                      {[0, 1, 2].map((dot) => <span className={`h-1.5 rounded-full ${dot === index ? "w-8 bg-[#f19b7f]" : "w-3 bg-white/20"}`} key={dot} />)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 flex flex-wrap gap-2 border-t border-white/15 pt-6">
              {copy.mena.points.map((point) => <span className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white/80" key={point}>{point}</span>)}
            </div>
          </div>
        </section>

        <section id="platforms" className="scroll-mt-24 border-y border-[#143f38]/10 bg-white/45 px-5 py-24 sm:px-8 lg:px-10 lg:py-28">
          <div className="mx-auto max-w-7xl text-center">
            <SectionHeading centered eyebrow={copy.platforms.eyebrow} title={copy.platforms.title} body={copy.platforms.body} />
            <div className="mx-auto mt-12 flex max-w-5xl flex-col items-stretch gap-3 rounded-[32px] border border-[#143f38]/10 bg-[#eee6da] p-4 shadow-[0_22px_65px_rgba(16,45,42,0.08)] sm:flex-row sm:items-center" dir="ltr">
              <div className="flex flex-1 items-center gap-3 rounded-[22px] bg-[#102d2a] p-4 text-left text-white">
                <CalendarDaysIcon className="size-5 text-[#f19b7f]" aria-hidden="true" />
                <div><p className="text-xs text-white/45">{copy.ui.brandName}</p><p className="font-bold">{copy.ui.calendar30}</p></div>
              </div>
              <ArrowRightIcon className="mx-auto size-5 rotate-90 text-[#8ba09a] sm:rotate-0 sm:rtl:rotate-180" aria-hidden="true" />
              {copy.platforms.names.map((name) => (
                <div className="flex flex-1 items-center justify-center gap-2.5 rounded-[22px] border border-[#143f38]/8 bg-[#fbf7ef] px-4 py-5 text-sm font-bold text-[#153d37]" key={name}>
                  <span className="size-2 rounded-full bg-[#e75f45]" />{name}
                </div>
              ))}
            </div>
            <p className="mt-7 text-xs text-[#71847f]">{copy.platforms.footnote}</p>
          </div>
        </section>

        <section className="px-5 py-24 sm:px-8 lg:px-10 lg:py-32">
          <div className={`${styles.ctaPanel} relative mx-auto grid max-w-7xl overflow-hidden rounded-[38px] bg-[#0d4f45] px-6 py-14 text-white sm:px-12 sm:py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-14`}>
            <div className="relative z-10 max-w-2xl">
              <p className="text-xs font-bold tracking-[0.14em] text-[#a9d7c3]">{copy.early.eyebrow}</p>
              <h2 className={`${styles.displayHeading} mt-5 text-balance text-4xl font-bold leading-tight tracking-[-0.045em] sm:text-6xl`}>{copy.early.title}</h2>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70">{copy.early.body}</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#fffaf0] px-6 text-sm font-bold text-[#0d4f45] transition hover:-translate-y-0.5 hover:bg-white" href={signUpUrl}>
                  {copy.early.primary}<ArrowIcon className="size-4" aria-hidden="true" />
                </Link>
                <Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 bg-white/5 px-6 text-sm font-bold text-white transition hover:bg-white/10" href={contentStudioUrl}>
                  {copy.early.secondary}
                </Link>
              </div>
            </div>
            <div className="relative z-10 mt-12 rounded-[28px] border border-white/15 bg-[#092f2a] p-5 shadow-2xl lg:mt-0">
              <div className="rounded-2xl border border-white/10 bg-white/7 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">{copy.ui.brandUrl}</p>
                <p className="mt-2 truncate text-sm text-white/80" dir="ltr">{copy.ui.brandUrlExample}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/7 p-4"><p className="text-[10px] text-white/40">{copy.marketStrip.label}</p><p className="mt-2 text-sm font-bold">{copy.marketStrip.markets[0]}</p></div>
                <div className="rounded-2xl border border-white/10 bg-white/7 p-4"><p className="text-[10px] text-white/40">{copy.ui.format}</p><p className="mt-2 text-sm font-bold">{copy.ui.platformFormats}</p></div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-2xl bg-[#e75f45] px-5 py-4 text-sm font-bold text-white">
                <span>{copy.early.primary}</span><SparklesIcon className="size-4" aria-hidden="true" />
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 px-5 pb-24 sm:px-8 lg:px-10 lg:pb-32">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
            <SectionHeading eyebrow={copy.faq.eyebrow} title={copy.faq.title} />
            <div className="divide-y divide-[#143f38]/12 border-y border-[#143f38]/12">
              {copy.faq.items.map((item, index) => (
                <details className="group py-1" key={item.question} open={index === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-lg font-bold marker:content-none">
                    <span>{item.question}</span>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e8e1d6] transition group-open:rotate-45"><span className="text-xl font-light leading-none">+</span></span>
                  </summary>
                  <p className="max-w-2xl pb-6 text-sm leading-7 text-[#607570]">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#102d2a] px-5 py-12 text-white sm:px-8 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 border-b border-white/10 pb-12 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
            <div>
              <Link href="/" className="inline-flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-[13px] bg-[#f0a487] text-lg font-bold text-[#102d2a]">{copy.ui.brandGlyph}</span>
                <span className="text-xl font-bold">{copy.ui.brandName}</span>
              </Link>
              <p className="mt-5 max-w-sm text-sm leading-7 text-white/55">{copy.footer.description}</p>
            </div>
            <nav aria-label={copy.footer.product}>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/55">{copy.footer.product}</p>
              <ul className="mt-5 space-y-3 text-sm text-white/75">
                <li><a className="hover:text-white" href="#product">{copy.footer.links[0]}</a></li>
                <li><a className="hover:text-white" href="#how">{copy.footer.links[1]}</a></li>
                <li><a className="hover:text-white" href="#platforms">{copy.footer.links[2]}</a></li>
                <li><a className="hover:text-white" href="#faq">{copy.footer.links[3]}</a></li>
              </ul>
            </nav>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/55">{copy.footer.company}</p>
              <Link className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#f5b89f] hover:text-white" href={signUpUrl}>{copy.footer.start}<ArrowIcon className="size-4" aria-hidden="true" /></Link>
              <p className="mt-5 text-xs leading-6 text-white/60">{copy.footer.region}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 pt-7 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} {copy.ui.brandName}. {copy.footer.rights}</p>
            <p>{copy.ui.regionSignature}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
  centered = false,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  centered?: boolean;
  dark?: boolean;
}) {
  return (
    <div className={`${centered ? "mx-auto text-center" : ""} max-w-3xl`}>
      <p className={`text-xs font-bold tracking-[0.14em] ${dark ? "text-[#f2ad8f]" : "text-[#e75f45]"}`}>{eyebrow}</p>
      <h2 className={`${styles.displayHeading} mt-5 text-balance text-4xl font-bold leading-[1.12] tracking-[-0.045em] sm:text-5xl ${dark ? "text-white" : "text-[#102d2a]"}`}>{title}</h2>
      {body ? <p className={`mt-6 text-lg leading-8 ${dark ? "text-white/60" : "text-[#607570]"}`}>{body}</p> : null}
    </div>
  );
}

function HeroPipelineMockup({ copy, ui, isArabic }: { copy: typeof arabicCopy.mockup; ui: typeof arabicCopy.ui; isArabic: boolean }) {

  return (
    <div className={`${styles.mockupWrap} relative mx-auto w-full max-w-[920px]`}>
      <div className="relative overflow-hidden rounded-[32px] border border-[#153d37]/14 bg-[#f7f3eb] p-2 shadow-[0_34px_90px_rgba(16,45,42,0.18)] sm:p-3">
        <div className="overflow-hidden rounded-[24px] border border-[#153d37]/10 bg-[#fffdf8]">
          <div className="flex h-11 items-center justify-between border-b border-[#153d37]/8 px-4" dir="ltr">
            <div className="flex gap-1.5"><span className="size-2.5 rounded-full bg-[#e98c78]" /><span className="size-2.5 rounded-full bg-[#e8c273]" /><span className="size-2.5 rounded-full bg-[#83b69d]" /></div>
            <span className="text-[10px] font-semibold text-[#78908a]">{ui.contentEngine}</span>
          </div>
          <div className="p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-xl bg-[#0d4f45] text-xs font-bold text-white">{ui.brandGlyph}</span><div><p className="text-[9px] text-[#78908a]">{copy.eyebrow}</p><p className="text-sm font-bold text-[#102d2a]">{copy.heading}</p></div></div>
              <span className="rounded-full bg-[#d8eadf] px-2.5 py-1.5 text-[9px] font-bold text-[#0d4f45]">{copy.ready}</span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[0.72fr_1.28fr]" dir="ltr">
              <div className="relative min-h-[320px] overflow-hidden rounded-[22px] bg-[#102d2a]">
                <Image src="/sample-images/cosmetics.jpg" alt="" fill priority sizes="(max-width: 640px) 90vw, 220px" className="object-cover opacity-90" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#102d2a] via-transparent to-black/10" />
                <span className="absolute start-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-bold text-[#102d2a]">{ui.trend}</span>
                <div className="absolute inset-x-0 bottom-0 p-4 text-white" dir={isArabic ? "rtl" : "ltr"}>
                  <p className="text-[10px] text-white/60">{copy.prompt}</p>
                  <p className="mt-2 text-lg font-bold">{ui.brandVersion}</p>
                </div>
              </div>

              <div className="flex min-w-0 flex-col rounded-[22px] border border-[#153d37]/9 bg-[#f3eee5] p-4" dir={isArabic ? "rtl" : "ltr"}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#102d2a]"><CalendarDaysIcon className="size-4 text-[#e75f45]" aria-hidden="true" />{copy.calendar}</div>
                  <span className="text-[10px] font-semibold text-[#e75f45]">{ui.days}</span>
                </div>
                <div className="mt-4 grid flex-1 grid-cols-5 gap-1.5">
                  {Array.from({ length: 30 }).map((_, index) => {
                    const filled = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28].includes(index);
                    return <span className={`relative min-h-8 rounded-[7px] border ${filled ? "border-[#e75f45]/30 bg-[#f8d7cb]" : "border-[#153d37]/6 bg-white/55"}`} key={index}><span className="absolute start-1.5 top-1 text-[7px] text-[#78908a]">{index + 1}</span>{filled ? <span className="absolute inset-x-1.5 bottom-1.5 h-1 rounded-full bg-[#e75f45]" /> : null}</span>;
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between rounded-xl bg-[#0d4f45] px-3 py-2.5 text-white">
                  <span className="text-[9px] font-semibold">{copy.generate}</span><SparklesIcon className="size-3.5 text-[#f4b8a8]" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-6 -end-3 z-20 w-48 rotate-[3deg] rounded-2xl border border-[#143f38]/10 bg-[#fffaf0] p-3.5 shadow-[0_18px_45px_rgba(16,45,42,0.16)] sm:-end-7 sm:w-56 rtl:rotate-[-3deg]">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f8d7cb] text-[#d55239]"><SendIcon className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0"><p className="truncate text-xs font-bold text-[#102d2a]">{copy.social}</p><p className="mt-1 text-[9px] text-[#71847f]">{ui.scheduledReel}</p></div>
          <CheckIcon className="ms-auto size-4 shrink-0 text-[#0d4f45]" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function TrendTransformationDemo({ copy, ui }: { copy: typeof arabicCopy.transformation; ui: typeof arabicCopy.ui }) {
  const labels = [ui.trendingNow, ui.brandVoice, ui.ready];
  return (
    <div className={`${styles.pipelinePanel} mt-14 grid gap-3 rounded-[34px] border border-[#143f38]/10 bg-[#eee6da] p-4 shadow-[0_24px_70px_rgba(16,45,42,0.08)] lg:grid-cols-3 lg:p-5`}>
      {copy.cards.map((card, index) => (
        <article className="relative overflow-hidden rounded-[26px] border border-white/70 bg-[#fffaf0] p-5" key={card.number}>
          <div className="flex items-center justify-between gap-3"><span className="text-[10px] font-bold tracking-[0.16em] text-[#e75f45]">{labels[index]}</span><span className="text-xs font-bold text-[#a0aca8]">{card.number}</span></div>
          {index === 0 ? (
            <div className="relative mt-5 aspect-[16/11] overflow-hidden rounded-2xl"><Image src="/sample-images/desert.jpg" alt="" fill sizes="(max-width: 1024px) 90vw, 30vw" className="object-cover" /><span className="absolute bottom-3 end-3 rounded-full bg-white/90 px-3 py-1.5 text-[10px] font-bold text-[#102d2a]">{ui.hookFormat}</span></div>
          ) : index === 1 ? (
            <div className="mt-5 space-y-2 rounded-2xl bg-[#102d2a] p-4 text-white">
              <div className="flex gap-2"><span className="rounded-full bg-[#e75f45] px-2.5 py-1 text-[9px]">{ui.mena}</span><span className="rounded-full bg-white/10 px-2.5 py-1 text-[9px]">{ui.arabic}</span></div>
              <div className="pt-7"><p className="text-[10px] text-white/45">{ui.brandAngle}</p><p className="mt-2 text-lg font-bold">{ui.brandResult}</p></div>
            </div>
          ) : (
            <div className="relative mx-auto mt-5 aspect-[9/12] max-w-[180px] overflow-hidden rounded-[22px] bg-[#102d2a]"><Image src="/sample-images/new-bg-model-product.png" alt="" fill sizes="180px" className="object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#102d2a]/85 via-transparent to-transparent" /><span className="absolute bottom-3 start-3 end-3 rounded-xl bg-white/90 px-3 py-2 text-center text-[10px] font-bold text-[#102d2a]">{ui.platformFormats}</span></div>
          )}
          <h3 className="mt-5 text-xl font-bold text-[#102d2a]">{card.title}</h3>
          <p className="mt-2 text-sm leading-6 text-[#607570]">{card.body}</p>
        </article>
      ))}
    </div>
  );
}

function ShortFormGallery({ copy, brandName }: { copy: typeof arabicCopy.showcase; brandName: string }) {
  return (
    <div className="mt-14 flex snap-x gap-4 overflow-x-auto pb-5 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-4">
      {copy.items.map((item, index) => (
        <article className={`${styles.phoneCard} group relative aspect-[9/16] min-w-[76%] snap-center overflow-hidden rounded-[30px] border-[6px] border-[#25413d] bg-[#1c3834] shadow-[0_25px_60px_rgba(0,0,0,0.24)] sm:min-w-0`} key={item.title}>
          <Image src={showcaseImages[index]} alt={item.title} fill sizes="(max-width: 640px) 76vw, (max-width: 1024px) 45vw, 24vw" className="object-cover transition duration-700 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#081d1a]/95 via-transparent to-black/15" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4"><span className="rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-bold text-[#102d2a]">{item.tag}</span><PlayIcon className="size-4 fill-white text-white" aria-hidden="true" /></div>
          <div className="absolute inset-x-0 bottom-0 p-5"><p className="text-[10px] text-[#f4b8a8]">{brandName}</p><h3 className="mt-1 text-2xl font-bold text-white">{item.title}</h3><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20"><div className="h-full w-2/3 rounded-full bg-[#e75f45]" /></div></div>
        </article>
      ))}
    </div>
  );
}

function CalendarAutomation({ copy, ui }: { copy: typeof arabicCopy.steps; ui: typeof arabicCopy.ui }) {
  const plannedDays = new Set([0, 1, 3, 5, 7, 8, 10, 12, 14, 16, 17, 19, 21, 23, 25, 27, 29]);
  const platformCodes = ["TT", "IG", "YT"];
  return (
    <div className="mt-14 grid overflow-hidden rounded-[36px] border border-[#143f38]/10 bg-[#eee6da] shadow-[0_28px_80px_rgba(16,45,42,0.09)] lg:grid-cols-[1.25fr_0.75fr]">
      <div className="border-b border-[#143f38]/10 p-5 sm:p-8 lg:border-b-0 lg:border-e">
        <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-bold text-[#e75f45]">{ui.contentCalendar}</p><h3 className="mt-1 text-2xl font-bold text-[#102d2a]">{ui.daysAhead}</h3></div><span className="rounded-full bg-[#d8eadf] px-3 py-1.5 text-xs font-bold text-[#0d4f45]">{ui.completeCalendar}</span></div>
        <div className="mt-6 grid grid-cols-5 gap-2">
          {Array.from({ length: 30 }).map((_, index) => {
            const planned = plannedDays.has(index);
            return <div className={`min-h-20 rounded-xl border p-2 ${planned ? "border-[#e75f45]/22 bg-[#fff7f1]" : "border-[#143f38]/7 bg-white/45"}`} key={index}><div className="flex items-center justify-between"><span className="text-[9px] text-[#78908a]">{index + 1}</span>{planned ? <span className="size-1.5 rounded-full bg-[#e75f45]" /> : null}</div>{planned ? <div className="mt-5 rounded-lg bg-[#102d2a] px-1.5 py-1 text-center text-[8px] font-bold text-white" dir="ltr">{platformCodes[index % 3]}</div> : null}</div>;
          })}
        </div>
      </div>
      <ol className="space-y-1 p-5 sm:p-8">
        {copy.items.map((item, index) => (
          <li className="flex gap-4 rounded-2xl p-4 transition hover:bg-white/50" key={item.title}><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#102d2a] text-xs font-bold text-white">{index + 1}</span><div><h3 className="font-bold text-[#102d2a]">{item.title}</h3><p className="mt-1 text-sm leading-6 text-[#607570]">{item.body}</p></div></li>
        ))}
      </ol>
    </div>
  );
}
