"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, CoinsIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { readCommercialSummary, type CommercialSummary } from "@/lib/commercial/summary";
import { getActiveWorkspaceId } from "@/lib/studio/client";

export function CommercialStatus({ workspaceId, authorizedWorkspaces }: { workspaceId: string | null; authorizedWorkspaces: Array<{ id: string }> }) {
  const locale = useLocale() as "ar" | "en";
  const t = useTranslations("shell.commercial");
  const [summary, setSummary] = useState<CommercialSummary | null>(null);

  useEffect(() => {
    const storedWorkspaceId = getActiveWorkspaceId();
    const resolvedWorkspaceId = storedWorkspaceId && authorizedWorkspaces.some((workspace) => workspace.id === storedWorkspaceId) ? storedWorkspaceId : workspaceId;
    if (!resolvedWorkspaceId) return;
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
  }, [authorizedWorkspaces, workspaceId]);

  if (!summary) return null;
  const subscription = summary.subscription;
  const plan = summary.plans.find((candidate) => candidate.planId === (subscription?.planId ?? "free"));
  const planName = plan?.authoredName[locale] ?? (subscription?.planId || t("free"));
  const trialEndsAt = subscription?.state === "trialing" ? new Date(subscription.currentPeriodEndsAt) : null;
  const trialDays = trialEndsAt && Number.isFinite(trialEndsAt.getTime()) ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000)) : null;

  return (
    <div className="rounded-lg border bg-sidebar-accent/35 p-2.5 group-data-[collapsible=icon]:p-1.5" data-testid="shell-commercial-status">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-300 text-stone-950"><CoinsIcon className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <p className="truncate text-xs font-semibold">{subscription?.state === "trialing" && trialDays !== null ? t("trial", { plan: planName, days: trialDays }) : planName}</p>
          <p className="truncate text-[11px] text-muted-foreground">{t("credits", { count: summary.credit.availableUnits })}</p>
        </div>
      </div>
      <Link href="/settings?section=billing" className="mt-2 flex min-h-8 items-center justify-center gap-1 rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground group-data-[collapsible=icon]:sr-only">
        {t("upgrade")}<ArrowUpRightIcon className="size-3" aria-hidden="true" />
      </Link>
    </div>
  );
}
