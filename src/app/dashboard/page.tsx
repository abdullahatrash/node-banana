import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CalendarClock, Check, Circle, ClipboardCheck, Database, FileText, ImageIcon, Radio, Sparkles } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { getDashboardReadModel } from "@/lib/product-surfaces/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { aggregate } = await requireOnboardingComplete("/dashboard");
  const workspaceId = aggregate?.session.workspaceId;
  const t = await getTranslations("product.dashboard");
  const contentT = await getTranslations("product.content");
  const locale = await getLocale();
  if (!workspaceId) return null;
  const model = await getDashboardReadModel(workspaceId);
  const activationEntries = Object.entries(model.activation) as Array<[keyof typeof model.activation, boolean]>;
  const completed = activationEntries.filter(([, done]) => done).length;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const attentionCount = model.counts.reauth + model.counts.failedPublishing + model.counts.failedGeneration + model.counts.consentAttention + model.counts.pendingApprovals + (model.creditCapacity === "depleted" ? 1 : 0) + (model.metricsStale ? 1 : 0);

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
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Metric icon={ImageIcon} label={t("metrics.media")} value={model.counts.media} />
        <Metric icon={Radio} label={t("metrics.channels")} value={model.counts.channels} warning={model.counts.reauth} />
        <Metric icon={FileText} label={t("metrics.acceptedContent")} value={model.counts.content} />
        <Metric icon={CalendarClock} label={t("metrics.scheduled")} value={model.counts.scheduled} />
        <Metric icon={Sparkles} label={t("metrics.credits")} value={model.creditCapacity === "unavailable" ? t("metrics.unavailable") : model.counts.availableCredits} warning={model.creditCapacity === "depleted" ? 1 : 0} />
        <Metric icon={AlertTriangle} label={t("metrics.failures")} value={attentionCount} warning={attentionCount} />
      </section>
      <section className="rounded-3xl border bg-card p-6 sm:p-8">
        <div><h2 className="text-xl font-semibold">{t("sources.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("sources.description")}</p></div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">{model.sourceEnvelopes.map((envelope) => <Link key={envelope.source} href={envelope.href} className="group rounded-2xl border p-4 transition-colors hover:border-amber-300 hover:bg-amber-50/40 dark:hover:bg-amber-950/10">
          <div className="flex items-start justify-between gap-3"><Database className="size-5 text-muted-foreground" /><span className={`rounded-full px-2 py-1 text-xs font-semibold ${envelope.status === "ready" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : envelope.status === "attention" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-muted text-muted-foreground"}`}>{t(`sources.status.${envelope.status}`)}</span></div>
          <h3 className="mt-4 font-semibold">{t(`sources.items.${envelope.source}.title`)}</h3>
          <p className="mt-1 min-h-16 text-sm leading-5 text-muted-foreground">{t(`sources.items.${envelope.source}.guidance.${envelope.status}`)}</p>
          <p className="mt-4 text-xs text-muted-foreground">{t("sources.records", { count: envelope.count })}</p>
          <p className="mt-1 text-xs text-muted-foreground">{envelope.updatedAt ? t("sources.updated", { time: date.format(envelope.updatedAt) }) : t("sources.never")}</p>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">{t("sources.open")}<ArrowUpRight className="size-3" /></span>
        </Link>)}</div>
      </section>
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border bg-card p-6">
          <div className="flex items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><ClipboardCheck className="size-5" />{t("pending.approvalsTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("pending.approvalsDescription")}</p></div><Link href="/approvals" className="shrink-0 text-sm text-amber-700">{t("viewAll")}</Link></div>
          <div className="mt-4 space-y-3">{model.pendingApprovals.length ? model.pendingApprovals.map((approval) => <Link key={approval.id} href={`/approvals?request=${encodeURIComponent(approval.id)}`} className="block rounded-xl bg-muted/50 p-3 hover:bg-muted">
            <p className="text-sm font-medium">{t("pending.approvalLabel", { count: approval.targetCount })}</p><p className="mt-1 text-xs text-muted-foreground">{t("pending.plan", { id: approval.planId })}</p><p className="mt-1 text-xs text-muted-foreground">{t("pending.expires", { time: date.format(approval.expiresAt) })}</p>
          </Link>) : <Empty text={t("pending.emptyApprovals")} href="/approvals" action={t("pending.openApprovals")} />}</div>
        </div>
        <div className="rounded-3xl border bg-card p-6">
          <div className="flex items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><ClipboardCheck className="size-5" />{t("pending.reviewsTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("pending.reviewsDescription")}</p></div></div>
          <div className="mt-4 space-y-3">{model.pendingReviews.length ? model.pendingReviews.map((review) => <Link key={review.id} href={review.href} className="block rounded-xl bg-muted/50 p-3 hover:bg-muted"><p className="line-clamp-1 text-sm font-medium">{review.title}</p><p className="mt-1 text-xs text-muted-foreground">{t(`pending.kinds.${review.kind}`)} · {t("pending.awaitingReview")}</p><p className="mt-1 text-xs text-muted-foreground">{date.format(review.updatedAt)}</p></Link>) : <Empty text={t("pending.emptyReviews")} href="/blitz" action={t("pending.openReviews")} />}</div>
        </div>
      </section>
      <section className="rounded-3xl border bg-card p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><FileText className="size-5" />{t("recentContent.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("recentContent.description")}</p></div><Link href="/content" className="shrink-0 text-sm text-amber-700">{t("viewAll")}</Link></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{model.recentContentPieces.length ? model.recentContentPieces.map((piece) => <Link key={piece.id} href={`/content?piece=${encodeURIComponent(piece.id)}`} className="rounded-xl border p-4 hover:border-amber-300"><p className="line-clamp-1 font-medium">{piece.title}</p><p className="mt-2 text-xs text-muted-foreground">{contentT(`formats.${piece.format}`)} · {contentT(`languages.${piece.contentLanguage}`)}</p><div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{t("recentContent.revision", { revision: piece.revision })}</span><span>{t(`recentContent.proof.${piece.renderProofStatus}`)}</span></div><p className="mt-2 text-xs text-muted-foreground">{date.format(piece.updatedAt)}</p></Link>) : <div className="md:col-span-2 xl:col-span-3"><Empty text={t("recentContent.empty")} href="/content" action={t("recentContent.create")} /></div>}</div>
      </section>
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border bg-card p-6"><div className="flex justify-between"><h2 className="text-lg font-semibold">{t("upcoming")}</h2><Link href="/calendar" className="text-sm text-amber-700">{t("viewAll")}</Link></div><div className="mt-4 space-y-3">{model.upcomingPosts.length ? model.upcomingPosts.map((post) => <div key={post.id} className="rounded-xl bg-muted/50 p-3"><p className="line-clamp-2 text-sm">{post.content || t("untitledPost")}</p><p className="mt-1 text-xs text-muted-foreground">{post.scheduledAt ? date.format(post.scheduledAt) : t("notScheduled")}</p></div>) : <Empty text={t("emptyUpcoming")} href="/compose" action={t("createPost")} />}</div></div>
        <div className="rounded-3xl border bg-card p-6"><div className="flex justify-between"><h2 className="text-lg font-semibold">{t("recentMedia")}</h2><Link href="/library?tab=media" className="text-sm text-amber-700">{t("viewAll")}</Link></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{model.recentAssets.length ? model.recentAssets.map((asset) => <div key={asset.id} className="flex aspect-square flex-col justify-between rounded-xl bg-muted p-3"><ImageIcon className="size-5 text-muted-foreground" /><span className="text-xs font-medium">{t(`assetType.${asset.type}`)}</span></div>) : <div className="col-span-full"><Empty text={t("emptyMedia")} href="/ai-studio" action={t("createMedia")} /></div>}</div></div>
      </section>
    </div>
  </main>;
}

function Metric({ icon: Icon, label, value, warning = 0 }: { icon: typeof ImageIcon; label: string; value: number | string; warning?: number }) { return <div className="rounded-2xl border bg-card p-5"><div className="flex items-center justify-between"><Icon className="size-5 text-muted-foreground" />{warning > 0 && <span className="size-2 rounded-full bg-red-500" />}</div><p className="mt-5 text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p></div>; }
function Empty({ text, href, action }: { text: string; href: string; action: string }) { return <div className="rounded-xl border border-dashed p-5 text-center"><p className="text-sm text-muted-foreground">{text}</p><Link href={href} className="mt-3 inline-flex text-sm font-semibold text-amber-700">{action}</Link></div>; }
