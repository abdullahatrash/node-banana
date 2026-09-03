import { DrizzleGovernanceRepository } from "./postgres-repository";
import type { GovernanceRepository } from "./types";
import { getDb } from "@/lib/db";

export async function requiresGovernedPublishingPlan(
  workspaceId: string,
  repository: GovernanceRepository = new DrizzleGovernanceRepository(getDb),
): Promise<boolean> {
  const policies = await repository.listResources<{ activeRevision: number; revisions: Array<{ revision: number; purpose: string }> }>({
    workspaceId,
    kinds: ["approval_policy"],
    status: "active",
  });
  return policies.some((policy) => policy.body.revisions.some((revision) => revision.revision === policy.body.activeRevision && revision.purpose === "publishing_approval"));
}
