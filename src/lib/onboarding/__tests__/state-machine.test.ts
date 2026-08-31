import { describe, expect, it } from "vitest";
import { OnboardingError } from "../errors";
import {
  transitionOnboarding,
  type OnboardingTransitionState,
} from "../state-machine";

const emptyContext = {
  analysisReady: false,
  hasDraftProfile: false,
  hasActiveProfile: false,
  hasActivationArtifact: false,
};

describe("transitionOnboarding", () => {
  it("advances the questionnaire in its canonical order", () => {
    let state: OnboardingTransitionState = {
      status: "not_started",
      currentStep: "identity",
    };
    state = transitionOnboarding(state, "save_identity", emptyContext);
    expect(state).toEqual({ status: "in_progress", currentStep: "brand_source" });

    expect(
      transitionOnboarding(state, "set_brand_source", emptyContext),
    ).toEqual({ status: "in_progress", currentStep: "company_stage" });
  });

  it("rejects out-of-order commands", () => {
    expect(() =>
      transitionOnboarding(
        { status: "in_progress", currentStep: "role" },
        "save_goals",
        emptyContext,
      ),
    ).toThrowError(OnboardingError);
  });

  it("keeps retry on review and refuses to retry ready analysis", () => {
    expect(
      transitionOnboarding(
        { status: "in_progress", currentStep: "review" },
        "retry_analysis",
        emptyContext,
      ),
    ).toEqual({ status: "in_progress", currentStep: "review" });

    expect(() =>
      transitionOnboarding(
        { status: "ready", currentStep: "review" },
        "retry_analysis",
        { ...emptyContext, analysisReady: true },
      ),
    ).toThrowError(/does not need to be retried/);
  });

  it("requires a ready draft before review acceptance", () => {
    expect(() =>
      transitionOnboarding(
        { status: "in_progress", currentStep: "review" },
        "accept_brand_profile",
        emptyContext,
      ),
    ).toThrowError(/not ready for review/);
  });

  it("advances an accepted profile to education", () => {
    expect(
      transitionOnboarding(
        { status: "ready", currentStep: "review" },
        "accept_brand_profile",
        { ...emptyContext, analysisReady: true, hasDraftProfile: true },
      ),
    ).toEqual({ status: "ready", currentStep: "education" });
  });

  it("requires both active profile and activation artifact for completion", () => {
    expect(() =>
      transitionOnboarding(
        { status: "ready", currentStep: "education" },
        "complete",
        { ...emptyContext, hasActiveProfile: true },
      ),
    ).toThrowError(/still preparing/);

    expect(
      transitionOnboarding(
        { status: "ready", currentStep: "education" },
        "complete",
        {
          ...emptyContext,
          hasActiveProfile: true,
          hasActivationArtifact: true,
        },
      ),
    ).toEqual({ status: "completed", currentStep: "education" });
  });

  it("does not mutate completed onboarding", () => {
    expect(() =>
      transitionOnboarding(
        { status: "completed", currentStep: "education" },
        "complete",
        {
          ...emptyContext,
          hasActiveProfile: true,
          hasActivationArtifact: true,
        },
      ),
    ).toThrowError(/cannot be changed/);
  });
});
