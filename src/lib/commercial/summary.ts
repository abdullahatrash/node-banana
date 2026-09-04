export type CommercialSummary = {
  subscription: null | { state: string; planId: string; planVersion: number; currentPeriodEndsAt: string; graceEndsAt: string | null; merchantCustomerRef: string | null; merchantSubscriptionRef: string | null };
  plans: Array<{ planId: string; version: number; authoredName: { ar: string; en: string }; currency: string; priceMinor: number; billingInterval: string; trialDays: number; trialCreditUnits: number; entitlements: Record<string, number | boolean> }>;
  creditPacks: Array<{ packId: string; version: number; authoredName: { ar: string; en: string }; creditUnits: number; currency: string; priceMinor: number; taxMinor: number }>;
  quotes: Array<{ id: string; state: string; purposeRef: string; maxCreditDebit: number; currency: string | null; localPriceMinor: number | null; taxMinor: number | null; expiresAt: string }>;
  credit: { availableUnits: number; buckets: Array<{ id: string; kind: string; availableUnits: number; expiresAt: string | null }>; heldReservations: Array<{ id: string; state: string; maxDebitUnits: number }>; recentEntries: Array<{ id: string; entryType: string; deltaUnits: number; balanceAfterUnits: number; createdAt: string }> };
  referrals: { codes: Array<{ id: string; code: string; rewardMode: string; status: string }>; rewards: Array<{ id: string; mode: string; state: string; creditUnits: number | null; cashMinor: number | null; currency: string | null }>; payoutEntries: Array<{ id: string; entryType: string; amountMinor: number; currency: string }> };
};

export function readCommercialSummary(value: unknown): CommercialSummary | null {
  if (!value || typeof value !== "object") return null;
  const summary = value as Partial<CommercialSummary>;
  if (!summary.credit || typeof summary.credit.availableUnits !== "number" || !Array.isArray(summary.plans)) return null;
  if (summary.subscription !== null && (typeof summary.subscription !== "object" || typeof summary.subscription.planId !== "string" || typeof summary.subscription.state !== "string" || typeof summary.subscription.currentPeriodEndsAt !== "string")) return null;
  return summary as CommercialSummary;
}
