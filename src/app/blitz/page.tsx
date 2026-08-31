import Link from "next/link";
import { ArrowLeft, ArrowRight, FileText, ImageIcon, ShieldCheck, Sparkles } from "lucide-react";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import {
  getOnboardingAnalytics,
  recordOnboardingEventBestEffort,
} from "@/lib/onboarding/analytics";

export const dynamic = "force-dynamic";

export default async function BlitzPage() {
  const { aggregate, session } = await requireOnboardingComplete("/blitz");
  const locale = aggregate?.interfaceLocale ?? "ar";
  const rtl = locale === "ar";
  const artifact = aggregate?.activationArtifact?.artifact ?? null;
  const profile = aggregate?.activeProfile;
  await recordOnboardingEventBestEffort(getOnboardingAnalytics(), {
    eventName: "first_value_viewed",
    userId: session.user.id,
    workspaceId: aggregate?.session.workspaceId ?? undefined,
    sessionId: aggregate?.session.id,
    interfaceLocale: aggregate?.interfaceLocale,
    contentLanguage: aggregate?.contentLanguage,
    occurredAt: new Date(),
  });
  const Arrow = rtl ? ArrowLeft : ArrowRight;
  const copy = rtl
    ? {
        eyebrow: "أول قيمة من مساحة عملك",
        title: artifact?.title ?? "ملف علامتك جاهز",
        empty: "تم تجهيز ملف علامتك. ابدأ الآن بإنشاء أول محتوى.",
        why: "لماذا هذا الاقتراح؟",
        formats: "صيغ مقترحة",
        copy: "فتح استوديو الكتابة",
        image: "إنشاء صورة",
        provenance: "مبني من ملف علامة راجعته واعتمدته",
      }
    : {
        eyebrow: "First value from your workspace",
        title: artifact?.title ?? "Your Brand Profile is ready",
        empty: "Your Brand Profile is prepared. Start creating your first content now.",
        why: "Why this suggestion?",
        formats: "Suggested formats",
        copy: "Open copy studio",
        image: "Create an image",
        provenance: "Built from the Brand Profile you reviewed and accepted",
      };

  return (
    <main dir={rtl ? "rtl" : "ltr"} className="relative min-h-screen overflow-hidden bg-[#100e0c] px-5 py-10 text-stone-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(217,119,6,0.25),transparent_40%),linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:auto,36px_36px,36px_36px]" />
      <div className="relative mx-auto max-w-4xl">
        <header className="flex items-center justify-between gap-4"><div className="text-sm font-bold">tasmeem<span className="text-amber-300">ai</span></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/8 px-3 py-1.5 text-xs text-emerald-300">{copy.provenance}</span></header>
        <section className="mx-auto mt-16 max-w-3xl">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-300 text-stone-950"><Sparkles className="size-5" /></div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">{copy.eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">{copy.title}</h1>
          {artifact ? (
            <div className="mt-8 space-y-5">
              <section className="rounded-[2rem] border border-white/12 bg-white/[0.05] p-6 shadow-2xl sm:p-8"><p className="text-lg font-semibold leading-8 text-white">{artifact.hook}</p><div className="mt-5 whitespace-pre-wrap text-sm leading-8 text-stone-300">{artifact.body}</div></section>
              <div className="grid gap-4 sm:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><h2 className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck className="size-4 text-amber-300" />{copy.why}</h2><p className="mt-3 text-sm leading-6 text-stone-400">{artifact.rationale}</p></section>
                <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><h2 className="text-sm font-semibold text-white">{copy.formats}</h2><div className="mt-3 flex flex-wrap gap-2">{artifact.suggestedFormats.map((format) => <span key={format} className="rounded-full bg-white/8 px-3 py-1.5 text-xs text-stone-300">{format}</span>)}</div></section>
              </div>
            </div>
          ) : <p className="mt-6 text-base leading-8 text-stone-400">{copy.empty}</p>}
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Link href="/simple-studio/copy" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 text-sm font-bold text-stone-950 transition hover:bg-amber-200"><FileText className="size-4" />{copy.copy}<Arrow className="size-4" /></Link>
            <Link href="/simple-studio/images" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"><ImageIcon className="size-4" />{copy.image}</Link>
          </div>
          {profile && <p className="mt-6 text-center text-[11px] text-stone-600">Profile {profile.id} · Revision {profile.revision}</p>}
        </section>
      </div>
    </main>
  );
}
