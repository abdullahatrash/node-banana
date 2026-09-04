import "server-only"

import { and, eq } from "drizzle-orm"
import { canonicalDigest } from "@/lib/agent-tools/canonical"
import { getDb } from "@/lib/db"
import { brandProfiles } from "@/lib/db/schema"
import { getDashboardReadModel } from "./dashboard"
import { projectProductCopilotContext, type ProductCopilotBrandPin } from "./copilot-context-projection"

export async function getProductCopilotContext(workspaceId: string, generatedAt = new Date()) {
  const [dashboard, rows] = await Promise.all([
    getDashboardReadModel(workspaceId),
    getDb().select({ id: brandProfiles.id, revision: brandProfiles.revision, profile: brandProfiles.profile, acceptedAt: brandProfiles.acceptedAt })
      .from(brandProfiles)
      .where(and(eq(brandProfiles.workspaceId, workspaceId), eq(brandProfiles.status, "active")))
      .limit(1),
  ])
  const row = rows[0]
  const contentLanguage = row && (row.profile.contentLanguage === "ar" || row.profile.contentLanguage === "en" || row.profile.contentLanguage === "mixed") ? row.profile.contentLanguage : null
  const brand: ProductCopilotBrandPin | null = row?.acceptedAt && contentLanguage ? {
    profileId: row.id,
    revision: row.revision,
    digest: canonicalDigest(row.profile) as `sha256:${string}`,
    acceptedAt: row.acceptedAt,
    contentLanguage,
    arabicVariety: contentLanguage === "ar" ? "msa" : null,
  } : null
  return projectProductCopilotContext({ dashboard, brand, generatedAt })
}
