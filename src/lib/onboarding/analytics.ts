import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { onboardingAnalyticsEvents } from "@/lib/db/schema";
import {
  BRAND_ANALYSIS_STAGES,
  INTERFACE_LOCALES,
  ONBOARDING_STEPS,
} from "./contracts";

export const ONBOARDING_EVENT_NAMES = [
  "signup_submitted",
  "verification_sent",
  "verification_completed",
  "step_viewed",
  "step_completed",
  "source_selected",
  "analysis_stage_completed",
  "analysis_failed",
  "profile_accepted",
  "profile_edited",
  "first_value_viewed",
  "onboarding_completed",
] as const;

const safeId = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);

export const onboardingAnalyticsEventSchema = z
  .object({
    eventName: z.enum(ONBOARDING_EVENT_NAMES),
    userId: safeId.optional(),
    workspaceId: safeId.optional(),
    sessionId: safeId.optional(),
    runId: safeId.optional(),
    step: z.enum(ONBOARDING_STEPS).optional(),
    sourceKind: z.enum(["website", "description"]).optional(),
    stage: z.enum(BRAND_ANALYSIS_STAGES).optional(),
    interfaceLocale: z.enum(INTERFACE_LOCALES).optional(),
    contentLanguage: z
      .string()
      .trim()
      .min(2)
      .max(35)
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .optional(),
    durationMs: z.number().int().min(0).max(86_400_000).optional(),
    failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),
    occurredAt: z.date(),
  })
  .strict();

export type OnboardingAnalyticsEvent = z.infer<typeof onboardingAnalyticsEventSchema>;

export interface OnboardingAnalytics {
  record(event: OnboardingAnalyticsEvent): Promise<void>;
}

export const noOpOnboardingAnalytics: OnboardingAnalytics = {
  async record() {},
};

export class InMemoryOnboardingAnalytics implements OnboardingAnalytics {
  readonly events: OnboardingAnalyticsEvent[] = [];

  async record(event: OnboardingAnalyticsEvent) {
    this.events.push(structuredClone(onboardingAnalyticsEventSchema.parse(event)));
  }
}

export class PostgresOnboardingAnalytics implements OnboardingAnalytics {
  constructor(private readonly db: ReturnType<typeof getDb>) {}

  async record(event: OnboardingAnalyticsEvent) {
    const parsed = onboardingAnalyticsEventSchema.parse(event);
    await this.db.insert(onboardingAnalyticsEvents).values({
      id: `onbevt_${randomUUID()}`,
      ...parsed,
    });
  }
}

export function getOnboardingAnalytics(): OnboardingAnalytics {
  return isDatabaseConfigured()
    ? new PostgresOnboardingAnalytics(getDb())
    : noOpOnboardingAnalytics;
}

export async function recordOnboardingEventBestEffort(
  analytics: OnboardingAnalytics,
  event: OnboardingAnalyticsEvent,
) {
  try {
    await analytics.record(event);
  } catch {
    // Analytics can never replace the canonical onboarding result.
  }
}
