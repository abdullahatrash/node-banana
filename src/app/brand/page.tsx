import { desc, eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { BadgeCheck, BookOpen, ShieldAlert, Users } from "lucide-react";
import { getDb } from "@/lib/db";
import { brandProfiles } from "@/lib/db/schema";
import { brandProfileV1Schema } from "@/lib/onboarding/schemas";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { BrandEditor } from "./BrandEditor";

export const dynamic = "force-dynamic";

export default async function BrandPage() {
  const { aggregate } = await requireOnboardingComplete("/brand");
  const workspaceId = aggregate?.session.workspaceId;
  const t = await getTranslations("product.brand");
  const locale = await getLocale();
  if (!workspaceId || !aggregate?.activeProfile) return null;
  const rows = await getDb().select().from(brandProfiles).where(eq(brandProfiles.workspaceId, workspaceId)).orderBy(desc(brandProfiles.revision));
  const active = aggregate.activeProfile;
  const profile = brandProfileV1Schema.parse(active.profile);
  const draft = rows.find((row) => row.status === "draft");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return <main className="flex-1 px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl space-y-7">
    <header><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{profile.identity.companyName}</h1><p className="mt-2 max-w-3xl text-muted-foreground">{t("description")}</p></header>
    <section className="grid gap-4 md:grid-cols-3"><Card icon={BadgeCheck} title={t("activeRevision")} body={t("revisionValue", { revision: active.revision, date: date.format(active.acceptedAt ?? active.createdAt) })} /><Card icon={Users} title={t("audiences")} body={profile.audiences.map((item) => `${item.name} · ${item.weight}%`).join(" — ")} /><Card icon={BookOpen} title={t("language")} body={profile.contentLanguage.toUpperCase()} /></section>
    <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-3xl border bg-card p-6"><h2 className="text-xl font-semibold">{t("positioning")}</h2><p dir="auto" className="mt-4 leading-7 text-muted-foreground">{profile.positioning}</p><h3 className="mt-6 font-semibold">{t("voice")}</h3><div className="mt-3 flex flex-wrap gap-2">{profile.voice.descriptors.map((item) => <span key={item} dir="auto" className="rounded-full bg-amber-100 px-3 py-1.5 text-sm text-amber-950">{item}</span>)}</div></div><div className="rounded-3xl border bg-card p-6"><h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldAlert className="size-5" />{t("guardrails")}</h2><ul className="mt-4 space-y-3 text-sm text-muted-foreground">{[...profile.prohibitedClaims, ...profile.prohibitedTopics].slice(0, 8).map((item) => <li key={item} dir="auto" className="rounded-xl bg-muted p-3">{item}</li>)}</ul></div></section>
    <BrandEditor activeRevision={active.revision} profile={profile} draft={draft ? { id: draft.id, revision: draft.revision } : null} />
    <section className="rounded-3xl border bg-card p-6"><h2 className="text-xl font-semibold">{t("history")}</h2><div className="mt-4 divide-y">{rows.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 py-3"><span>{t("revision", { revision: row.revision })}</span><span className="rounded-full bg-muted px-3 py-1 text-xs">{t(`status.${row.status}`)}</span></div>)}</div></section>
  </div></main>;
}

function Card({ icon: Icon, title, body }: { icon: typeof BadgeCheck; title: string; body: string }) { return <div className="rounded-2xl border bg-card p-5"><Icon className="size-5 text-amber-600" /><h2 className="mt-4 font-semibold">{title}</h2><p dir="auto" className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p></div>; }
