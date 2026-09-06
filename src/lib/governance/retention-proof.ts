import { createHash } from "node:crypto";
import type { GovernanceResource } from "./types";

interface RightsHoldBody {
  retentionClasses?: unknown;
  scopeReview?: unknown;
  expiresAt?: unknown;
}

/** Mirrors the fail-closed SQL eligibility rule for the rights evidence class. */
export function generationRightsBlockingHoldIds(
  holds: Array<Pick<GovernanceResource<RightsHoldBody>, "id" | "status" | "body">>,
  activePolicyRevision: number,
  evaluatedAt: Date,
): string[] {
  return holds.filter((hold) => {
    if (hold.status !== "active") return false;
    if (typeof hold.body.expiresAt === "string") {
      if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(hold.body.expiresAt)) return true;
      const expiresAt = new Date(hold.body.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== hold.body.expiresAt) return true;
      if (expiresAt <= evaluatedAt) return false;
    } else if (hold.body.expiresAt !== null && hold.body.expiresAt !== undefined) {
      return true;
    }
    if (!Array.isArray(hold.body.retentionClasses)) return true;
    if (hold.body.retentionClasses.includes("generation_rights_evidence")) return true;
    if (!hold.body.scopeReview || typeof hold.body.scopeReview !== "object" || Array.isArray(hold.body.scopeReview)) return true;
    const review = hold.body.scopeReview as Record<string, unknown>;
    return review.schema !== "retention-hold-scope-review/v2"
      || review.reviewedAgainstPolicyRevision !== activePolicyRevision
      || review.generationRightsEvidence !== "not_applicable";
  }).map((hold) => hold.id).sort();
}

export function generationRightsRetentionReceiptKey(closureId: string, leaseId: string, leaseFence: number): string {
  const identity = createHash("sha256").update(`${closureId}:${leaseId}`).digest("hex").slice(0, 24);
  return `rights-retention-${identity}-${leaseFence}`;
}
