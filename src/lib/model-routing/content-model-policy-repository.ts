import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import type { ContentModelPolicy } from "@/lib/product-surfaces/content-model-policy";
import { contentModelPolicyCurrents, contentModelPolicyRevisions } from "./db-schema";

type Db = ReturnType<typeof getDb>;

/**
 * Persists immutable policy evidence and proves that the exact revision became
 * the single current policy for its Workspace and format. Database triggers
 * serialize promotions and reject attempts to promote stale revisions.
 */
export async function persistCurrentContentModelPolicy(
  db: Db,
  workspaceId: string,
  policy: ContentModelPolicy,
  createdAt = new Date(),
): Promise<boolean> {
  await db.insert(contentModelPolicyRevisions).values({
    workspaceId,
    id: policy.id,
    revision: policy.revision,
    format: policy.format,
    status: "active",
    policy,
    policyDigest: policy.digest,
    createdAt,
  }).onConflictDoNothing();

  const [stored] = await db
    .select({ digest: contentModelPolicyRevisions.policyDigest })
    .from(contentModelPolicyRevisions)
    .innerJoin(contentModelPolicyCurrents, and(
      eq(contentModelPolicyCurrents.workspaceId, contentModelPolicyRevisions.workspaceId),
      eq(contentModelPolicyCurrents.format, contentModelPolicyRevisions.format),
      eq(contentModelPolicyCurrents.policyId, contentModelPolicyRevisions.id),
      eq(contentModelPolicyCurrents.policyRevision, contentModelPolicyRevisions.revision),
      eq(contentModelPolicyCurrents.policyDigest, contentModelPolicyRevisions.policyDigest),
    ))
    .where(and(
      eq(contentModelPolicyRevisions.workspaceId, workspaceId),
      eq(contentModelPolicyRevisions.id, policy.id),
      eq(contentModelPolicyRevisions.revision, policy.revision),
      eq(contentModelPolicyRevisions.format, policy.format),
      eq(contentModelPolicyRevisions.status, "active"),
    ))
    .limit(1);

  return stored?.digest === policy.digest;
}
