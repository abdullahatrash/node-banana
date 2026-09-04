export const CHANNEL_ONBOARDING_STATES = [
  "draft", "quoted", "payment_pending", "accepted", "customer_action", "partner_action", "readiness_review",
  "ready_to_connect", "connected", "blocked", "cancelled", "refunded", "failed",
] as const;
export type ChannelOnboardingState = (typeof CHANNEL_ONBOARDING_STATES)[number];

export const CHANNEL_ONBOARDING_TRANSITIONS: Record<ChannelOnboardingState, readonly ChannelOnboardingState[]> = {
  draft: ["quoted", "cancelled"],
  quoted: ["payment_pending", "cancelled"],
  payment_pending: ["accepted", "cancelled", "failed"],
  accepted: ["customer_action", "partner_action", "cancelled", "failed"],
  customer_action: ["partner_action", "readiness_review", "blocked", "cancelled", "failed"],
  partner_action: ["customer_action", "readiness_review", "blocked", "cancelled", "failed"],
  readiness_review: ["ready_to_connect", "customer_action", "partner_action", "blocked", "cancelled", "failed"],
  ready_to_connect: ["connected", "blocked", "cancelled", "failed"],
  connected: ["blocked"],
  blocked: ["customer_action", "partner_action", "readiness_review", "ready_to_connect", "cancelled", "failed"],
  cancelled: ["refunded"],
  refunded: [],
  failed: ["customer_action", "partner_action", "cancelled", "refunded"],
};

export const FORBIDDEN_PARTNER_ACTIONS = new Set(["credential.read", "credential.write", "publish", "impersonate"]);

export function assertTransition(from: string, to: ChannelOnboardingState) {
  if (!CHANNEL_ONBOARDING_TRANSITIONS[from as ChannelOnboardingState]?.includes(to)) throw new Error("ORDER_TRANSITION_INVALID");
}

export function partnerScopeIsSafe(actions: string[]) {
  return actions.length > 0 && actions.length <= 20 && actions.every((action) => /^[a-z][a-z0-9_.-]{2,79}$/.test(action) && !FORBIDDEN_PARTNER_ACTIONS.has(action));
}
