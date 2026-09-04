import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workspaceSettings } from "@/lib/db/schema";

export const WORKSPACE_CONTENT_LANGUAGES = ["ar", "en"] as const;
export type WorkspaceContentLanguage = (typeof WORKSPACE_CONTENT_LANGUAGES)[number];

export function validateWorkspaceContentLanguage(value: unknown): WorkspaceContentLanguage {
  if (typeof value !== "string") throw new Error("CONTENT_LANGUAGE_INVALID");
  const primaryLanguage = value.trim().toLowerCase().split("-")[0];
  if (primaryLanguage !== "ar" && primaryLanguage !== "en") throw new Error("CONTENT_LANGUAGE_INVALID");
  return primaryLanguage;
}

export async function getWorkspaceContentLanguage(workspaceId: string): Promise<WorkspaceContentLanguage> {
  const [row] = await getDb().select({ contentLanguage: workspaceSettings.defaultContentLanguage })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  if (!row) throw new Error("CONTENT_LANGUAGE_UNAVAILABLE");
  return validateWorkspaceContentLanguage(row.contentLanguage);
}

export async function updateWorkspaceContentLanguage(input: {
  workspaceId: string;
  contentLanguage: unknown;
}): Promise<WorkspaceContentLanguage> {
  const contentLanguage = validateWorkspaceContentLanguage(input.contentLanguage);
  const [row] = await getDb().update(workspaceSettings).set({
    defaultContentLanguage: contentLanguage,
    updatedAt: new Date(),
  }).where(eq(workspaceSettings.workspaceId, input.workspaceId)).returning({
    contentLanguage: workspaceSettings.defaultContentLanguage,
  });
  if (!row) throw new Error("CONTENT_LANGUAGE_UNAVAILABLE");
  return validateWorkspaceContentLanguage(row.contentLanguage);
}
