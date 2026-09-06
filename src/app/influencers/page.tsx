import { getTranslations } from "next-intl/server";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { CREATOR_PERSONAS } from "@/lib/creator-personas/production";
import { PersonaManager } from "./PersonaManager";

export const dynamic = "force-dynamic";
export default async function InfluencersPage() {
  const { aggregate } = await requireOnboardingComplete("/influencers");
  const workspaceId = aggregate?.session.workspaceId;
  const t = await getTranslations("product.personas");
  if (!workspaceId) return null;
  const personas = await CREATOR_PERSONAS.list(workspaceId, { limit: 100 });
  const at = new Date();
  const lifecycle = Object.fromEntries(await Promise.all(personas.map(async (persona) => {
    const detail = await CREATOR_PERSONAS.get(workspaceId, persona.id);
    const consent = detail?.evidence.find((item) => item.type === "likeness_consent" && !item.revokedAt && item.effectiveAt <= at && item.expiresAt > at);
    return [persona.id, { activeConsentEvidenceId: consent?.id ?? null }] as const;
  })));
  return <main className="flex-1 px-5 py-8 sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl"><header className="mb-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{t("title")}</h1><p className="mt-2 max-w-3xl text-muted-foreground">{t("description")}</p></header><PersonaManager personas={personas} lifecycle={lifecycle} /></div></main>;
}
