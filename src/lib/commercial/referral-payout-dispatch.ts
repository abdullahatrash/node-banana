import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { referralPayoutRequests, referralRecipientProfileRevisions } from "@/lib/db/schema";
import { CommercialRepository } from "./repository";
import type { ReferralPayoutProvider, ReferralPayoutProviderInput, ReferralPayoutProviderOutcome, ReferralPayoutProviderResult } from "./referral-payout-provider";

type Db = ReturnType<typeof getDb>;
type DispatchState = "submitted" | "processing" | "outcome_unknown";
export type ReferralPayoutDispatchClaim = ReferralPayoutProviderInput & {
  workspaceId: string;
  state: DispatchState;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string;
};

export interface ReferralPayoutDispatchStore {
  claimDue(limit: number, at: Date): Promise<ReferralPayoutDispatchClaim[]>;
  applyOutcome(claim: ReferralPayoutDispatchClaim, outcome: ReferralPayoutProviderOutcome): Promise<void>;
  release(claim: ReferralPayoutDispatchClaim, input: { nextAttemptAt: Date; errorCode: string | null }): Promise<void>;
}

type ReferralPayoutDispatchSummary = {
  inspected: number;
  submitted: number;
  reconciled: number;
  pending: number;
  actionRequired: number;
  paid: number;
  failedKnown: number;
  outcomeUnknown: number;
  retryScheduled: number;
  unavailable: number;
};

export function referralPayoutDispatchDelayMs(attempt: number, state: DispatchState, code?: string | null) {
  const base = state === "processing" ? 15_000 : state === "outcome_unknown" ? 60_000 : code === "REFERRAL_PAYOUT_PROVIDER_RECORD_NOT_FOUND" ? 30_000 : 60_000;
  return Math.min(15 * 60_000, base * 2 ** Math.min(Math.max(Number.isSafeInteger(attempt) ? attempt - 1 : 0, 0), 5));
}

export class PostgresReferralPayoutDispatchStore implements ReferralPayoutDispatchStore {
  constructor(
    private readonly database: Db = getDb(),
    private readonly commercial = new CommercialRepository(database),
    private readonly now = () => new Date(),
  ) {}

  async claimDue(limit: number, at: Date) {
    const leaseOwner = randomUUID();
    const leaseExpiresAt = new Date(at.getTime() + 50_000);
    const boundedLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 20, 1), 50);
    return this.database.transaction(async (tx) => {
      const rows = await tx.select().from(referralPayoutRequests).where(and(
        inArray(referralPayoutRequests.state, ["submitted", "processing", "outcome_unknown"]),
        lte(referralPayoutRequests.nextDispatchAt, at),
        lt(referralPayoutRequests.dispatchAttempts, referralPayoutRequests.maxDispatchAttempts),
        or(isNull(referralPayoutRequests.dispatchLeaseExpiresAt), lte(referralPayoutRequests.dispatchLeaseExpiresAt, at)),
      )).orderBy(asc(referralPayoutRequests.nextDispatchAt), asc(referralPayoutRequests.submittedAt), asc(referralPayoutRequests.id)).limit(boundedLimit).for("update", { skipLocked: true });
      const claims: ReferralPayoutDispatchClaim[] = [];
      for (const row of rows) {
        const [revision] = await tx.select({
          verificationState: referralRecipientProfileRevisions.verificationState,
          payoutProvider: referralRecipientProfileRevisions.payoutProvider,
          providerRecipientRef: referralRecipientProfileRevisions.providerRecipientRef,
        }).from(referralRecipientProfileRevisions).where(and(
          eq(referralRecipientProfileRevisions.workspaceId, row.workspaceId),
          eq(referralRecipientProfileRevisions.userId, row.recipientUserId),
          eq(referralRecipientProfileRevisions.revision, row.profileRevision),
        )).limit(1);
        const attempt = row.dispatchAttempts + 1;
        const [claimed] = await tx.update(referralPayoutRequests).set({
          dispatchAttempts: attempt,
          dispatchLeaseOwner: leaseOwner,
          dispatchLeaseExpiresAt: leaseExpiresAt,
          lastDispatchErrorCode: null,
          updatedAt: at,
        }).where(and(
          eq(referralPayoutRequests.workspaceId, row.workspaceId),
          eq(referralPayoutRequests.id, row.id),
          eq(referralPayoutRequests.dispatchAttempts, row.dispatchAttempts),
        )).returning({ id: referralPayoutRequests.id });
        if (!claimed) continue;
        claims.push({
          workspaceId: row.workspaceId,
          payoutRequestId: row.id,
          providerIdempotencyKey: row.providerIdempotencyKey,
          payoutProvider: revision?.verificationState === "verified" ? revision.payoutProvider ?? "" : "",
          providerRecipientRef: revision?.verificationState === "verified" ? revision.providerRecipientRef ?? "" : "",
          amountMinor: row.totalMinor,
          currency: row.currency,
          requestEvidenceDigest: row.evidenceDigest,
          state: row.state as DispatchState,
          attempt,
          maxAttempts: row.maxDispatchAttempts,
          leaseOwner,
        });
      }
      return claims;
    });
  }

  async applyOutcome(claim: ReferralPayoutDispatchClaim, outcome: ReferralPayoutProviderOutcome) {
    await this.commercial.recordReferralPayoutOutcome({
      workspaceId: claim.workspaceId,
      payoutRequestId: claim.payoutRequestId,
      toState: outcome.state,
      providerEventRef: outcome.providerEventRef,
      merchantPayoutRef: outcome.merchantPayoutRef,
      evidenceDigest: outcome.evidenceDigest,
      occurredAt: outcome.occurredAt,
      idempotencyKey: `referral-payout-provider:${claim.payoutProvider}:${outcome.providerEventRef}`,
    });
  }

  async release(claim: ReferralPayoutDispatchClaim, input: { nextAttemptAt: Date; errorCode: string | null }) {
    await this.database.update(referralPayoutRequests).set({
      nextDispatchAt: input.nextAttemptAt,
      dispatchLeaseOwner: null,
      dispatchLeaseExpiresAt: null,
      lastDispatchErrorCode: input.errorCode?.slice(0, 200) ?? null,
      updatedAt: this.now(),
    }).where(and(
      eq(referralPayoutRequests.workspaceId, claim.workspaceId),
      eq(referralPayoutRequests.id, claim.payoutRequestId),
      eq(referralPayoutRequests.dispatchLeaseOwner, claim.leaseOwner),
      eq(referralPayoutRequests.dispatchAttempts, claim.attempt),
    ));
  }
}

