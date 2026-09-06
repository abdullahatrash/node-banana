import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import type { AppLocale } from "@/i18n/config";
import { getAuthenticatedUserFromHeaders } from "@/lib/auth/session";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import {
  onboardingSessions,
  userPreferences,
  workspaceInterfaceLocalePreferences,
  workspaceMembers,
  workspaceSettings,
  workspaces,
} from "@/lib/db/schema";

export interface WorkspaceLocaleContext {
  workspaceId: string;
  preferenceLocale: string | null;
  workspaceLocale: string;
}

async function readMemberLocale(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceLocaleContext | null> {
  const [row] = await getDb()
    .select({
      workspaceId: workspaceMembers.workspaceId,
      preferenceLocale: workspaceInterfaceLocalePreferences.interfaceLocale,
      workspaceLocale: workspaceSettings.defaultInterfaceLocale,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .innerJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspaceMembers.workspaceId))
    .leftJoin(
      workspaceInterfaceLocalePreferences,
      and(
        eq(workspaceInterfaceLocalePreferences.workspaceId, workspaceMembers.workspaceId),
        eq(workspaceInterfaceLocalePreferences.userId, workspaceMembers.userId),
      ),
    )
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
      isNull(workspaces.deletedAt),
    ))
    .limit(1);
  return row ?? null;
}

async function initialWorkspaceId(userId: string): Promise<string | null> {
  const [onboarding] = await getDb()
    .select({ workspaceId: onboardingSessions.workspaceId })
    .from(onboardingSessions)
    .where(eq(onboardingSessions.userId, userId))
    .limit(1);
  if (onboarding?.workspaceId) return onboarding.workspaceId;
  const [membership] = await getDb()
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.workspaceId))
    .limit(1);
  return membership?.workspaceId ?? null;
}

export async function readWorkspaceLocaleContext(input: {
  requestHeaders: Headers;
  selectedWorkspaceId?: string | null;
}): Promise<WorkspaceLocaleContext | null> {
  if (!isDatabaseConfigured()) return null;
  const user = await getAuthenticatedUserFromHeaders(input.requestHeaders);
  if (!user) return null;
  const explicitlySelected = input.selectedWorkspaceId?.trim();
  const workspaceId = explicitlySelected || await initialWorkspaceId(user.id);
  if (!workspaceId) return null;
  return readMemberLocale(user.id, workspaceId);
}

export async function saveWorkspaceLocalePreference(input: {
  userId: string;
  workspaceId: string;
  locale: AppLocale;
  now?: Date;
}): Promise<"saved" | "not_member"> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId || !await readMemberLocale(input.userId, workspaceId)) return "not_member";
  const now = input.now ?? new Date();
  await getDb().transaction(async (tx) => {
    await tx.insert(workspaceInterfaceLocalePreferences).values({
      workspaceId,
      userId: input.userId,
      interfaceLocale: input.locale,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [workspaceInterfaceLocalePreferences.workspaceId, workspaceInterfaceLocalePreferences.userId],
      set: { interfaceLocale: input.locale, updatedAt: now },
    });
    // Compatibility only: legacy onboarding reads are removed independently.
    await tx.insert(userPreferences).values({
      userId: input.userId,
      interfaceLocale: input.locale,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: userPreferences.userId,
      set: { interfaceLocale: input.locale, updatedAt: now },
    });
  });
  return "saved";
}
