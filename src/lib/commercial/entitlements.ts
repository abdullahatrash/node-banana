import "server-only";

import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  billingPlanVersions,
  workspaceProductRecords,
  workspaceSubscriptions,
  workspaces,
} from "@/lib/db/schema";
import {
  DEFAULT_BILLING_PLANS,
  type CommercialPlanEntitlements,
} from "./catalog";

type Db = ReturnType<typeof getDb>;
export type CommercialEntitlementExecutor = Pick<Db, "select">;

const planEntitlementsSchema = z.object({
  generationCreditsPerPeriod: z.number().int().nonnegative(),
  workspaceSeats: z.number().int().nonnegative(),
  connectedChannels: z.number().int().nonnegative(),
  activeAutomations: z.number().int().nonnegative(),
  apiAccess: z.boolean(),
  creatorPersonas: z.boolean(),
  managedChannelOnboarding: z.boolean(),
}).strict();

export type CommercialFeatureEntitlement =
  | "apiAccess"
  | "creatorPersonas"
  | "managedChannelOnboarding";

export type WorkspaceCommercialEntitlements = {
  planId: string;
  planVersion: number;
  subscriptionState: string;
  authoredName: { ar: string; en: string };
  grantsAccess: boolean;
  entitlements: CommercialPlanEntitlements;
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
const deniedEntitlements: CommercialPlanEntitlements = {
  generationCreditsPerPeriod: 0,
  workspaceSeats: 0,
  connectedChannels: 0,
  activeAutomations: 0,
  apiAccess: false,
  creatorPersonas: false,
  managedChannelOnboarding: false,
};

export class CommercialEntitlementError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CommercialEntitlementError";
  }
}

export function resolveWorkspaceCommercialEntitlements(
  row: EntitlementRow | null,
  at: Date = new Date(),
): WorkspaceCommercialEntitlements {
  if (!row) {
    return {
      planId: fallbackFreePlan.planId,
      planVersion: fallbackFreePlan.version,
      subscriptionState: "active",
      authoredName: fallbackFreePlan.authoredName,
      grantsAccess: true,
      entitlements: fallbackFreePlan.entitlements,
    };
  }

  const parsed = planEntitlementsSchema.safeParse(row.entitlements);
  if (!parsed.success) throw new CommercialEntitlementError("PLAN_ENTITLEMENTS_INVALID");
  const periodIsCurrent = row.currentPeriodEndsAt > at;
  const graceIsCurrent = row.subscriptionState === "grace" && Boolean(row.graceEndsAt && row.graceEndsAt > at);
  const grantsAccess =
    (["trialing", "active", "cancel_at_period_end"].includes(row.subscriptionState) && periodIsCurrent) ||
    graceIsCurrent;

  return {
    planId: row.planId,
    planVersion: row.planVersion,
    subscriptionState: row.subscriptionState,
    authoredName: row.authoredName,
    grantsAccess,
    entitlements: grantsAccess ? parsed.data : deniedEntitlements,
  };
}

export async function getWorkspaceCommercialEntitlementsWith(
  executor: CommercialEntitlementExecutor,
  workspaceId: string,
  at: Date = new Date(),
): Promise<WorkspaceCommercialEntitlements> {
  const [row] = await executor
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

  return resolveWorkspaceCommercialEntitlements(row ?? null, at);
}

export function getWorkspaceCommercialEntitlements(
  workspaceId: string,
  at: Date = new Date(),
) {
  return getWorkspaceCommercialEntitlementsWith(getDb(), workspaceId, at);
}

const featureErrorCodes: Record<CommercialFeatureEntitlement, string> = {
  apiAccess: "PLAN_API_ACCESS_REQUIRED",
  creatorPersonas: "PLAN_CREATOR_PERSONAS_REQUIRED",
  managedChannelOnboarding: "PLAN_MANAGED_CHANNEL_ONBOARDING_REQUIRED",
};

export async function requireWorkspaceCommercialFeature(
  workspaceId: string,
  feature: CommercialFeatureEntitlement,
  at: Date = new Date(),
) {
  const access = await getWorkspaceCommercialEntitlements(workspaceId, at);
  if (!access.entitlements[feature]) throw new CommercialEntitlementError(featureErrorCodes[feature]);
  return access;
}

export async function assertActiveAutomationCapacityWith(
  executor: CommercialEntitlementExecutor,
  input: { workspaceId: string; excludeRecordId?: string; at?: Date },
) {
  const [workspace] = await executor
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, input.workspaceId), isNull(workspaces.deletedAt)))
    .for("update")
    .limit(1);
  if (!workspace) throw new CommercialEntitlementError("WORKSPACE_NOT_FOUND");

  const access = await getWorkspaceCommercialEntitlementsWith(executor, input.workspaceId, input.at);
  const filters = [
    eq(workspaceProductRecords.workspaceId, input.workspaceId),
    eq(workspaceProductRecords.kind, "campaign_automation"),
    inArray(workspaceProductRecords.state, ["active", "validating"]),
    isNull(workspaceProductRecords.archivedAt),
  ];
  if (input.excludeRecordId) filters.push(ne(workspaceProductRecords.id, input.excludeRecordId));
  const [usage] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaceProductRecords)
    .where(and(...filters));
  if (Number(usage?.count ?? 0) >= access.entitlements.activeAutomations) {
    throw new CommercialEntitlementError("PLAN_ACTIVE_AUTOMATION_LIMIT_REACHED");
  }
  return access;
}
