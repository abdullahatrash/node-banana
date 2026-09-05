export type CommercialSummary = {
  subscription: null | { state: string; planId: string; planVersion: number; authoredName: { ar: string; en: string }; entitlements: Record<string, number | boolean>; currentPeriodEndsAt: string; graceEndsAt: string | null; merchantCustomerRef: string | null; merchantSubscriptionRef: string | null };
  plans: Array<{ planId: string; version: number; authoredName: { ar: string; en: string }; currency: string; priceMinor: number; billingInterval: string; trialDays: number; trialCreditUnits: number; entitlements: Record<string, number | boolean> }>;
  creditPacks: Array<{ packId: string; version: number; authoredName: { ar: string; en: string }; creditUnits: number; currency: string; priceMinor: number; taxMinor: number }>;
  quotes: Array<{ id: string; state: string; purposeRef: string; maxCreditDebit: number; currency: string | null; localPriceMinor: number | null; taxMinor: number | null; expiresAt: string }>;
  credit: { availableUnits: number; liabilityUnits: number; buckets: Array<{ id: string; kind: string; availableUnits: number; expiresAt: string | null }>; heldReservations: Array<{ id: string; state: string; maxDebitUnits: number }>; recentEntries: Array<{ id: string; entryType: string; deltaUnits: number; balanceAfterUnits: number; createdAt: string }> };
  financials: { transactions: Array<{ provider: string; transactionRef: string; purposeKind: string; merchantReceiptRef: string; amountMinor: number; refundedMinor: number; currency: string; invoiceNumber: string | null; periodStartsAt: string | null; periodEndsAt: string | null; status: string; providerOccurredAt: string }>; adjustments: Array<{ provider: string; adjustmentRef: string; transactionRef: string; action: string; status: string; amountMinor: number; currency: string; providerOccurredAt: string }>; executionHolds: Array<{ provider: string; transactionRef: string; merchantSubscriptionRef: string; periodStartsAt: string; periodEndsAt: string; reason: string; state: string }> };
  referrals: { codes: Array<{ id: string; code: string; rewardMode: string; status: string }>; rewards: Array<{ id: string; mode: string; state: string; creditUnits: number | null; cashMinor: number | null; currency: string | null }>; payoutEntries: Array<{ id: string; entryType: string; amountMinor: number; currency: string }> };
};

export type CommercialStatusSummary = {
  subscription: null | { state: string; planId: string; currentPeriodEndsAt: string };
  plans: Array<{ planId: string; authoredName: { ar: string; en: string } }>;
  credit: { availableUnits: number };
};

export function projectCommercialStatusSummary(summary: CommercialSummary): CommercialStatusSummary {
  return {
    subscription: summary.subscription ? {
      state: summary.subscription.state,
      planId: summary.subscription.planId,
      currentPeriodEndsAt: summary.subscription.currentPeriodEndsAt,
    } : null,
    plans: summary.plans.map((plan) => ({ planId: plan.planId, authoredName: plan.authoredName })),
    credit: { availableUnits: summary.credit.availableUnits },
  };
}

export function readCommercialSummary(value: unknown): CommercialSummary | null {
  if (!value || typeof value !== "object") return null;
  const summary = value as Partial<CommercialSummary>;
  if (!summary.credit || typeof summary.credit.availableUnits !== "number" || typeof summary.credit.liabilityUnits !== "number" || !Array.isArray(summary.plans) || !summary.financials || !Array.isArray(summary.financials.transactions) || !Array.isArray(summary.financials.adjustments) || !Array.isArray(summary.financials.executionHolds)) return null;
  if (summary.subscription !== null && (typeof summary.subscription !== "object" || typeof summary.subscription.planId !== "string" || typeof summary.subscription.state !== "string" || typeof summary.subscription.currentPeriodEndsAt !== "string" || !summary.subscription.authoredName || !summary.subscription.entitlements)) return null;
  return summary as CommercialSummary;
}
