export type ReferralPayoutState =
  | "submitted"
  | "processing"
  | "action_required"
  | "paid"
  | "failed_known"
  | "outcome_unknown"
  | "cancelled";

const REFERRAL_PAYOUT_TRANSITIONS: Record<
  ReferralPayoutState,
  readonly ReferralPayoutState[]
> = {
  submitted: [
    "processing",
    "action_required",
    "paid",
    "failed_known",
    "outcome_unknown",
    "cancelled",
  ],
  processing: [
    "processing",
    "action_required",
    "paid",
    "failed_known",
    "outcome_unknown",
    "cancelled",
  ],
  action_required: [
    "processing",
    "failed_known",
    "outcome_unknown",
    "cancelled",
  ],
  outcome_unknown: [
    "processing",
    "action_required",
    "paid",
    "failed_known",
    "outcome_unknown",
    "cancelled",
  ],
  paid: [],
  failed_known: [],
  cancelled: [],
};

/** Keeps provider reconciliation monotonic while allowing conclusive cancellation. */
export function canTransitionReferralPayout(
  from: ReferralPayoutState,
  to: ReferralPayoutState,
): boolean {
  return REFERRAL_PAYOUT_TRANSITIONS[from].includes(to);
}
