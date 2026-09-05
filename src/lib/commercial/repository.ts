import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { billingPlanVersions, billingTrialGrants, commercialCommandReceipts, generationCreditBuckets, generationCreditLedgerEntries, generationCreditPackVersions, generationCreditReservations, managedExecutionCommercialQuotes, merchantBillingAdjustments, merchantBillingTransactions, merchantCreditLiabilities, merchantExecutionHolds, referralAttributions, referralCaptureReceipts, referralFraudEvidence, referralPayoutEvents, referralPayoutLedgerEntries, referralPayoutRequestRewards, referralPayoutRequests, referralRecipientProfileRevisions, referralRecipientProfiles, referralRewards, user, workspaceReferralCodes, workspaceSubscriptionEvents, workspaceSubscriptions, workspaces } from "@/lib/db/schema";
import { allocateCredits, SUBSCRIPTION_TRANSITIONS } from "./types";
import { reconcileReleasedCredits } from "./financial-evidence";
import { createReferralCaptureToken, isReferralCaptureToken, REFERRAL_CAPTURE_TTL_SECONDS, referralCaptureTokenDigest } from "./referral-capture";
import { canTransitionReferralPayout, type ReferralPayoutState } from "./referral-payout-state";

type Db = ReturnType<typeof getDb>; export class CommercialError extends Error { constructor(readonly code: string) { super(code); this.name = "CommercialError"; } }
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const safeSequence = async (tx: Parameters<Parameters<Db["transaction"]>[0]>[0], workspaceId: string, table: typeof generationCreditLedgerEntries | typeof referralPayoutLedgerEntries) => Number((await tx.select({ value: sql<number>`coalesce(max(${table.sequence}), 0)` }).from(table).where(eq(table.workspaceId, workspaceId)))[0]?.value ?? 0) + 1;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const claimCommand = async (tx: Tx, input: { workspaceId: string; idempotencyKey: string; request: unknown }) => {
  const requestDigest = canonicalDigest(input.request);
  const inserted = await tx.insert(commercialCommandReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest, result: { state: "processing" } }).onConflictDoNothing().returning({ key: commercialCommandReceipts.idempotencyKey });
  if (inserted[0]) return { kind: "claimed" as const, requestDigest };
  const [receipt] = await tx.select().from(commercialCommandReceipts).where(and(eq(commercialCommandReceipts.workspaceId, input.workspaceId), eq(commercialCommandReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
  if (!receipt || receipt.requestDigest !== requestDigest) throw new CommercialError("IDEMPOTENCY_CONFLICT");
  return { kind: "replay" as const, result: receipt.result };
};
const completeCommand = async (tx: Tx, input: { workspaceId: string; idempotencyKey: string; requestDigest: string; result: Record<string, unknown> }) => {
  const updated = await tx.update(commercialCommandReceipts).set({ result: input.result }).where(and(eq(commercialCommandReceipts.workspaceId, input.workspaceId), eq(commercialCommandReceipts.idempotencyKey, input.idempotencyKey), eq(commercialCommandReceipts.requestDigest, input.requestDigest))).returning({ key: commercialCommandReceipts.idempotencyKey });
  if (!updated[0]) throw new CommercialError("IDEMPOTENCY_CONFLICT");
};
export class CommercialRepository {
  constructor(private readonly database: Db = getDb(), private readonly now = () => new Date()) {}
  async status(workspaceId: string) {
    const now = this.now();
    const [subscriptions, plans, creditRows] = await Promise.all([
      this.database.select({ state: workspaceSubscriptions.state, planId: workspaceSubscriptions.planId, currentPeriodEndsAt: workspaceSubscriptions.currentPeriodEndsAt }).from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, workspaceId)).limit(1),
      this.database.select({ planId: billingPlanVersions.planId, authoredName: billingPlanVersions.authoredName }).from(billingPlanVersions).where(and(eq(billingPlanVersions.status, "active"), sql`${billingPlanVersions.effectiveAt} <= ${now}`, or(isNull(billingPlanVersions.retiredAt), gt(billingPlanVersions.retiredAt, now)))).orderBy(asc(billingPlanVersions.priceMinor)),
      this.database.select({ availableUnits: sql<string>`coalesce(sum(${generationCreditBuckets.availableUnits}), 0)::text` }).from(generationCreditBuckets).where(and(eq(generationCreditBuckets.workspaceId, workspaceId), or(isNull(generationCreditBuckets.expiresAt), gt(generationCreditBuckets.expiresAt, now)))),
    ]);
    const subscription = subscriptions[0];
    return {
      subscription: subscription ? { ...subscription, currentPeriodEndsAt: subscription.currentPeriodEndsAt.toISOString() } : null,
      plans,
      credit: { availableUnits: Number(creditRows[0]?.availableUnits ?? 0) },
    };
  }
  async summary(workspaceId: string) {
    const now = this.now(); const [subscription, plans, packs, buckets, reservations, quotes, codes, rewards, payouts, entries, transactions, adjustments, liabilities, executionHolds] = await Promise.all([
      this.database.select({
        workspaceId: workspaceSubscriptions.workspaceId,
        state: workspaceSubscriptions.state,
        planId: workspaceSubscriptions.planId,
        planVersion: workspaceSubscriptions.planVersion,
        authoredName: billingPlanVersions.authoredName,
        entitlements: billingPlanVersions.entitlements,
        trialGrantId: workspaceSubscriptions.trialGrantId,
        merchantCustomerRef: workspaceSubscriptions.merchantCustomerRef,
        merchantSubscriptionRef: workspaceSubscriptions.merchantSubscriptionRef,
        merchantLastEventAt: workspaceSubscriptions.merchantLastEventAt,
        merchantLastEventId: workspaceSubscriptions.merchantLastEventId,
        currentPeriodStartsAt: workspaceSubscriptions.currentPeriodStartsAt,
        currentPeriodEndsAt: workspaceSubscriptions.currentPeriodEndsAt,
        graceEndsAt: workspaceSubscriptions.graceEndsAt,
        revision: workspaceSubscriptions.revision,
        updatedAt: workspaceSubscriptions.updatedAt,
      }).from(workspaceSubscriptions).innerJoin(billingPlanVersions, and(eq(billingPlanVersions.planId, workspaceSubscriptions.planId), eq(billingPlanVersions.version, workspaceSubscriptions.planVersion))).where(eq(workspaceSubscriptions.workspaceId, workspaceId)).limit(1),
      this.database.select().from(billingPlanVersions).where(and(eq(billingPlanVersions.status, "active"), sql`${billingPlanVersions.effectiveAt} <= ${now}`, or(isNull(billingPlanVersions.retiredAt), gt(billingPlanVersions.retiredAt, now)))).orderBy(asc(billingPlanVersions.priceMinor)),
      this.database.select().from(generationCreditPackVersions).where(and(eq(generationCreditPackVersions.status, "active"), sql`${generationCreditPackVersions.effectiveAt} <= ${now}`, or(isNull(generationCreditPackVersions.retiredAt), gt(generationCreditPackVersions.retiredAt, now)))).orderBy(asc(generationCreditPackVersions.priceMinor)),
      this.database.select().from(generationCreditBuckets).where(and(eq(generationCreditBuckets.workspaceId, workspaceId), or(isNull(generationCreditBuckets.expiresAt), gt(generationCreditBuckets.expiresAt, now)))).orderBy(asc(generationCreditBuckets.kind), asc(generationCreditBuckets.expiresAt)),
      this.database.select().from(generationCreditReservations).where(and(eq(generationCreditReservations.workspaceId, workspaceId), inArray(generationCreditReservations.state, ["held", "outcome_unknown"]))).orderBy(desc(generationCreditReservations.updatedAt)),
      this.database.select().from(managedExecutionCommercialQuotes).where(and(eq(managedExecutionCommercialQuotes.workspaceId, workspaceId), inArray(managedExecutionCommercialQuotes.state, ["offered", "accepted", "reserved", "outcome_unknown"]))).orderBy(desc(managedExecutionCommercialQuotes.issuedAt)).limit(100),
      this.database.select().from(workspaceReferralCodes).where(eq(workspaceReferralCodes.workspaceId, workspaceId)).orderBy(desc(workspaceReferralCodes.createdAt)),
      this.database.select().from(referralRewards).where(eq(referralRewards.workspaceId, workspaceId)).orderBy(desc(referralRewards.updatedAt)).limit(100),
      this.database.select().from(referralPayoutLedgerEntries).where(eq(referralPayoutLedgerEntries.workspaceId, workspaceId)).orderBy(desc(referralPayoutLedgerEntries.sequence)).limit(100),
      this.database.select().from(generationCreditLedgerEntries).where(eq(generationCreditLedgerEntries.workspaceId, workspaceId)).orderBy(desc(generationCreditLedgerEntries.sequence)).limit(100),
      this.database.select().from(merchantBillingTransactions).where(eq(merchantBillingTransactions.workspaceId, workspaceId)).orderBy(desc(merchantBillingTransactions.providerOccurredAt), desc(merchantBillingTransactions.transactionRef)).limit(100),
      this.database.select().from(merchantBillingAdjustments).where(eq(merchantBillingAdjustments.workspaceId, workspaceId)).orderBy(desc(merchantBillingAdjustments.providerOccurredAt), desc(merchantBillingAdjustments.adjustmentRef)).limit(100),
      this.database.select().from(merchantCreditLiabilities).where(eq(merchantCreditLiabilities.workspaceId, workspaceId)),
      this.database.select().from(merchantExecutionHolds).where(and(eq(merchantExecutionHolds.workspaceId, workspaceId), eq(merchantExecutionHolds.state, "active"))),
    ]);
    const current = subscription[0];
    const currentExecutionHolds = current?.merchantSubscriptionRef ? executionHolds.filter((hold) => hold.merchantSubscriptionRef === current.merchantSubscriptionRef && hold.periodStartsAt.getTime() === current.currentPeriodStartsAt.getTime() && hold.periodEndsAt.getTime() === current.currentPeriodEndsAt.getTime()) : [];
    return { subscription: current ?? null, plans, creditPacks: packs, quotes, credit: { availableUnits: buckets.reduce((sum, row) => sum + row.availableUnits, 0), liabilityUnits: liabilities.reduce((sum, row) => sum + row.outstandingUnits, 0), buckets, heldReservations: reservations, recentEntries: entries }, financials: { transactions, adjustments, executionHolds: currentExecutionHolds }, referrals: { codes, rewards, payoutEntries: payouts } };
  }
  async referralDashboard(workspaceId: string, userId?: string) {
    const [codes, captureStates, attributionStates, rewards, payoutEntries, recipientProfiles, payoutRequests] = await Promise.all([
      this.database.select({ id: workspaceReferralCodes.id, code: workspaceReferralCodes.code, rewardMode: workspaceReferralCodes.rewardMode, status: workspaceReferralCodes.status, createdAt: workspaceReferralCodes.createdAt }).from(workspaceReferralCodes).where(eq(workspaceReferralCodes.workspaceId, workspaceId)).orderBy(desc(workspaceReferralCodes.createdAt)),
      this.database.select({ state: referralCaptureReceipts.state, count: sql<number>`count(*)::int` }).from(referralCaptureReceipts).where(eq(referralCaptureReceipts.referrerWorkspaceId, workspaceId)).groupBy(referralCaptureReceipts.state),
      this.database.select({ state: referralAttributions.state, count: sql<number>`count(*)::int` }).from(referralAttributions).where(eq(referralAttributions.referrerWorkspaceId, workspaceId)).groupBy(referralAttributions.state),
      this.database.select({ id: referralRewards.id, mode: referralRewards.mode, state: referralRewards.state, creditUnits: referralRewards.creditUnits, cashMinor: referralRewards.cashMinor, currency: referralRewards.currency, thresholdMinor: referralRewards.thresholdMinor, createdAt: referralRewards.createdAt, updatedAt: referralRewards.updatedAt }).from(referralRewards).where(eq(referralRewards.workspaceId, workspaceId)).orderBy(desc(referralRewards.updatedAt)).limit(100),
      this.database.select({ sequence: referralPayoutLedgerEntries.sequence, id: referralPayoutLedgerEntries.id, rewardId: referralPayoutLedgerEntries.rewardId, entryType: referralPayoutLedgerEntries.entryType, amountMinor: referralPayoutLedgerEntries.amountMinor, currency: referralPayoutLedgerEntries.currency, occurredAt: referralPayoutLedgerEntries.occurredAt }).from(referralPayoutLedgerEntries).where(eq(referralPayoutLedgerEntries.workspaceId, workspaceId)).orderBy(desc(referralPayoutLedgerEntries.sequence)).limit(100),
      userId ? this.database.select().from(referralRecipientProfiles).where(and(eq(referralRecipientProfiles.workspaceId, workspaceId), eq(referralRecipientProfiles.userId, userId))).limit(1) : Promise.resolve([]),
      userId ? this.database.select({ id: referralPayoutRequests.id, state: referralPayoutRequests.state, currency: referralPayoutRequests.currency, totalMinor: referralPayoutRequests.totalMinor, submittedAt: referralPayoutRequests.submittedAt, updatedAt: referralPayoutRequests.updatedAt, paidAt: referralPayoutRequests.paidAt }).from(referralPayoutRequests).where(and(eq(referralPayoutRequests.workspaceId, workspaceId), eq(referralPayoutRequests.recipientUserId, userId))).orderBy(desc(referralPayoutRequests.updatedAt)).limit(100) : Promise.resolve([]),
    ]);
    const captureCounts = Object.fromEntries(captureStates.map((row) => [row.state, row.count]));
    const attributionCounts = Object.fromEntries(attributionStates.map((row) => [row.state, row.count]));
    const clicks = Object.values(captureCounts).reduce((sum, count) => sum + count, 0);
    const leads = Object.values(attributionCounts).reduce((sum, count) => sum + count, 0);
    const sales = ["qualified", "rewarded", "refunded", "clawed_back"].reduce((sum, state) => sum + (attributionCounts[state] ?? 0), 0);
    return {
      metrics: { clicks, leads, sales, rewards: rewards.length },
      captureCounts,
      attributionCounts,
      codes: codes.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      rewards: rewards.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
      payoutEntries: payoutEntries.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      recipientProfile: recipientProfiles[0] ? { rewardPreference: recipientProfiles[0].rewardPreference, verificationState: recipientProfiles[0].verificationState, legalCountry: recipientProfiles[0].legalCountry, payoutCurrency: recipientProfiles[0].payoutCurrency, payoutProvider: recipientProfiles[0].payoutProvider, hasProviderRecipient: Boolean(recipientProfiles[0].providerRecipientRef), hasTaxEvidence: Boolean(recipientProfiles[0].taxEvidenceRef), termsAcceptedAt: recipientProfiles[0].termsAcceptedAt?.toISOString() ?? null, revision: recipientProfiles[0].revision, updatedAt: recipientProfiles[0].updatedAt.toISOString() } : null,
      payoutRequests: payoutRequests.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), paidAt: row.paidAt?.toISOString() ?? null })),
    };
  }
  async publishPlan(input: typeof billingPlanVersions.$inferInsert) { await this.database.insert(billingPlanVersions).values(input); return input; }
  async startTrial(input: { workspaceId: string; userId: string; planId: string; planVersion: number; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "start_trial", userId: input.userId, planId: input.planId, planVersion: input.planVersion } });
      if (command.kind === "replay") return command.result;
      const [identity, plan] = await Promise.all([
        tx.select({ email: user.email }).from(user).where(eq(user.id, input.userId)).limit(1),
        tx.select().from(billingPlanVersions).where(and(eq(billingPlanVersions.planId, input.planId), eq(billingPlanVersions.version, input.planVersion), eq(billingPlanVersions.status, "active"))).limit(1),
      ]);
      if (!identity[0] || !plan[0] || plan[0].trialDays <= 0) throw new CommercialError("TRIAL_NOT_AVAILABLE");
      const existing = await tx.select().from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, input.workspaceId)).for("update").limit(1);
      const current = existing[0] ?? null;
      const isFreeUpgrade = current?.state === "active" && current.planId === "free" && current.planVersion === 1;
      if (current && !isFreeUpgrade) throw new CommercialError("SUBSCRIPTION_EXISTS");
      const beneficiaryIdentityDigest = digest(identity[0].email.trim().toLowerCase()); const already = await tx.select({ id: billingTrialGrants.id }).from(billingTrialGrants).where(eq(billingTrialGrants.beneficiaryIdentityDigest, beneficiaryIdentityDigest)).limit(1); if (already[0]) throw new CommercialError("TRIAL_ALREADY_USED");
      const now = this.now(), expiresAt = new Date(now.getTime() + plan[0].trialDays * 86_400_000), trialId = randomUUID(), bucketId = randomUUID(), subscriptionEventId = randomUUID(), revision = (current?.revision ?? 0) + 1;
      await tx.insert(billingTrialGrants).values({ id: trialId, workspaceId: input.workspaceId, beneficiaryIdentityDigest, planId: input.planId, planVersion: input.planVersion, status: "active", grantedAt: now, expiresAt });
      if (current) {
        await tx.update(workspaceSubscriptions).set({ state: "trialing", planId: input.planId, planVersion: input.planVersion, trialGrantId: trialId, merchantCustomerRef: null, merchantSubscriptionRef: null, currentPeriodStartsAt: now, currentPeriodEndsAt: expiresAt, graceEndsAt: null, revision, updatedAt: now }).where(and(eq(workspaceSubscriptions.workspaceId, input.workspaceId), eq(workspaceSubscriptions.revision, current.revision)));
      } else {
        await tx.insert(workspaceSubscriptions).values({ workspaceId: input.workspaceId, state: "trialing", planId: input.planId, planVersion: input.planVersion, trialGrantId: trialId, currentPeriodStartsAt: now, currentPeriodEndsAt: expiresAt, revision, updatedAt: now });
      }
      await tx.insert(workspaceSubscriptionEvents).values({ workspaceId: input.workspaceId, revision, id: subscriptionEventId, fromState: current?.state ?? null, toState: "trialing", reasonCode: "trial.started", actorRef: `human:${input.userId}`, facts: { planId: input.planId, planVersion: input.planVersion, trialGrantId: trialId, upgradedFromPlanId: current?.planId ?? null, upgradedFromPlanVersion: current?.planVersion ?? null }, occurredAt: now });
      if (plan[0].trialCreditUnits > 0) { const sequence = await safeSequence(tx, input.workspaceId, generationCreditLedgerEntries); await tx.insert(generationCreditBuckets).values({ workspaceId: input.workspaceId, id: bucketId, kind: "allowance", sourceRef: `trial:${trialId}`, grantedUnits: plan[0].trialCreditUnits, availableUnits: plan[0].trialCreditUnits, expiresAt, revision: 1, createdAt: now, updatedAt: now }); await tx.insert(generationCreditLedgerEntries).values({ workspaceId: input.workspaceId, sequence, id: randomUUID(), bucketId, reservationId: null, entryType: "grant", deltaUnits: plan[0].trialCreditUnits, balanceAfterUnits: plan[0].trialCreditUnits, sourceRef: `trial:${trialId}`, createdAt: now }); }
      const result = { subscriptionState: "trialing", trialId, expiresAt: expiresAt.toISOString(), grantedUnits: plan[0].trialCreditUnits, subscriptionEventId, occurredAt: now.toISOString() };
      await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result });
      return result;
    });
  }
  async issueQuote(input: { workspaceId: string; purposeRef: string; maxCreditDebit: number; pricingSnapshotDigest: string; expiresAt: Date; localPriceMinor: number | null; currency: string | null; taxMinor: number | null; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      const { idempotencyKey, ...request } = input;
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey, request: { action: "issue_quote", ...request, expiresAt: input.expiresAt.toISOString() } });
      if (command.kind === "replay") return command.result;
      const now = this.now(); if (input.expiresAt <= now) throw new CommercialError("QUOTE_EXPIRY_INVALID");
      const id = randomUUID();
      await tx.insert(managedExecutionCommercialQuotes).values({ ...request, id, state: "offered", issuedAt: now });
      const result = { id, state: "offered", maxCreditDebit: input.maxCreditDebit, expiresAt: input.expiresAt.toISOString() };
      await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey, requestDigest: command.requestDigest, result });
      return result;
    });
  }
  async acceptQuote(input: { workspaceId: string; userId: string; quoteId: string; idempotencyKey: string }) { return this.database.transaction(async (tx) => { const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "accept_quote", userId: input.userId, quoteId: input.quoteId } }); if (command.kind === "replay") return command.result; const now = this.now(); const updated = await tx.update(managedExecutionCommercialQuotes).set({ state: "accepted", acceptedByUserId: input.userId, acceptedAt: now }).where(and(eq(managedExecutionCommercialQuotes.workspaceId, input.workspaceId), eq(managedExecutionCommercialQuotes.id, input.quoteId), eq(managedExecutionCommercialQuotes.state, "offered"), gt(managedExecutionCommercialQuotes.expiresAt, now))).returning(); if (!updated[0]) throw new CommercialError("QUOTE_NOT_ACCEPTABLE"); const result = { quoteId: updated[0].id, state: updated[0].state, acceptedAt: now.toISOString() }; await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result }); return result; }); }
  async reserveQuote(input: { workspaceId: string; quoteId: string; externalEffectRef: string | null; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "reserve_quote", quoteId: input.quoteId, externalEffectRef: input.externalEffectRef } }); if (command.kind === "replay") return command.result;
      const [subscription] = await tx.select().from(workspaceSubscriptions).where(and(eq(workspaceSubscriptions.workspaceId, input.workspaceId), inArray(workspaceSubscriptions.state, ["trialing", "active", "grace"]))).for("update").limit(1); if (!subscription) throw new CommercialError("ENTITLEMENT_REQUIRED");
      if (subscription.merchantSubscriptionRef) {
        const [executionHold] = await tx.select({ transactionRef: merchantExecutionHolds.transactionRef }).from(merchantExecutionHolds).where(and(eq(merchantExecutionHolds.workspaceId, input.workspaceId), eq(merchantExecutionHolds.merchantSubscriptionRef, subscription.merchantSubscriptionRef), eq(merchantExecutionHolds.periodStartsAt, subscription.currentPeriodStartsAt), eq(merchantExecutionHolds.periodEndsAt, subscription.currentPeriodEndsAt), eq(merchantExecutionHolds.state, "active"))).for("update").limit(1);
        if (executionHold) throw new CommercialError("SUBSCRIPTION_FINANCIAL_HOLD");
      }
      const [liability] = await tx.select().from(merchantCreditLiabilities).where(and(eq(merchantCreditLiabilities.workspaceId, input.workspaceId), eq(merchantCreditLiabilities.state, "open"), gt(merchantCreditLiabilities.outstandingUnits, 0))).for("update").limit(1); if (liability) throw new CommercialError("COMMERCIAL_LIABILITY_OUTSTANDING");
      const [quote] = await tx.select().from(managedExecutionCommercialQuotes).where(and(eq(managedExecutionCommercialQuotes.workspaceId, input.workspaceId), eq(managedExecutionCommercialQuotes.id, input.quoteId), eq(managedExecutionCommercialQuotes.state, "accepted"), gt(managedExecutionCommercialQuotes.expiresAt, this.now()))).for("update").limit(1); if (!quote) throw new CommercialError("QUOTE_NOT_RESERVABLE");
      const buckets = await tx.select().from(generationCreditBuckets).where(and(eq(generationCreditBuckets.workspaceId, input.workspaceId), gt(generationCreditBuckets.availableUnits, 0), or(isNull(generationCreditBuckets.expiresAt), gt(generationCreditBuckets.expiresAt, this.now())))).orderBy(asc(generationCreditBuckets.kind), asc(generationCreditBuckets.expiresAt), asc(generationCreditBuckets.createdAt), asc(generationCreditBuckets.id)).for("update");
      const allocation = allocateCredits({ requiredUnits: quote.maxCreditDebit, at: this.now(), buckets: buckets.map((row) => ({ ...row, kind: row.kind as "allowance" | "purchased" | "referral" })) }); if (allocation.kind === "insufficient") throw new CommercialError("INSUFFICIENT_CREDITS");
      const now = this.now(), id = randomUUID(); let sequence = await safeSequence(tx, input.workspaceId, generationCreditLedgerEntries);
      await tx.insert(generationCreditReservations).values({ workspaceId: input.workspaceId, id, quoteId: quote.id, state: "held", maxDebitUnits: quote.maxCreditDebit, allocations: allocation.allocations.map(({ bucketId, units }) => ({ bucketId, units })), externalEffectRef: input.externalEffectRef, createdAt: now, updatedAt: now });
      for (const item of allocation.allocations) { const bucket = buckets.find((row) => row.id === item.bucketId)!; const balance = bucket.availableUnits - item.units; await tx.update(generationCreditBuckets).set({ availableUnits: balance, revision: sql`${generationCreditBuckets.revision}+1`, updatedAt: now }).where(and(eq(generationCreditBuckets.workspaceId, input.workspaceId), eq(generationCreditBuckets.id, item.bucketId), eq(generationCreditBuckets.revision, bucket.revision))); await tx.insert(generationCreditLedgerEntries).values({ workspaceId: input.workspaceId, sequence: sequence++, id: randomUUID(), bucketId: item.bucketId, reservationId: id, entryType: "reserve", deltaUnits: -item.units, balanceAfterUnits: balance, sourceRef: `quote:${quote.id}`, createdAt: now }); }
      await tx.update(managedExecutionCommercialQuotes).set({ state: "reserved" }).where(and(eq(managedExecutionCommercialQuotes.workspaceId, input.workspaceId), eq(managedExecutionCommercialQuotes.id, quote.id), eq(managedExecutionCommercialQuotes.state, "accepted")));
      const result = { reservationId: id, heldUnits: quote.maxCreditDebit, allocations: allocation.allocations };
      await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result });
      return result;
    });
  }
  async settleReservation(input: { workspaceId: string; reservationId: string; outcome: "succeeded" | "pre_start_cancelled" | "outcome_unknown"; actualDebitUnits: number | null; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "settle_reservation", reservationId: input.reservationId, outcome: input.outcome, actualDebitUnits: input.actualDebitUnits } }); if (command.kind === "replay") return command.result;
      await tx.select({ workspaceId: workspaceSubscriptions.workspaceId }).from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, input.workspaceId)).for("update").limit(1);
      const [reservation] = await tx.select().from(generationCreditReservations).where(and(eq(generationCreditReservations.workspaceId, input.workspaceId), eq(generationCreditReservations.id, input.reservationId), inArray(generationCreditReservations.state, ["held", "outcome_unknown"]))).for("update").limit(1); if (!reservation) throw new CommercialError("RESERVATION_NOT_SETTLEABLE");
      if (input.outcome === "outcome_unknown") { await tx.update(generationCreditReservations).set({ state: "outcome_unknown", updatedAt: this.now() }).where(and(eq(generationCreditReservations.workspaceId, input.workspaceId), eq(generationCreditReservations.id, input.reservationId))); await tx.update(managedExecutionCommercialQuotes).set({ state: "outcome_unknown" }).where(and(eq(managedExecutionCommercialQuotes.workspaceId, input.workspaceId), eq(managedExecutionCommercialQuotes.id, reservation.quoteId))); const result = { state: "outcome_unknown", heldUnits: reservation.maxDebitUnits }; await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result }); return result; }
      const actual = input.outcome === "pre_start_cancelled" ? 0 : input.actualDebitUnits; if (actual === null || actual < 0 || actual > reservation.maxDebitUnits) throw new CommercialError("ACTUAL_DEBIT_INVALID");
      let release = reservation.maxDebitUnits - actual, sequence = await safeSequence(tx, input.workspaceId, generationCreditLedgerEntries); const now = this.now();
      for (const allocation of reservation.allocations) {
        if (!release) break;
        const units = Math.min(allocation.units, release);
        const [liability] = await tx.select().from(merchantCreditLiabilities).where(and(eq(merchantCreditLiabilities.workspaceId, input.workspaceId), eq(merchantCreditLiabilities.bucketId, allocation.bucketId), eq(merchantCreditLiabilities.state, "open"), gt(merchantCreditLiabilities.outstandingUnits, 0))).for("update").limit(1);
        const [bucket] = await tx.select().from(generationCreditBuckets).where(and(eq(generationCreditBuckets.workspaceId, input.workspaceId), eq(generationCreditBuckets.id, allocation.bucketId))).for("update").limit(1);
        if (!bucket) throw new CommercialError("CREDIT_BUCKET_MISSING");
        const released = liability ? reconcileReleasedCredits({ releasedUnits: units, appliedUnits: liability.appliedClawbackUnits, outstandingUnits: liability.outstandingUnits, availableUnits: bucket.availableUnits, grantedUnits: bucket.grantedUnits, targetUnits: liability.targetClawbackUnits }) : { releasedBalanceUnits: bucket.availableUnits + units, availableUnits: bucket.availableUnits + units, clawbackUnits: 0, appliedUnits: 0, outstandingUnits: 0 };
        const liabilityUnits = released.clawbackUnits;
        const releasedBalance = released.releasedBalanceUnits;
        const balance = released.availableUnits;
        await tx.update(generationCreditBuckets).set({ availableUnits: balance, revision: sql`${generationCreditBuckets.revision}+1`, updatedAt: now }).where(and(eq(generationCreditBuckets.workspaceId, input.workspaceId), eq(generationCreditBuckets.id, bucket.id), eq(generationCreditBuckets.revision, bucket.revision)));
        await tx.insert(generationCreditLedgerEntries).values({ workspaceId: input.workspaceId, sequence: sequence++, id: randomUUID(), bucketId: bucket.id, reservationId: reservation.id, entryType: "release", deltaUnits: units, balanceAfterUnits: releasedBalance, sourceRef: `quote:${reservation.quoteId}`, createdAt: now });
        if (liability && liabilityUnits > 0) {
          const outstandingUnits = released.outstandingUnits;
          await tx.update(merchantCreditLiabilities).set({ appliedClawbackUnits: released.appliedUnits, outstandingUnits, state: outstandingUnits > 0 ? "open" : "clear", updatedAt: now }).where(and(eq(merchantCreditLiabilities.provider, liability.provider), eq(merchantCreditLiabilities.transactionRef, liability.transactionRef)));
          await tx.insert(generationCreditLedgerEntries).values({ workspaceId: input.workspaceId, sequence: sequence++, id: randomUUID(), bucketId: bucket.id, reservationId: reservation.id, entryType: "clawback", deltaUnits: -liabilityUnits, balanceAfterUnits: balance, sourceRef: `merchant-liability:${liability.provider}:${liability.transactionRef}`, createdAt: now });
        }
        release -= units;
      }
      const state = actual === 0 ? "released" : "settled"; await tx.update(generationCreditReservations).set({ state, settledUnits: actual, updatedAt: now }).where(and(eq(generationCreditReservations.workspaceId, input.workspaceId), eq(generationCreditReservations.id, reservation.id))); await tx.update(managedExecutionCommercialQuotes).set({ state }).where(and(eq(managedExecutionCommercialQuotes.workspaceId, input.workspaceId), eq(managedExecutionCommercialQuotes.id, reservation.quoteId))); const result = { state, settledUnits: actual, releasedUnits: reservation.maxDebitUnits - actual }; await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result }); return result;
    });
  }
  async settleGenerationEffect(input: { workspaceId: string; intentId: string; outcome: "succeeded" | "pre_start_cancelled" | "outcome_unknown" }) {
    const [reservation] = await this.database.select({ id: generationCreditReservations.id, maxDebitUnits: generationCreditReservations.maxDebitUnits }).from(generationCreditReservations).where(and(eq(generationCreditReservations.workspaceId, input.workspaceId), eq(generationCreditReservations.externalEffectRef, `generation:${input.intentId}`))).limit(1);
    if (!reservation) return null;
    return this.settleReservation({ workspaceId: input.workspaceId, reservationId: reservation.id, outcome: input.outcome, actualDebitUnits: input.outcome === "succeeded" ? reservation.maxDebitUnits : null, idempotencyKey: `generation:${input.intentId}:settle:${input.outcome}` });
  }
  async grantPurchasedCredits(input: { workspaceId: string; merchantReceiptRef: string; units: number; idempotencyKey: string }) { return this.grantCredits({ ...input, kind: "purchased", sourceRef: `merchant:${input.merchantReceiptRef}`, expiresAt: null, entryType: "purchase" }); }

  async activatePaidSubscription(input: { workspaceId: string; planId: string; planVersion: number; periodStartsAt: Date; periodEndsAt: Date; merchantCustomerRef: string; merchantSubscriptionRef: string; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "activate_paid_subscription", planId: input.planId, planVersion: input.planVersion, periodStartsAt: input.periodStartsAt.toISOString(), periodEndsAt: input.periodEndsAt.toISOString(), merchantCustomerRef: input.merchantCustomerRef, merchantSubscriptionRef: input.merchantSubscriptionRef } });
      if (command.kind === "replay") return command.result;
      if (input.periodEndsAt <= input.periodStartsAt) throw new CommercialError("SUBSCRIPTION_PERIOD_INVALID");
      const [plan, current] = await Promise.all([tx.select().from(billingPlanVersions).where(and(eq(billingPlanVersions.planId, input.planId), eq(billingPlanVersions.version, input.planVersion))).limit(1), tx.select().from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, input.workspaceId)).for("update").limit(1)]);
      if (!plan[0] || plan[0].billingInterval === "one_time") throw new CommercialError("PLAN_NOT_SUBSCRIBABLE");
      const now = this.now(), revision = (current[0]?.revision ?? 0) + 1;
      if (current[0]) await tx.update(workspaceSubscriptions).set({ state: "active", planId: input.planId, planVersion: input.planVersion, merchantCustomerRef: input.merchantCustomerRef, merchantSubscriptionRef: input.merchantSubscriptionRef, currentPeriodStartsAt: input.periodStartsAt, currentPeriodEndsAt: input.periodEndsAt, graceEndsAt: null, revision, updatedAt: now }).where(and(eq(workspaceSubscriptions.workspaceId, input.workspaceId), eq(workspaceSubscriptions.revision, current[0].revision)));
      else await tx.insert(workspaceSubscriptions).values({ workspaceId: input.workspaceId, state: "active", planId: input.planId, planVersion: input.planVersion, merchantCustomerRef: input.merchantCustomerRef, merchantSubscriptionRef: input.merchantSubscriptionRef, currentPeriodStartsAt: input.periodStartsAt, currentPeriodEndsAt: input.periodEndsAt, revision, updatedAt: now });
      await tx.insert(workspaceSubscriptionEvents).values({ workspaceId: input.workspaceId, revision, id: randomUUID(), fromState: current[0]?.state ?? null, toState: "active", reasonCode: "merchant.checkout.completed", actorRef: "system:merchant-of-record", facts: { planId: input.planId, planVersion: input.planVersion, merchantSubscriptionRef: input.merchantSubscriptionRef }, occurredAt: now });
      const allowanceUnits = Number(plan[0].entitlements.generationCreditsPerPeriod ?? 0);
      if (!Number.isSafeInteger(allowanceUnits) || allowanceUnits < 0) throw new CommercialError("PLAN_ALLOWANCE_INVALID");
      let allowanceGranted = false;
      if (allowanceUnits > 0) {
        const sourceRef = `subscription:${input.merchantSubscriptionRef}:${input.periodStartsAt.toISOString()}`, bucketId = randomUUID();
        const inserted = await tx.insert(generationCreditBuckets).values({ workspaceId: input.workspaceId, id: bucketId, kind: "allowance", sourceRef, grantedUnits: allowanceUnits, availableUnits: allowanceUnits, expiresAt: input.periodEndsAt, revision: 1, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: generationCreditBuckets.id });
        if (inserted[0]) { const sequence = await safeSequence(tx, input.workspaceId, generationCreditLedgerEntries); await tx.insert(generationCreditLedgerEntries).values({ workspaceId: input.workspaceId, sequence, id: randomUUID(), bucketId, reservationId: null, entryType: "grant", deltaUnits: allowanceUnits, balanceAfterUnits: allowanceUnits, sourceRef, createdAt: now }); allowanceGranted = true; }
      }
      const result = { state: "active", revision, planId: input.planId, planVersion: input.planVersion, allowanceGranted, allowanceUnits }; await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result }); return result;
    });
  }
  private async grantCredits(input: { workspaceId: string; kind: "purchased" | "referral"; sourceRef: string; units: number; expiresAt: Date | null; entryType: "purchase" | "referral_reward"; idempotencyKey: string }) { return this.database.transaction(async (tx) => { const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "grant_credits", kind: input.kind, sourceRef: input.sourceRef, units: input.units, expiresAt: input.expiresAt?.toISOString() ?? null, entryType: input.entryType } }); if (command.kind === "replay") return command.result; const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).for("update").limit(1); if (!workspace) throw new CommercialError("WORKSPACE_NOT_FOUND"); const now = this.now(), bucketId = randomUUID(), sequence = await safeSequence(tx, input.workspaceId, generationCreditLedgerEntries); await tx.insert(generationCreditBuckets).values({ workspaceId: input.workspaceId, id: bucketId, kind: input.kind, sourceRef: input.sourceRef, grantedUnits: input.units, availableUnits: input.units, expiresAt: input.expiresAt, revision: 1, createdAt: now, updatedAt: now }); await tx.insert(generationCreditLedgerEntries).values({ workspaceId: input.workspaceId, sequence, id: randomUUID(), bucketId, reservationId: null, entryType: input.entryType, deltaUnits: input.units, balanceAfterUnits: input.units, sourceRef: input.sourceRef, createdAt: now }); const result = { bucketId, availableUnits: input.units }; await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result }); return result; }); }
  async transitionSubscription(input: { workspaceId: string; expectedRevision: number; toState: string; reasonCode: string; periodEndsAt: Date; graceEndsAt: Date | null; merchantCustomerRef: string | null; merchantSubscriptionRef: string | null; idempotencyKey: string }) { return this.database.transaction(async (tx) => { const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "transition_subscription", expectedRevision: input.expectedRevision, toState: input.toState, reasonCode: input.reasonCode, periodEndsAt: input.periodEndsAt.toISOString(), graceEndsAt: input.graceEndsAt?.toISOString() ?? null, merchantCustomerRef: input.merchantCustomerRef, merchantSubscriptionRef: input.merchantSubscriptionRef } }); if (command.kind === "replay") return command.result; const [current] = await tx.select().from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, input.workspaceId)).for("update").limit(1); if (!current || current.revision !== input.expectedRevision) throw new CommercialError("SUBSCRIPTION_REVISION_CONFLICT"); if (!SUBSCRIPTION_TRANSITIONS[current.state]?.includes(input.toState)) throw new CommercialError("SUBSCRIPTION_TRANSITION_INVALID"); const now = this.now(), revision = current.revision + 1; await tx.update(workspaceSubscriptions).set({ state: input.toState, currentPeriodEndsAt: input.periodEndsAt, graceEndsAt: input.graceEndsAt, merchantCustomerRef: input.merchantCustomerRef, merchantSubscriptionRef: input.merchantSubscriptionRef, revision, updatedAt: now }).where(and(eq(workspaceSubscriptions.workspaceId, input.workspaceId), eq(workspaceSubscriptions.revision, input.expectedRevision))); await tx.insert(workspaceSubscriptionEvents).values({ workspaceId: input.workspaceId, revision, id: randomUUID(), fromState: current.state, toState: input.toState, reasonCode: input.reasonCode, actorRef: "system:merchant-of-record", facts: { merchantSubscriptionRef: input.merchantSubscriptionRef }, occurredAt: now }); const result = { state: input.toState, revision }; await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result }); return result; }); }
  async captureReferralVisit(input: { code: string; existingToken: string | null }) {
    const normalizedCode = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,32}$/.test(normalizedCode)) throw new CommercialError("REFERRAL_CODE_INVALID");
    return this.database.transaction(async (tx) => {
      const [referral] = await tx.select().from(workspaceReferralCodes).where(and(eq(workspaceReferralCodes.code, normalizedCode), eq(workspaceReferralCodes.status, "active"))).limit(1);
      if (!referral) throw new CommercialError("REFERRAL_CODE_INVALID");
      const now = this.now();
      let token = input.existingToken && isReferralCaptureToken(input.existingToken) ? input.existingToken : createReferralCaptureToken();
      let tokenDigest = referralCaptureTokenDigest(token);
      const [existing] = await tx.select().from(referralCaptureReceipts).where(eq(referralCaptureReceipts.visitorTokenDigest, tokenDigest)).for("update").limit(1);
      if (existing && existing.expiresAt > now) {
        return { kind: "replayed" as const, token, captureId: existing.id, capturedCodeId: existing.referralCodeId, firstTouchPreserved: existing.referralCodeId !== referral.id, expiresAt: existing.expiresAt.toISOString() };
      }
      if (existing?.state === "captured") await tx.update(referralCaptureReceipts).set({ state: "expired" }).where(and(eq(referralCaptureReceipts.id, existing.id), eq(referralCaptureReceipts.state, "captured")));
      if (existing) {
        token = createReferralCaptureToken();
        tokenDigest = referralCaptureTokenDigest(token);
      }
      const id = randomUUID();
      const expiresAt = new Date(now.getTime() + REFERRAL_CAPTURE_TTL_SECONDS * 1_000);
      await tx.insert(referralCaptureReceipts).values({ id, referralCodeId: referral.id, referrerWorkspaceId: referral.workspaceId, visitorTokenDigest: tokenDigest, state: "captured", capturedAt: now, expiresAt, attributedAt: null });
      return { kind: "captured" as const, token, captureId: id, capturedCodeId: referral.id, firstTouchPreserved: false, expiresAt: expiresAt.toISOString() };
    });
  }
  async claimReferralCapture(input: { token: string; userId: string; referredWorkspaceId: string }) {
    if (!isReferralCaptureToken(input.token)) return { kind: "invalid" as const };
    return this.database.transaction(async (tx) => {
      const [capture] = await tx.select().from(referralCaptureReceipts).where(eq(referralCaptureReceipts.visitorTokenDigest, referralCaptureTokenDigest(input.token))).for("update").limit(1);
      if (!capture) return { kind: "invalid" as const };
      if (capture.state === "attributed") {
        const [attribution] = await tx.select({ id: referralAttributions.id }).from(referralAttributions).where(eq(referralAttributions.captureId, capture.id)).limit(1);
        return { kind: "replayed" as const, attributionId: attribution?.id ?? null };
      }
      if (capture.state !== "captured") return { kind: capture.state as "expired" | "superseded" };
      const now = this.now();
      if (capture.expiresAt <= now) {
        await tx.update(referralCaptureReceipts).set({ state: "expired" }).where(and(eq(referralCaptureReceipts.id, capture.id), eq(referralCaptureReceipts.state, "captured")));
        return { kind: "expired" as const };
      }
      const [[identity], [code]] = await Promise.all([
        tx.select({ email: user.email }).from(user).where(eq(user.id, input.userId)).limit(1),
        tx.select().from(workspaceReferralCodes).where(and(eq(workspaceReferralCodes.workspaceId, capture.referrerWorkspaceId), eq(workspaceReferralCodes.id, capture.referralCodeId))).limit(1),
      ]);
      if (!identity?.email || !code || code.status !== "active") {
        await tx.update(referralCaptureReceipts).set({ state: "superseded" }).where(and(eq(referralCaptureReceipts.id, capture.id), eq(referralCaptureReceipts.state, "captured")));
        return { kind: "superseded" as const };
      }
      if (input.referredWorkspaceId === capture.referrerWorkspaceId) {
        await tx.update(referralCaptureReceipts).set({ state: "superseded" }).where(and(eq(referralCaptureReceipts.id, capture.id), eq(referralCaptureReceipts.state, "captured")));
        return { kind: "self_referral_denied" as const };
      }
      const referredIdentityDigest = digest(identity.email.trim().toLowerCase());
      const [prior] = await tx.select({ id: referralAttributions.id }).from(referralAttributions).where(eq(referralAttributions.referredIdentityDigest, referredIdentityDigest)).limit(1);
      if (prior) {
        await tx.update(referralCaptureReceipts).set({ state: "superseded" }).where(and(eq(referralCaptureReceipts.id, capture.id), eq(referralCaptureReceipts.state, "captured")));
        return { kind: "already_attributed" as const, attributionId: prior.id };
      }
      const attributionId = randomUUID();
      const attributionDigest = canonicalDigest({ policy: "verified-onboarding-first-touch-v1", captureId: capture.id, referralCodeId: capture.referralCodeId, referrerWorkspaceId: capture.referrerWorkspaceId, referredWorkspaceId: input.referredWorkspaceId, referredIdentityDigest });
      await tx.insert(referralAttributions).values({ id: attributionId, captureId: capture.id, referralCodeId: capture.referralCodeId, referrerWorkspaceId: capture.referrerWorkspaceId, referredIdentityDigest, referredWorkspaceId: input.referredWorkspaceId, state: "attributed", attributionDigest, attributedAt: now, qualifiedAt: null });
      await tx.update(referralCaptureReceipts).set({ state: "attributed", attributedAt: now }).where(and(eq(referralCaptureReceipts.id, capture.id), eq(referralCaptureReceipts.state, "captured")));
      return { kind: "attributed" as const, attributionId, referrerWorkspaceId: capture.referrerWorkspaceId };
    });
  }
  async createReferralCode(input: { workspaceId: string; userId: string; rewardMode: "generation_credit" | "cash"; idempotencyKey: string }) { return this.database.transaction(async (tx) => { const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "create_referral_code", userId: input.userId, rewardMode: input.rewardMode } }); if (command.kind === "replay") return command.result; const id = randomUUID(), code = randomBytes(12).toString("hex").toUpperCase().slice(0, 10); await tx.insert(workspaceReferralCodes).values({ workspaceId: input.workspaceId, id, code, rewardMode: input.rewardMode, status: "active", recipientUserId: input.userId, createdAt: this.now() }); const result = { id, code, rewardMode: input.rewardMode }; await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result }); return result; }); }
  async setReferralCodeStatus(input: { workspaceId: string; codeId: string; status: "active" | "paused" | "closed"; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "set_referral_code_status", codeId: input.codeId, status: input.status } });
      if (command.kind === "replay") return command.result;
      const [current] = await tx.select().from(workspaceReferralCodes).where(and(eq(workspaceReferralCodes.workspaceId, input.workspaceId), eq(workspaceReferralCodes.id, input.codeId))).for("update").limit(1);
      if (!current) throw new CommercialError("REFERRAL_CODE_INVALID");
      if (current.status === "closed" && input.status !== "closed") throw new CommercialError("REFERRAL_CODE_CLOSED");
      await tx.update(workspaceReferralCodes).set({ status: input.status }).where(and(eq(workspaceReferralCodes.workspaceId, input.workspaceId), eq(workspaceReferralCodes.id, input.codeId)));
      const result = { codeId: input.codeId, status: input.status };
      await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result });
      return result;
    });
  }
  async saveReferralRecipientProfile(input: { workspaceId: string; userId: string; rewardPreference: "generation_credit" | "cash"; legalCountry: string | null; payoutCurrency: string | null; termsAccepted: boolean; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      const normalized = { rewardPreference: input.rewardPreference, legalCountry: input.legalCountry?.trim().toUpperCase() || null, payoutCurrency: input.payoutCurrency?.trim().toUpperCase() || null, termsAccepted: input.termsAccepted };
      if ((normalized.legalCountry && !/^[A-Z]{2}$/.test(normalized.legalCountry)) || (normalized.payoutCurrency && !/^[A-Z]{3}$/.test(normalized.payoutCurrency))) throw new CommercialError("REFERRAL_RECIPIENT_INVALID");
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "save_referral_recipient_profile", userId: input.userId, ...normalized } });
      if (command.kind === "replay") return command.result;
      const [current] = await tx.select().from(referralRecipientProfiles).where(and(eq(referralRecipientProfiles.workspaceId, input.workspaceId), eq(referralRecipientProfiles.userId, input.userId))).for("update").limit(1);
      const now = this.now(); const revision = (current?.revision ?? 0) + 1;
      const termsAcceptedAt = normalized.termsAccepted ? current?.termsAcceptedAt ?? now : null;
      const payoutFieldsChanged = current && (current.legalCountry !== normalized.legalCountry || current.payoutCurrency !== normalized.payoutCurrency || current.rewardPreference !== normalized.rewardPreference || !termsAcceptedAt);
      const verificationState = normalized.rewardPreference === "cash" && normalized.legalCountry && normalized.payoutCurrency && termsAcceptedAt ? current?.verificationState === "verified" && !payoutFieldsChanged ? "verified" : "pending" : "unconfigured";
      const values = { rewardPreference: normalized.rewardPreference, verificationState, legalCountry: normalized.legalCountry, payoutCurrency: normalized.payoutCurrency, payoutProvider: verificationState === "verified" ? current?.payoutProvider ?? null : null, providerRecipientRef: verificationState === "verified" ? current?.providerRecipientRef ?? null : null, taxEvidenceRef: verificationState === "verified" ? current?.taxEvidenceRef ?? null : null, termsAcceptedAt, revision, updatedAt: now };
      if (current) await tx.update(referralRecipientProfiles).set(values).where(and(eq(referralRecipientProfiles.workspaceId, input.workspaceId), eq(referralRecipientProfiles.userId, input.userId), eq(referralRecipientProfiles.revision, current.revision)));
      else await tx.insert(referralRecipientProfiles).values({ workspaceId: input.workspaceId, userId: input.userId, ...values, createdAt: now });
      const { updatedAt: _updatedAt, ...revisionValues } = values;
      const evidenceDigest = canonicalDigest({ schema: "referral-recipient-profile/v1", workspaceId: input.workspaceId, userId: input.userId, ...revisionValues, updatedAt: now.toISOString() });
      await tx.insert(referralRecipientProfileRevisions).values({ workspaceId: input.workspaceId, userId: input.userId, ...revisionValues, evidenceDigest, actorRef: `human:${input.userId}`, recordedAt: now });
      const result = { revision, verificationState, rewardPreference: normalized.rewardPreference };
      await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result });
      return result;
    });
  }
  async verifyReferralRecipient(input: { workspaceId: string; userId: string; decision: "verified" | "rejected" | "suspended"; payoutProvider: string | null; providerRecipientRef: string | null; taxEvidenceRef: string | null; evidenceDigest: string; reviewerRef: string; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "verify_referral_recipient", ...input, idempotencyKey: undefined } });
      if (command.kind === "replay") return command.result;
      const [current] = await tx.select().from(referralRecipientProfiles).where(and(eq(referralRecipientProfiles.workspaceId, input.workspaceId), eq(referralRecipientProfiles.userId, input.userId))).for("update").limit(1);
      if (!current || current.rewardPreference !== "cash" || !current.legalCountry || !current.payoutCurrency || !current.termsAcceptedAt) throw new CommercialError("REFERRAL_RECIPIENT_NOT_READY");
      if (input.decision === "verified" && (!input.payoutProvider || !input.providerRecipientRef || !input.taxEvidenceRef)) throw new CommercialError("REFERRAL_RECIPIENT_EVIDENCE_REQUIRED");
      if (!/^sha256:[a-f0-9]{64}$/.test(input.evidenceDigest)) throw new CommercialError("REFERRAL_RECIPIENT_EVIDENCE_INVALID");
      const now = this.now(); const revision = current.revision + 1;
      const values = { rewardPreference: current.rewardPreference, verificationState: input.decision, legalCountry: current.legalCountry, payoutCurrency: current.payoutCurrency, payoutProvider: input.decision === "verified" ? input.payoutProvider : current.payoutProvider, providerRecipientRef: input.decision === "verified" ? input.providerRecipientRef : current.providerRecipientRef, taxEvidenceRef: input.decision === "verified" ? input.taxEvidenceRef : current.taxEvidenceRef, termsAcceptedAt: current.termsAcceptedAt, revision, updatedAt: now };
      await tx.update(referralRecipientProfiles).set(values).where(and(eq(referralRecipientProfiles.workspaceId, input.workspaceId), eq(referralRecipientProfiles.userId, input.userId), eq(referralRecipientProfiles.revision, current.revision)));
      const { updatedAt: _updatedAt, ...revisionValues } = values;
      await tx.insert(referralRecipientProfileRevisions).values({ workspaceId: input.workspaceId, userId: input.userId, ...revisionValues, evidenceDigest: canonicalDigest({ schema: "referral-recipient-verification/v1", providerEvidenceDigest: input.evidenceDigest, reviewerRef: input.reviewerRef, decision: input.decision, revision }), actorRef: input.reviewerRef, recordedAt: now });
      const result = { revision, verificationState: input.decision };
      await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result });
      return result;
    });
  }
  async requestReferralPayout(input: { workspaceId: string; userId: string; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`referral-payout-ledger:${input.workspaceId}`}, 0))`);
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "request_referral_payout", userId: input.userId } });
      if (command.kind === "replay") return command.result;
      const [profile] = await tx.select().from(referralRecipientProfiles).where(and(eq(referralRecipientProfiles.workspaceId, input.workspaceId), eq(referralRecipientProfiles.userId, input.userId), eq(referralRecipientProfiles.verificationState, "verified"))).for("update").limit(1);
      if (!profile?.payoutCurrency) throw new CommercialError("REFERRAL_RECIPIENT_NOT_VERIFIED");
      const [activeRequest] = await tx.select({ id: referralPayoutRequests.id }).from(referralPayoutRequests).where(and(eq(referralPayoutRequests.workspaceId, input.workspaceId), eq(referralPayoutRequests.recipientUserId, input.userId), inArray(referralPayoutRequests.state, ["submitted", "processing", "action_required", "outcome_unknown"]))).limit(1);
      if (activeRequest) throw new CommercialError("REFERRAL_PAYOUT_ALREADY_PENDING");
      const codes = await tx.select({ id: workspaceReferralCodes.id }).from(workspaceReferralCodes).where(and(eq(workspaceReferralCodes.workspaceId, input.workspaceId), eq(workspaceReferralCodes.recipientUserId, input.userId)));
      if (!codes.length) throw new CommercialError("REFERRAL_PAYOUT_EMPTY");
      const attributions = await tx.select({ id: referralAttributions.id }).from(referralAttributions).where(and(eq(referralAttributions.referrerWorkspaceId, input.workspaceId), inArray(referralAttributions.referralCodeId, codes.map((row) => row.id))));
      if (!attributions.length) throw new CommercialError("REFERRAL_PAYOUT_EMPTY");
      const rewards = await tx.select().from(referralRewards).where(and(eq(referralRewards.workspaceId, input.workspaceId), eq(referralRewards.mode, "cash"), eq(referralRewards.state, "available"), eq(referralRewards.currency, profile.payoutCurrency), inArray(referralRewards.attributionId, attributions.map((row) => row.id)))).orderBy(asc(referralRewards.createdAt), asc(referralRewards.id)).for("update");
      if (!rewards.length) throw new CommercialError("REFERRAL_PAYOUT_EMPTY");
      const totalMinor = rewards.reduce((sum, reward) => sum + (reward.cashMinor ?? 0), 0); const thresholdMinor = Math.max(...rewards.map((reward) => reward.thresholdMinor ?? 0));
      if (totalMinor < thresholdMinor) throw new CommercialError("REFERRAL_PAYOUT_THRESHOLD_NOT_MET");
      const now = this.now(); const id = randomUUID(); const evidenceDigest = canonicalDigest({ schema: "referral-payout-request/v1", workspaceId: input.workspaceId, recipientUserId: input.userId, profileRevision: profile.revision, currency: profile.payoutCurrency, rewards: rewards.map((reward) => ({ id: reward.id, amountMinor: reward.cashMinor })) });
      await tx.insert(referralPayoutRequests).values({ workspaceId: input.workspaceId, id, recipientUserId: input.userId, profileRevision: profile.revision, state: "submitted", currency: profile.payoutCurrency, totalMinor, merchantPayoutRef: null, evidenceDigest, providerIdempotencyKey: `referral-payout:${input.workspaceId}:${id}`, dispatchAttempts: 0, maxDispatchAttempts: 12, nextDispatchAt: now, dispatchLeaseOwner: null, dispatchLeaseExpiresAt: null, lastDispatchErrorCode: null, submittedAt: now, updatedAt: now, paidAt: null });
      await tx.insert(referralPayoutRequestRewards).values(rewards.map((reward) => ({ workspaceId: input.workspaceId, payoutRequestId: id, rewardId: reward.id, amountMinor: reward.cashMinor!, currency: profile.payoutCurrency! })));
      await tx.update(referralRewards).set({ state: "payout_pending", updatedAt: now }).where(and(eq(referralRewards.workspaceId, input.workspaceId), inArray(referralRewards.id, rewards.map((reward) => reward.id))));
      for (const reward of rewards) { const sequence = await safeSequence(tx, input.workspaceId, referralPayoutLedgerEntries); await tx.insert(referralPayoutLedgerEntries).values({ workspaceId: input.workspaceId, sequence, id: randomUUID(), rewardId: reward.id, entryType: "hold", amountMinor: -reward.cashMinor!, currency: profile.payoutCurrency, merchantPayoutRef: null, taxEvidenceRef: profile.taxEvidenceRef, occurredAt: now }); }
      await tx.insert(referralPayoutEvents).values({ workspaceId: input.workspaceId, payoutRequestId: id, sequence: 1, id: randomUUID(), fromState: null, toState: "submitted", eventType: "submitted", providerEventRef: null, evidenceDigest, occurredAt: now, receivedAt: now });
      const result = { payoutRequestId: id, state: "submitted", currency: profile.payoutCurrency, totalMinor, rewardCount: rewards.length };
      await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result });
      return result;
    });
  }
  async recordReferralPayoutOutcome(input: { workspaceId: string; payoutRequestId: string; toState: Exclude<ReferralPayoutState, "submitted">; providerEventRef: string; merchantPayoutRef: string | null; evidenceDigest: string; occurredAt: Date; idempotencyKey: string }) {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`referral-payout-ledger:${input.workspaceId}`}, 0))`);
      const [current] = await tx.select().from(referralPayoutRequests).where(and(eq(referralPayoutRequests.workspaceId, input.workspaceId), eq(referralPayoutRequests.id, input.payoutRequestId))).for("update").limit(1);
      if (!current) throw new CommercialError("REFERRAL_PAYOUT_NOT_FOUND");
      const [providerReplay] = await tx.select({ payoutRequestId: referralPayoutEvents.payoutRequestId, toState: referralPayoutEvents.toState, sequence: referralPayoutEvents.sequence }).from(referralPayoutEvents).where(eq(referralPayoutEvents.providerEventRef, input.providerEventRef)).limit(1);
      if (providerReplay) {
        if (providerReplay.payoutRequestId !== input.payoutRequestId || providerReplay.toState !== input.toState) throw new CommercialError("REFERRAL_PAYOUT_PROVIDER_EVENT_CONFLICT");
        return { payoutRequestId: input.payoutRequestId, state: providerReplay.toState, sequence: providerReplay.sequence, kind: "provider_replay" as const };
      }
      const command = await claimCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "record_referral_payout_outcome", ...input, occurredAt: input.occurredAt.toISOString(), idempotencyKey: undefined } });
      if (command.kind === "replay") return command.result;
      if (!canTransitionReferralPayout(current.state as ReferralPayoutState, input.toState)) throw new CommercialError("REFERRAL_PAYOUT_TRANSITION_INVALID");
      if (!/^sha256:[a-f0-9]{64}$/.test(input.evidenceDigest) || (input.toState === "paid" && !input.merchantPayoutRef)) throw new CommercialError("REFERRAL_PAYOUT_EVIDENCE_INVALID");
      const now = this.now(); const [sequenceRow] = await tx.select({ value: sql<number>`coalesce(max(${referralPayoutEvents.sequence}), 0)::int` }).from(referralPayoutEvents).where(and(eq(referralPayoutEvents.workspaceId, input.workspaceId), eq(referralPayoutEvents.payoutRequestId, input.payoutRequestId))); const sequence = (sequenceRow?.value ?? 0) + 1;
      const terminalRelease = input.toState === "paid" || input.toState === "failed_known" || input.toState === "cancelled";
      const lines = terminalRelease ? await tx.select().from(referralPayoutRequestRewards).where(and(eq(referralPayoutRequestRewards.workspaceId, input.workspaceId), eq(referralPayoutRequestRewards.payoutRequestId, input.payoutRequestId))) : [];
      if (terminalRelease) {
        for (const line of lines) {
          let ledgerSequence = await safeSequence(tx, input.workspaceId, referralPayoutLedgerEntries);
          await tx.insert(referralPayoutLedgerEntries).values({ workspaceId: input.workspaceId, sequence: ledgerSequence, id: randomUUID(), rewardId: line.rewardId, entryType: "release", amountMinor: line.amountMinor, currency: line.currency, merchantPayoutRef: input.merchantPayoutRef, taxEvidenceRef: null, occurredAt: input.occurredAt });
          if (input.toState === "paid") { ledgerSequence = await safeSequence(tx, input.workspaceId, referralPayoutLedgerEntries); await tx.insert(referralPayoutLedgerEntries).values({ workspaceId: input.workspaceId, sequence: ledgerSequence, id: randomUUID(), rewardId: line.rewardId, entryType: "paid", amountMinor: -line.amountMinor, currency: line.currency, merchantPayoutRef: input.merchantPayoutRef, taxEvidenceRef: null, occurredAt: input.occurredAt }); }
        }
        await tx.update(referralRewards).set({ state: input.toState === "paid" ? "paid" : "available", updatedAt: now }).where(and(eq(referralRewards.workspaceId, input.workspaceId), inArray(referralRewards.id, lines.map((line) => line.rewardId)), eq(referralRewards.state, "payout_pending")));
      }
      await tx.update(referralPayoutRequests).set({ state: input.toState, merchantPayoutRef: input.merchantPayoutRef ?? current.merchantPayoutRef, updatedAt: now, paidAt: input.toState === "paid" ? input.occurredAt : null }).where(and(eq(referralPayoutRequests.workspaceId, input.workspaceId), eq(referralPayoutRequests.id, input.payoutRequestId)));
      await tx.insert(referralPayoutEvents).values({ workspaceId: input.workspaceId, payoutRequestId: input.payoutRequestId, sequence, id: randomUUID(), fromState: current.state, toState: input.toState, eventType: input.toState, providerEventRef: input.providerEventRef, evidenceDigest: input.evidenceDigest, occurredAt: input.occurredAt, receivedAt: now });
      const result = { payoutRequestId: input.payoutRequestId, state: input.toState, sequence };
      await completeCommand(tx, { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result });
      return result;
    });
  }
  async attributeReferral(input: { code: string; referredIdentityDigest: string; referredWorkspaceId: string | null; attributionDigest: string; idempotencyKey: string }) { const [referral] = await this.database.select().from(workspaceReferralCodes).where(and(eq(workspaceReferralCodes.code, input.code), eq(workspaceReferralCodes.status, "active"))).limit(1); if (!referral) throw new CommercialError("REFERRAL_CODE_INVALID"); if (input.referredWorkspaceId === referral.workspaceId) throw new CommercialError("SELF_REFERRAL_DENIED"); return this.database.transaction(async (tx) => { const command = await claimCommand(tx, { workspaceId: referral.workspaceId, idempotencyKey: input.idempotencyKey, request: { action: "attribute_referral", code: input.code, referredIdentityDigest: input.referredIdentityDigest, referredWorkspaceId: input.referredWorkspaceId, attributionDigest: input.attributionDigest } }); if (command.kind === "replay") return command.result; const id = randomUUID(); await tx.insert(referralAttributions).values({ id, referralCodeId: referral.id, referrerWorkspaceId: referral.workspaceId, referredIdentityDigest: input.referredIdentityDigest, referredWorkspaceId: input.referredWorkspaceId, state: "attributed", attributionDigest: input.attributionDigest, attributedAt: this.now() }); const result = { attributionId: id, referrerWorkspaceId: referral.workspaceId }; await completeCommand(tx, { workspaceId: referral.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result }); return result; }); }
  async decideReferral(input: { attributionId: string; decision: "clear" | "hold" | "reject"; policyVersion: string; evidenceDigest: string; reviewerRef: string; creditUnits: number | null; cashMinor: number | null; currency: string | null; thresholdMinor: number | null; idempotencyKey: string }) { return this.database.transaction(async (tx) => { const [attribution] = await tx.select().from(referralAttributions).where(eq(referralAttributions.id, input.attributionId)).for("update").limit(1); if (!attribution) throw new CommercialError("REFERRAL_NOT_DECIDABLE"); const command = await claimCommand(tx, { workspaceId: attribution.referrerWorkspaceId, idempotencyKey: input.idempotencyKey, request: { action: "decide_referral", attributionId: input.attributionId, decision: input.decision, policyVersion: input.policyVersion, evidenceDigest: input.evidenceDigest, reviewerRef: input.reviewerRef, creditUnits: input.creditUnits, cashMinor: input.cashMinor, currency: input.currency, thresholdMinor: input.thresholdMinor } }); if (command.kind === "replay") return command.result; if (attribution.state !== "attributed") throw new CommercialError("REFERRAL_NOT_DECIDABLE"); const [code] = await tx.select().from(workspaceReferralCodes).where(and(eq(workspaceReferralCodes.workspaceId, attribution.referrerWorkspaceId), eq(workspaceReferralCodes.id, attribution.referralCodeId))).limit(1); if (!code) throw new CommercialError("REFERRAL_CODE_INVALID"); await tx.select({ workspaceId: workspaceSubscriptions.workspaceId }).from(workspaceSubscriptions).where(eq(workspaceSubscriptions.workspaceId, attribution.referrerWorkspaceId)).for("update").limit(1); const now = this.now(); await tx.insert(referralFraudEvidence).values({ workspaceId: attribution.referrerWorkspaceId, id: randomUUID(), attributionId: attribution.id, decision: input.decision, policyVersion: input.policyVersion, evidenceDigest: input.evidenceDigest, reviewerRef: input.reviewerRef, decidedAt: now }); let result: Record<string, unknown>; if (input.decision !== "clear") { const state = input.decision === "hold" ? "fraud_hold" : "rejected"; await tx.update(referralAttributions).set({ state }).where(eq(referralAttributions.id, attribution.id)); result = { state }; } else { const rewardId = randomUUID(); if ((code.rewardMode === "generation_credit") !== Boolean(input.creditUnits) || (code.rewardMode === "cash") !== Boolean(input.cashMinor && input.currency)) throw new CommercialError("REFERRAL_REWARD_INVALID"); await tx.insert(referralRewards).values({ workspaceId: attribution.referrerWorkspaceId, id: rewardId, attributionId: attribution.id, mode: code.rewardMode, state: "available", creditUnits: input.creditUnits, cashMinor: input.cashMinor, currency: input.currency, thresholdMinor: input.thresholdMinor, createdAt: now, updatedAt: now }); await tx.update(referralAttributions).set({ state: "rewarded", qualifiedAt: now }).where(eq(referralAttributions.id, attribution.id)); if (code.rewardMode === "cash") { const sequence = await safeSequence(tx, attribution.referrerWorkspaceId, referralPayoutLedgerEntries); await tx.insert(referralPayoutLedgerEntries).values({ workspaceId: attribution.referrerWorkspaceId, sequence, id: randomUUID(), rewardId, entryType: "earned", amountMinor: input.cashMinor!, currency: input.currency!, occurredAt: now }); } else { const bucketId = randomUUID(), sequence = await safeSequence(tx, attribution.referrerWorkspaceId, generationCreditLedgerEntries); await tx.insert(generationCreditBuckets).values({ workspaceId: attribution.referrerWorkspaceId, id: bucketId, kind: "referral", sourceRef: `referral:${rewardId}`, grantedUnits: input.creditUnits!, availableUnits: input.creditUnits!, expiresAt: null, revision: 1, createdAt: now, updatedAt: now }); await tx.insert(generationCreditLedgerEntries).values({ workspaceId: attribution.referrerWorkspaceId, sequence, id: randomUUID(), bucketId, reservationId: null, entryType: "referral_reward", deltaUnits: input.creditUnits!, balanceAfterUnits: input.creditUnits!, sourceRef: `referral:${rewardId}`, createdAt: now }); } result = { state: "rewarded", rewardId, workspaceId: attribution.referrerWorkspaceId }; } await completeCommand(tx, { workspaceId: attribution.referrerWorkspaceId, idempotencyKey: input.idempotencyKey, requestDigest: command.requestDigest, result }); return result; }); }
}
