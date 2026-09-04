import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { loadCampaignAuthoringOptions } from "@/lib/product-surfaces/campaign-authoring";
import { getWorkspaceCalendarPreferences } from "@/lib/product-surfaces/calendar-preferences";
import { listCampaignOccurrenceStatus } from "@/lib/product-surfaces/campaign-scheduler-repository";
import { listProductRecords } from "@/lib/product-surfaces/repository";
import { AutomationBuilder } from "./AutomationBuilder";

export async function AutomationsScreen({ selectedAutomationId = null }: { selectedAutomationId?: string | null }) {
  const { aggregate } = await requireOnboardingComplete(selectedAutomationId ? `/automations/${selectedAutomationId}/edit` : "/automations");
  const workspaceId = aggregate?.session.workspaceId;
  const userId = aggregate?.session.userId;
  if (!workspaceId || !userId) return null;
  const [t, rows, options, calendarPreferences] = await Promise.all([
    getTranslations("product.automations"),
    listProductRecords({ workspaceId, kinds: ["campaign_automation"] }),
    loadCampaignAuthoringOptions({ workspaceId, userId }),
    getWorkspaceCalendarPreferences(workspaceId),
  ]);
  const automations = rows.map(({ id, title, state, revision, payload }) => ({ id, title, state, revision, payload }));
  if (selectedAutomationId && !automations.some((item) => item.id === selectedAutomationId)) notFound();
  const occurrences = await listCampaignOccurrenceStatus({ workspaceId, campaignIds: automations.map((item) => item.id) });
  return <main className="flex-1 px-5 py-8 sm:px-8 lg:px-10"><div className="mx-auto max-w-[1500px]"><header className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-600">{t("eyebrow")}</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{t("title")}</h1><p className="mt-2 max-w-3xl text-muted-foreground">{t("description")}</p></div>{selectedAutomationId ? <Link href="/automations" className="inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-semibold">{t("newAutomation")}</Link> : null}</header><AutomationBuilder automations={automations} occurrences={occurrences} options={options} calendarPreferences={calendarPreferences} selectedAutomationId={selectedAutomationId} /></div></main>;
}
