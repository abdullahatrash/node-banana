import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { billingPlanVersions, workspaceSubscriptions } from "@/lib/db/schema";
import { DEFAULT_BILLING_PLANS } from "@/lib/commercial/catalog";

export type WorkspaceChannelEntitlement = {
  planId: string;
  planVersion: number;
  subscriptionState: string;
  authoredName: { ar: string; en: string };
  connectedChannels: number;
};

type EntitlementRow = {
  planId: string;
  planVersion: number;
  subscriptionState: string;
  currentPeriodEndsAt: Date;
  graceEndsAt: Date | null;
  authoredName: { ar: string; en: string };
  entitlements: Record<string, number | boolean>;
};

const fallbackFreePlan = DEFAULT_BILLING_PLANS.find((plan) => plan.planId === "free")!;

export function resolveWorkspaceChannelEntitlement(
  row: EntitlementRow | null,
  at: Date = new Date(),
): WorkspaceChannelEntitlement {
  if (!row) {
    return {
      planId: fallbackFreePlan.planId,
      planVersion: fallbackFreePlan.version,
      subscriptionState: "active",
      authoredName: fallbackFreePlan.authoredName,
      connectedChannels: fallbackFreePlan.entitlements.connectedChannels,
    };
  }

  const periodIsCurrent = row.currentPeriodEndsAt > at;
  const graceIsCurrent = row.subscriptionState === "grace" && Boolean(row.graceEndsAt && row.graceEndsAt > at);
  const grantsAccess =
    (["trialing", "active", "cancel_at_period_end"].includes(row.subscriptionState) && periodIsCurrent) ||
    graceIsCurrent;
  const configuredLimit = row.entitlements.connectedChannels;
  const connectedChannels = grantsAccess && typeof configuredLimit === "number" && Number.isInteger(configuredLimit) && configuredLimit >= 0
    ? configuredLimit
    : 0;

  return {
    planId: row.planId,
    planVersion: row.planVersion,
    subscriptionState: row.subscriptionState,
    authoredName: row.authoredName,
    connectedChannels,
  };
}

export async function getWorkspaceChannelEntitlement(
  workspaceId: string,
): Promise<WorkspaceChannelEntitlement> {
  const [row] = await getDb()
    .select({
      planId: workspaceSubscriptions.planId,
      planVersion: workspaceSubscriptions.planVersion,
      subscriptionState: workspaceSubscriptions.state,
      currentPeriodEndsAt: workspaceSubscriptions.currentPeriodEndsAt,
      graceEndsAt: workspaceSubscriptions.graceEndsAt,
      authoredName: billingPlanVersions.authoredName,
      entitlements: billingPlanVersions.entitlements,
    })
    .from(workspaceSubscriptions)
    .innerJoin(
      billingPlanVersions,
      and(
        eq(billingPlanVersions.planId, workspaceSubscriptions.planId),
        eq(billingPlanVersions.version, workspaceSubscriptions.planVersion),
      ),
    )
    .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
    .limit(1);

  return resolveWorkspaceChannelEntitlement(row ?? null);
}
