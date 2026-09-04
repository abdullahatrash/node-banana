import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workspaceSettings } from "@/lib/db/schema";

export interface WorkspaceCalendarPreferences {
  timezone: string;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function validateCalendarPreferences(input: {
  timezone: unknown;
  weekStartsOn: unknown;
}): WorkspaceCalendarPreferences {
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
  return { timezone, weekStartsOn: Number(input.weekStartsOn) as WorkspaceCalendarPreferences["weekStartsOn"] };
}

export async function getWorkspaceCalendarPreferences(workspaceId: string): Promise<WorkspaceCalendarPreferences> {
  const [row] = await getDb().select({
    timezone: workspaceSettings.schedulingTimezone,
    weekStartsOn: workspaceSettings.schedulingWeekStart,
  }).from(workspaceSettings).where(eq(workspaceSettings.workspaceId, workspaceId)).limit(1);
  if (!row) throw new Error("CALENDAR_PREFERENCES_UNAVAILABLE");
  return validateCalendarPreferences(row);
}

export async function updateWorkspaceCalendarPreferences(input: {
  workspaceId: string;
  timezone: unknown;
  weekStartsOn: unknown;
}): Promise<WorkspaceCalendarPreferences> {
  const preferences = validateCalendarPreferences(input);
  const [row] = await getDb().update(workspaceSettings).set({
    schedulingTimezone: preferences.timezone,
    schedulingWeekStart: preferences.weekStartsOn,
    updatedAt: new Date(),
  }).where(eq(workspaceSettings.workspaceId, input.workspaceId)).returning({
    timezone: workspaceSettings.schedulingTimezone,
    weekStartsOn: workspaceSettings.schedulingWeekStart,
  });
  if (!row) throw new Error("CALENDAR_PREFERENCES_UNAVAILABLE");
  return validateCalendarPreferences(row);
}
