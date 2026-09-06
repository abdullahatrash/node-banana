import { start } from "workflow/api";
import { executeOnboardingBrandAnalysis } from "@/../workflows/onboarding-brand-analysis";
import type { OnboardingQueue } from "./queue";

export class DurableOnboardingQueue implements OnboardingQueue {
  async schedule(input: Parameters<OnboardingQueue["schedule"]>[0]) {
    try {
      await start(executeOnboardingBrandAnalysis, [input]);
    } catch (error) {
      // Keep operational diagnostics without logging source text, tokens or provider responses.
      const fields = error && typeof error === "object" ? error : {};
      const label = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : undefined;
      console.error("[onboarding] Workflow dispatch failed", {
        workspaceId: input.workspaceId,
        runId: input.runId,
        name: label("name" in fields ? fields.name : undefined),
        code: label("code" in fields ? fields.code : undefined),
        slug: label("slug" in fields ? fields.slug : undefined),
        status: "status" in fields && typeof fields.status === "number" ? fields.status : undefined,
        vercelDeploymentAvailable: Boolean(process.env.VERCEL_DEPLOYMENT_ID),
      });
      throw error;
    }
  }
}
