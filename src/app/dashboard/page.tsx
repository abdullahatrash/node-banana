import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CalendarClock, Check, Circle, ImageIcon, Radio, Sparkles } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { getDashboardReadModel } from "@/lib/product-surfaces/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { aggregate } = await requireOnboardingComplete("/dashboard");
  const workspaceId = aggregate?.session.workspaceId;
  const t = await getTranslations("product.dashboard");
  const locale = await getLocale();
  if (!workspaceId) return null;
  const model = await getDashboardReadModel(workspaceId, Boolean(aggregate.activeProfile));
  const activationEntries = Object.entries(model.activation) as Array<[keyof typeof model.activation, boolean]>;
  const completed = activationEntries.filter(([, done]) => done).length;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return <main className="flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1><p className="mt-2 text-muted-foreground">{t("updated", { time: date.format(model.generatedAt) })}</p></div>
        <Link href={model.nextAction.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 font-semibold text-stone-950 hover:bg-amber-200">{t(`actions.${model.nextAction.key}`)}<ArrowUpRight className="size-4" /></Link>
      </header>
      <section className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
        <div className="rounded-3xl border bg-card p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">{t("activationTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("activationProgress", { complete: completed, total: activationEntries.length })}</p></div><span className="text-3xl font-bold text-amber-600">{Math.round(completed / activationEntries.length * 100)}%</span></div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-amber-300" style={{ width: `${completed / activationEntries.length * 100}%` }} /></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">{activationEntries.map(([key, done]) => <div key={key} className="flex items-center gap-3 rounded-xl border p-3">{done ? <Check className="size-5 text-emerald-600" /> : <Circle className="size-5 text-muted-foreground" />}<span className="text-sm font-medium">{t(`activation.${key}`)}</span></div>)}</div>
        </div>
        <div className="rounded-3xl bg-stone-950 p-6 text-stone-100 sm:p-8"><Sparkles className="size-6 text-amber-300" /><p className="mt-5 text-xs font-semibold uppercase tracking-[.16em] text-amber-300">{t("nextTitle")}</p><h2 className="mt-2 text-2xl font-semibold">{t(`actions.${model.nextAction.key}`)}</h2><p className="mt-3 text-sm leading-6 text-stone-400">{t(`reasons.${model.nextAction.reason}`)}</p><Link className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-amber-300" href={model.nextAction.href}>{t("open")}<ArrowUpRight className="size-4" /></Link></div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={ImageIcon} label={t("metrics.media")} value={model.counts.media} />
        <Metric icon={Radio} label={t("metrics.channels")} value={model.counts.channels} warning={model.counts.reauth} />
        <Metric icon={CalendarClock} label={t("metrics.scheduled")} value={model.counts.scheduled} />
        <Metric icon={AlertTriangle} label={t("metrics.failures")} value={model.counts.failedPublishing + model.counts.failedGeneration} warning={model.counts.failedPublishing + model.counts.failedGeneration} />
      </section>
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border bg-card p-6"><div className="flex justify-between"><h2 className="text-lg font-semibold">{t("upcoming")}</h2><Link href="/calendar" className="text-sm text-amber-700">{t("viewAll")}</Link></div><div className="mt-4 space-y-3">{model.upcomingPosts.length ? model.upcomingPosts.map((post) => <div key={post.id} className="rounded-xl bg-muted/50 p-3"><p className="line-clamp-2 text-sm">{post.content || t("untitledPost")}</p><p className="mt-1 text-xs text-muted-foreground">{post.scheduledAt ? date.format(post.scheduledAt) : t("notScheduled")}</p></div>) : <Empty text={t("emptyUpcoming")} href="/compose" action={t("createPost")} />}</div></div>
        <div className="rounded-3xl border bg-card p-6"><div className="flex justify-between"><h2 className="text-lg font-semibold">{t("recentMedia")}</h2><Link href="/library?tab=media" className="text-sm text-amber-700">{t("viewAll")}</Link></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{model.recentAssets.length ? model.recentAssets.map((asset) => <div key={asset.id} className="flex aspect-square flex-col justify-between rounded-xl bg-muted p-3"><ImageIcon className="size-5 text-muted-foreground" /><span className="text-xs font-medium">{t(`assetType.${asset.type}`)}</span></div>) : <div className="col-span-full"><Empty text={t("emptyMedia")} href="/ai-studio" action={t("createMedia")} /></div>}</div></div>
      </section>
    </div>
  </main>;
}

function Metric({ icon: Icon, label, value, warning = 0 }: { icon: typeof ImageIcon; label: string; value: number; warning?: number }) { return <div className="rounded-2xl border bg-card p-5"><div className="flex items-center justify-between"><Icon className="size-5 text-muted-foreground" />{warning > 0 && <span className="size-2 rounded-full bg-red-500" />}</div><p className="mt-5 text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p></div>; }
function Empty({ text, href, action }: { text: string; href: string; action: string }) { return <div className="rounded-xl border border-dashed p-5 text-center"><p className="text-sm text-muted-foreground">{text}</p><Link href={href} className="mt-3 inline-flex text-sm font-semibold text-amber-700">{action}</Link></div>; }
