import type { ContentOSPlanTier } from "@/lib/studio/authz";

export interface SocialPlanLimits {
  channels: number;
  postsPerMonth: number;
  webhooks: number;
}

const SOCIAL_LIMITS: Record<ContentOSPlanTier, SocialPlanLimits> = {
  free: {
    channels: 3,
    postsPerMonth: 50,
    webhooks: 1,
  },
  pro: {
    channels: 15,
    postsPerMonth: 1000,
    webhooks: 10,
  },
  enterprise: {
    channels: 500,
    postsPerMonth: 100000,
    webhooks: 500,
  },
};

export function getSocialPlanLimits(planTier: ContentOSPlanTier): SocialPlanLimits {
  return SOCIAL_LIMITS[planTier] ?? SOCIAL_LIMITS.free;
}

export function getBillingUrl(): string {
  if (process.env.BILLING_URL?.trim()) {
    return process.env.BILLING_URL;
  }

  if (process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    return `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/billing`;
  }

  return "/billing";
}

export function quotaExceededPayload(input: {
  section: "channels" | "posts_per_month" | "webhooks";
  current: number;
  limit: number;
}) {
  return {
    success: false,
    code: "quota_exceeded",
    error:
      input.section === "channels"
        ? "Channel limit reached for your current plan."
        : input.section === "posts_per_month"
          ? "Monthly post limit reached for your current plan."
          : "Webhook limit reached for your current plan.",
    section: input.section,
    current: input.current,
    limit: input.limit,
    billingUrl: getBillingUrl(),
  };
}
