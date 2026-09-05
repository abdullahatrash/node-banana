import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { billingPlanVersions, workspaceSubscriptions } from "@/lib/db/schema";
import { resolveWorkspaceCommercialEntitlements } from "@/lib/commercial/entitlements";

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

export function resolveWorkspaceChannelEntitlement(
  row: EntitlementRow | null,
  at: Date = new Date(),
): WorkspaceChannelEntitlement {
  const access = resolveWorkspaceCommercialEntitlements(row, at);

  return {
    planId: access.planId,
    planVersion: access.planVersion,
    subscriptionState: access.subscriptionState,
    authoredName: access.authoredName,
    connectedChannels: access.entitlements.connectedChannels,
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
