"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpLeftIcon, ArrowUpRightIcon, CoinsIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { readCommercialSummary, type CommercialSummary } from "@/lib/commercial/summary";
import { getActiveWorkspaceId } from "@/lib/studio/client";

export function useCommercialStatusData({ workspaceId, authorizedWorkspaces, enabled }: { workspaceId: string | null; authorizedWorkspaces: Array<{ id: string }>; enabled: boolean }) {
  const [summary, setSummary] = useState<CommercialSummary | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSummary(null);
      return;
    }
    const storedWorkspaceId = getActiveWorkspaceId();
    const resolvedWorkspaceId = storedWorkspaceId && authorizedWorkspaces.some((workspace) => workspace.id === storedWorkspaceId) ? storedWorkspaceId : workspaceId;
    if (!resolvedWorkspaceId) {
      setSummary(null);
      return;
    }
    const controller = new AbortController();
    void fetch("/api/studio/billing", { headers: { "x-workspace-id": resolvedWorkspaceId }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as { data?: unknown };
        const next = readCommercialSummary(body.data);
        if (next) setSummary(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [authorizedWorkspaces, enabled, workspaceId]);

  return summary;
}

function commercialPresentation(summary: CommercialSummary, locale: "ar" | "en", freeLabel: string, trialLabel: (plan: string, days: number) => string) {
  const subscription = summary.subscription;
  const plan = summary.plans.find((candidate) => candidate.planId === (subscription?.planId ?? "free"));
  const planName = plan?.authoredName[locale] ?? (subscription?.planId || freeLabel);
  const trialEndsAt = subscription?.state === "trialing" ? new Date(subscription.currentPeriodEndsAt) : null;
  const trialDays = trialEndsAt && Number.isFinite(trialEndsAt.getTime()) ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000)) : null;
  const UpgradeIcon = locale === "ar" ? ArrowUpLeftIcon : ArrowUpRightIcon;
  const planLabel = subscription?.state === "trialing" && trialDays !== null ? trialLabel(planName, trialDays) : planName;

  return { UpgradeIcon, planLabel };
}

export function CommercialStatus({ summary }: { summary: CommercialSummary | null }) {
  const locale = useLocale() as "ar" | "en";
  const t = useTranslations("shell.commercial");
  if (!summary) return null;
  const { UpgradeIcon, planLabel } = commercialPresentation(summary, locale, t("free"), (plan, days) => t("trial", { plan, days }));

  return (
    <div className="rounded-lg border bg-sidebar-accent/35 p-2.5 group-data-[collapsible=icon]:p-1.5" data-testid="shell-commercial-status">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-300 text-stone-950"><CoinsIcon className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <p className="truncate text-xs font-semibold">{planLabel}</p>
          <p className="truncate text-[11px] text-muted-foreground">{t("credits", { count: summary.credit.availableUnits })}</p>
        </div>
      </div>
      <Link href="/billing" className="mt-2 flex min-h-8 items-center justify-center gap-1 rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground group-data-[collapsible=icon]:sr-only">
        {t("upgrade")}<UpgradeIcon className="size-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function CommercialStatusCompact({ summary }: { summary: CommercialSummary | null }) {
  const locale = useLocale() as "ar" | "en";
  const t = useTranslations("shell.commercial");
  if (!summary) return null;
  const { planLabel } = commercialPresentation(summary, locale, t("free"), (plan, days) => t("trial", { plan, days }));
  const formattedCredits = new Intl.NumberFormat(locale).format(summary.credit.availableUnits);

  return (
    <Link
      href="/billing"
      aria-label={t("manageCredits", { count: summary.credit.availableUnits })}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-semibold shadow-sm transition-colors hover:bg-muted sm:gap-2 sm:px-3"
      data-testid="shell-commercial-status-compact"
    >
      <CoinsIcon className="size-4 text-amber-600" aria-hidden="true" />
      <span>{t("compactCredits", { count: formattedCredits })}</span>
      <span className="hidden text-muted-foreground lg:inline" aria-hidden="true">·</span>
      <span className="hidden max-w-28 truncate lg:inline">{planLabel}</span>
      <span className="hidden text-primary sm:inline">{t("upgrade")}</span>
    </Link>
  );
}
