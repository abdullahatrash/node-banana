import { describe, expect, it } from "vitest";
import { shouldRequireOnboarding } from "../features";

function environment(values: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...values };
}

describe("onboarding rollout cohort", () => {
  it("defaults to enabled and supports deterministic percentages", () => {
    expect(shouldRequireOnboarding("user_1", environment({}))).toBe(true);
    expect(
      shouldRequireOnboarding(
        "user_1",
        environment({ ONBOARDING_ROLLOUT_PERCENT: "0" }),
      ),
    ).toBe(false);
    expect(
      shouldRequireOnboarding(
        "user_1",
        environment({ ONBOARDING_ROLLOUT_PERCENT: "100" }),
      ),
    ).toBe(true);
  });

  it("keeps internal users enabled and provides a reversible kill switch", () => {
    expect(
      shouldRequireOnboarding(
        "internal_1",
        environment({
          ONBOARDING_ROLLOUT_PERCENT: "0",
          ONBOARDING_INTERNAL_USER_IDS: "internal_1,internal_2",
        }),
      ),
    ).toBe(true);
    expect(
      shouldRequireOnboarding(
        "internal_1",
        environment({
          ONBOARDING_KILL_SWITCH: "true",
          ONBOARDING_INTERNAL_USER_IDS: "internal_1",
        }),
      ),
    ).toBe(false);
  });

  it("returns the same cohort decision for the same user", () => {
    const env = environment({ ONBOARDING_ROLLOUT_PERCENT: "37" });
    expect(shouldRequireOnboarding("stable_user", env)).toBe(
      shouldRequireOnboarding("stable_user", env),
    );
  });
});
