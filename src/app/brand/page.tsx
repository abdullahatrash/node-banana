import { desc, eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { BadgeCheck, BookOpen, ShieldAlert, Users } from "lucide-react";
import { getDb } from "@/lib/db";
import { brandAnalysisRuns, brandProfiles, brandSources } from "@/lib/db/schema";
import { brandProfileV1Schema } from "@/lib/onboarding/schemas";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { diffBrandProfiles } from "@/lib/product-surfaces/brand-projection";
import { BrandEditor } from "./BrandEditor";
import { BrandSourceRefreshButton } from "./BrandSourceRefreshButton";

export const dynamic = "force-dynamic";

export default async function BrandPage() {
  const { aggregate } = await requireOnboardingComplete("/brand");
  const workspaceId = aggregate?.session.workspaceId;
  const t = await getTranslations("product.brand");
  const locale = await getLocale();
  if (!workspaceId || !aggregate?.activeProfile) return null;
  const [rows, sources, runs] = await Promise.all([
    getDb().select().from(brandProfiles).where(eq(brandProfiles.workspaceId, workspaceId)).orderBy(desc(brandProfiles.revision)),
    getDb().select().from(brandSources).where(eq(brandSources.workspaceId, workspaceId)).orderBy(desc(brandSources.revision)),
    getDb().select().from(brandAnalysisRuns).where(eq(brandAnalysisRuns.workspaceId, workspaceId)).orderBy(desc(brandAnalysisRuns.createdAt)),
  ]);
  const active = aggregate.activeProfile;
  const profile = brandProfileV1Schema.parse(active.profile);
  const draft = rows.find((row) => row.status === "draft");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const languageNames = new Intl.DisplayNames([locale], { type: "language" });
  const parsedRows = rows.map((row) => ({ ...row, parsedProfile: brandProfileV1Schema.parse(row.profile) }));
  const runBySource = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (!runBySource.has(run.sourceId)) runBySource.set(run.sourceId, run);
  const latestSource = sources[0] ?? null;
  const latestRun = latestSource ? runBySource.get(latestSource.id) : null;
  const sourceRefreshPending = latestRun?.status === "queued" || latestRun?.status === "running";
  return <main className="flex-1 px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl space-y-7">
    <header><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{profile.identity.companyName}</h1><p className="mt-2 max-w-3xl text-muted-foreground">{t("description")}</p></header>
    <section className="grid gap-4 md:grid-cols-3"><Card icon={BadgeCheck} title={t("activeRevision")} body={t("revisionValue", { revision: active.revision, date: date.format(active.acceptedAt ?? active.createdAt) })} /><Card icon={Users} title={t("audiences")} body={profile.audiences.map((item) => `${item.name} · ${item.weight}%`).join(" — ")} /><Card icon={BookOpen} title={t("language")} body={languageNames.of(profile.contentLanguage) ?? profile.contentLanguage} /></section>
    <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-3xl border bg-card p-6"><h2 className="text-xl font-semibold">{t("positioning")}</h2><p dir="auto" className="mt-4 leading-7 text-muted-foreground">{profile.positioning}</p><h3 className="mt-6 font-semibold">{t("voice")}</h3><div className="mt-3 flex flex-wrap gap-2">{profile.voice.descriptors.map((item) => <span key={item} dir="auto" className="rounded-full bg-amber-100 px-3 py-1.5 text-sm text-amber-950">{item}</span>)}</div></div><div className="rounded-3xl border bg-card p-6"><h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldAlert className="size-5" />{t("guardrails")}</h2><ul className="mt-4 space-y-3 text-sm text-muted-foreground">{[...profile.prohibitedClaims, ...profile.prohibitedTopics].slice(0, 8).map((item) => <li key={item} dir="auto" className="rounded-xl bg-muted p-3">{item}</li>)}</ul></div></section>
    <BrandEditor activeRevision={active.revision} profile={profile} draft={draft ? { id: draft.id, revision: draft.revision } : null} />
    <section className="rounded-3xl border bg-card p-6 sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{t("sources.title")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("sources.description")}</p></div>{latestSource && <BrandSourceRefreshButton sourceId={latestSource.id} revision={latestSource.revision} disabled={sourceRefreshPending} />}</div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">{sources.map((source) => { const run = runBySource.get(source.id); return <article key={source.id} className="rounded-2xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("sources.revision", { revision: source.revision })}</h3><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{run ? t(`sources.status.${run.status}`) : t("sources.status.unknown")}</span></div><p className="mt-3 text-sm"><span className="text-muted-foreground">{t("sources.kindLabel")}: </span>{t(`sources.kind.${source.kind}`)}</p><p className="mt-1 text-sm"><span className="text-muted-foreground">{t("sources.languageLabel")}: </span>{source.sourceLanguage ? languageNames.of(source.sourceLanguage) ?? source.sourceLanguage : t("sources.languageUnknown")}</p>{source.submittedUrl ? <p dir="ltr" className="mt-2 truncate text-sm text-muted-foreground">{source.submittedUrl}</p> : <p dir="auto" className="mt-2 line-clamp-2 text-sm text-muted-foreground">{source.submittedDescription}</p>}<p className="mt-2 text-xs text-muted-foreground">{source.fetchedAt ? t("sources.fetched", { date: date.format(source.fetchedAt) }) : t("sources.notFetched")}</p>{source.contentHash && <p dir="ltr" className="mt-2 break-all text-xs text-muted-foreground">{source.contentHash}</p>}</article> })}</div>
    </section>
    <section className="rounded-3xl border bg-card p-6"><h2 className="text-xl font-semibold">{t("history")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("historyHelp")}</p><div className="mt-4 divide-y">{parsedRows.map((row, index) => { const changed = diffBrandProfiles(row.parsedProfile, parsedRows[index + 1]?.parsedProfile ?? null); return <div key={row.id} className="py-4"><div className="flex items-center justify-between gap-4"><span>{t("revision", { revision: row.revision })}</span><span className="rounded-full bg-muted px-3 py-1 text-xs">{t(`status.${row.status}`)}</span></div><div className="mt-3 flex flex-wrap gap-2">{changed.length ? changed.map((field) => <span key={field} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">{t(`diff.${field}`)}</span>) : <span className="text-xs text-muted-foreground">{t("diff.none")}</span>}</div></div>})}</div></section>
  </div></main>;
}

function Card({ icon: Icon, title, body }: { icon: typeof BadgeCheck; title: string; body: string }) { return <div className="rounded-2xl border bg-card p-5"><Icon className="size-5 text-amber-600" /><h2 className="mt-4 font-semibold">{title}</h2><p dir="auto" className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p></div>; }
