export type CreditBucketKind = "allowance" | "purchased" | "referral";
export type CreditAllocation = { bucketId: string; kind: CreditBucketKind; units: number; expiresAt: Date | null };

export function allocateCredits(input: { requiredUnits: number; at: Date; buckets: Array<{ id: string; kind: CreditBucketKind; availableUnits: number; expiresAt: Date | null; createdAt: Date }> }) {
  if (!Number.isSafeInteger(input.requiredUnits) || input.requiredUnits <= 0) throw new Error("CREDIT_DEBIT_INVALID");
  const rank: Record<CreditBucketKind, number> = { allowance: 0, purchased: 1, referral: 2 };
  const eligible = input.buckets.filter((bucket) => bucket.availableUnits > 0 && (!bucket.expiresAt || bucket.expiresAt > input.at)).sort((a, b) => rank[a.kind] - rank[b.kind] || (a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  let remaining = input.requiredUnits; const allocations: CreditAllocation[] = [];
  for (const bucket of eligible) { const units = Math.min(bucket.availableUnits, remaining); if (units) allocations.push({ bucketId: bucket.id, kind: bucket.kind, units, expiresAt: bucket.expiresAt }); remaining -= units; if (!remaining) break; }
  if (remaining) return { kind: "insufficient" as const, requiredUnits: input.requiredUnits, availableUnits: input.requiredUnits - remaining };
  return { kind: "allocated" as const, allocations };
}

export const SUBSCRIPTION_TRANSITIONS: Record<string, readonly string[]> = {
  trialing: ["active", "past_due", "cancelled", "suspended"], active: ["past_due", "cancel_at_period_end", "suspended"], past_due: ["active", "grace", "cancelled", "suspended"], grace: ["active", "cancelled", "suspended"], cancel_at_period_end: ["active", "cancelled"], cancelled: ["active"], suspended: ["active", "cancelled"],
};
