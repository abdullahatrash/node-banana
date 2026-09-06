import { start } from "workflow/api";
import { executeOnboardingBrandAnalysis } from "@/../workflows/onboarding-brand-analysis";
import type { OnboardingQueue } from "./queue";

export class DurableOnboardingQueue implements OnboardingQueue {
  async schedule(input: Parameters<OnboardingQueue["schedule"]>[0]) {
    await start(executeOnboardingBrandAnalysis, [input]);
  }
}