export class ReferralPayoutDispatchService {
  constructor(
    private readonly store: ReferralPayoutDispatchStore,
    private readonly provider: ReferralPayoutProvider,
    private readonly now = () => new Date(),
  ) {}

  async reconcile(limit = 20) {
    if (!this.provider.isConfigured()) return { inspected: 0, submitted: 0, reconciled: 0, pending: 0, actionRequired: 0, paid: 0, failedKnown: 0, outcomeUnknown: 0, retryScheduled: 0, unavailable: 1 };
    const claims = await this.store.claimDue(limit, this.now());
    const summary = { inspected: claims.length, submitted: 0, reconciled: 0, pending: 0, actionRequired: 0, paid: 0, failedKnown: 0, outcomeUnknown: 0, retryScheduled: 0, unavailable: 0 };
    for (const claim of claims) {
      if (!claim.payoutProvider || !claim.providerRecipientRef) {
        await this.applyAndRelease(claim, localOutcome(claim, "action_required", "REFERRAL_PAYOUT_RECIPIENT_EVIDENCE_MISSING", this.now()));
        summary.actionRequired += 1;
        continue;
      }
      let result = await this.provider.lookup(claim);
      if (result.kind === "not_found" && claim.state === "submitted") {
        result = await this.provider.submit(claim);
        summary.submitted += 1;
      } else if (result.kind === "outcome") {
        summary.reconciled += 1;
      }
      await this.finish(claim, result, summary);
    }
    return summary;
  }

  private async finish(claim: ReferralPayoutDispatchClaim, result: ReferralPayoutProviderResult, summary: ReferralPayoutDispatchSummary) {
    if (result.kind === "outcome") {
      await this.applyAndRelease(claim, result.outcome);
      if (result.outcome.state === "processing") summary.pending += 1;
      else if (result.outcome.state === "action_required") summary.actionRequired += 1;
      else if (result.outcome.state === "paid") summary.paid += 1;
      else if (result.outcome.state === "failed_known" || result.outcome.state === "cancelled") summary.failedKnown += 1;
      else summary.outcomeUnknown += 1;
      return;
    }
    const code = result.kind === "not_found" ? "REFERRAL_PAYOUT_PROVIDER_RECORD_NOT_FOUND" : result.code;
    if (result.kind === "unavailable") {
      await this.applyAndRelease(claim, localOutcome(claim, "action_required", code, this.now()));
      summary.actionRequired += 1;
      summary.unavailable += 1;
      return;
    }
    if (claim.attempt >= claim.maxAttempts && claim.state !== "outcome_unknown") {
      await this.applyAndRelease(claim, localOutcome(claim, "outcome_unknown", code, this.now()));
      summary.outcomeUnknown += 1;
      return;
    }
    await this.store.release(claim, { nextAttemptAt: new Date(this.now().getTime() + referralPayoutDispatchDelayMs(claim.attempt, claim.state, code)), errorCode: code });
    summary.retryScheduled += 1;
  }

  private async applyAndRelease(claim: ReferralPayoutDispatchClaim, outcome: ReferralPayoutProviderOutcome) {
    await this.store.applyOutcome(claim, outcome);
    await this.store.release(claim, {
      nextAttemptAt: new Date(this.now().getTime() + referralPayoutDispatchDelayMs(claim.attempt, outcome.state === "processing" ? "processing" : "outcome_unknown")),
      errorCode: outcome.state === "outcome_unknown" || outcome.state === "action_required" ? outcome.state.toUpperCase() : null,
    });
  }
}

function localOutcome(claim: ReferralPayoutDispatchClaim, state: "action_required" | "outcome_unknown", code: string, occurredAt: Date): ReferralPayoutProviderOutcome {
  const evidenceDigest = canonicalDigest({ schema: "referral-payout-dispatch-evidence/v1", payoutRequestId: claim.payoutRequestId, idempotencyKey: claim.providerIdempotencyKey, attempt: claim.attempt, state, code });
  return {
    state,
    providerEventRef: `node-banana:referral-payout:${evidenceDigest.slice("sha256:".length)}`,
    merchantPayoutRef: null,
    evidenceDigest,
    occurredAt,
  };
}
