import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workspaceSettings } from "@/lib/db/schema";
import {
  isWorkspaceContentMarket,
  type WorkspaceCalendarPreferences,
} from "@/lib/product-surfaces/workspace-preferences-contract";

export type { WorkspaceCalendarPreferences } from "@/lib/product-surfaces/workspace-preferences-contract";

export function validateCalendarPreferences(input: {
  contentMarket: unknown;
  timezone: unknown;
  weekStartsOn: unknown;
}): WorkspaceCalendarPreferences {
  if (!isWorkspaceContentMarket(input.contentMarket)) {
    throw new Error("CONTENT_MARKET_INVALID");
  }
  if (typeof input.timezone !== "string" || input.timezone.length > 100) {
    throw new Error("CALENDAR_TIMEZONE_INVALID");
  }
  const timezone = input.timezone.trim();
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error("CALENDAR_TIMEZONE_INVALID");
  }
  if (!Number.isInteger(input.weekStartsOn) || Number(input.weekStartsOn) < 0 || Number(input.weekStartsOn) > 6) {
    throw new Error("CALENDAR_WEEK_START_INVALID");
  }
  return { contentMarket: input.contentMarket, timezone, weekStartsOn: Number(input.weekStartsOn) as WorkspaceCalendarPreferences["weekStartsOn"] };
}

export async function getWorkspaceCalendarPreferences(workspaceId: string): Promise<WorkspaceCalendarPreferences> {
  const [row] = await getDb().select({
    contentMarket: workspaceSettings.contentMarket,
    timezone: workspaceSettings.schedulingTimezone,
    weekStartsOn: workspaceSettings.schedulingWeekStart,
  }).from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspaceId)).limit(1);
  if (!row) throw new Error("CALENDAR_PREFERENCES_UNAVAILABLE");
  return validateCalendarPreferences(row);
}

export async function updateWorkspaceCalendarPreferences(input: {
  workspaceId: string;
  contentMarket?: unknown;
  timezone: unknown;
  weekStartsOn: unknown;
}): Promise<WorkspaceCalendarPreferences> {
  if (input.contentMarket !== undefined && !isWorkspaceContentMarket(input.contentMarket)) {
    throw new Error("CONTENT_MARKET_INVALID");
  }
  const scheduling = validateCalendarPreferences({
    contentMarket: input.contentMarket ?? "SA",
    timezone: input.timezone,
    weekStartsOn: input.weekStartsOn,
  });
  const [row] = await getDb().update(workspaceSettings).set({
    ...(input.contentMarket === undefined ? {} : { contentMarket: scheduling.contentMarket }),
    schedulingTimezone: scheduling.timezone,
    schedulingWeekStart: scheduling.weekStartsOn,
    updatedAt: new Date(),
  }).where(eq(workspaceSettings.workspaceId, input.workspaceId)).returning({
    contentMarket: workspaceSettings.contentMarket,
    timezone: workspaceSettings.schedulingTimezone,
    weekStartsOn: workspaceSettings.schedulingWeekStart,
  });
  if (!row) throw new Error("CALENDAR_PREFERENCES_UNAVAILABLE");
  return validateCalendarPreferences(row);
}
