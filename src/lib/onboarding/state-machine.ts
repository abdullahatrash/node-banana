import type { OnboardingStatus, OnboardingStep } from "./contracts";
import { OnboardingError } from "./errors";
import type { OnboardingCommandRequest } from "./schemas";

type OnboardingCommandType = OnboardingCommandRequest["type"];

const COMMAND_STEP: Record<OnboardingCommandType, OnboardingStep> = {
  save_identity: "identity",
  set_brand_source: "brand_source",
  save_company_stage: "company_stage",
  save_role: "role",
  save_business_classification: "business_classification",
  save_goals: "goals",
  save_attribution: "attribution",
  accept_brand_profile: "review",
  retry_analysis: "review",
  complete: "education",
};

const NEXT_STEP: Partial<Record<OnboardingCommandType, OnboardingStep>> = {
  save_identity: "brand_source",
  set_brand_source: "company_stage",
  save_company_stage: "role",
  save_role: "business_classification",
  save_business_classification: "goals",
  save_goals: "attribution",
  save_attribution: "review",
  accept_brand_profile: "education",
};

export interface OnboardingTransitionState {
  status: OnboardingStatus;
  currentStep: OnboardingStep;
}

export interface OnboardingTransitionContext {
  analysisReady: boolean;
  hasDraftProfile: boolean;
  hasActiveProfile: boolean;
  hasActivationArtifact: boolean;
}

export function transitionOnboarding(
  state: OnboardingTransitionState,
  command: OnboardingCommandType,
  context: OnboardingTransitionContext,
): OnboardingTransitionState {
  if (state.status === "completed" || state.status === "completed_legacy") {
    throw new OnboardingError(
      "ONBOARDING_COMMAND_INVALID",
      "Completed onboarding cannot be changed through the onboarding flow.",
      409,
    );
  }

  const requiredStep = COMMAND_STEP[command];
  if (state.currentStep !== requiredStep) {
    throw new OnboardingError(
      "ONBOARDING_COMMAND_INVALID",
      `The ${command} command is not valid during ${state.currentStep}.`,
      409,
      { expectedStep: requiredStep, actualStep: state.currentStep },
    );
  }

  if (command === "retry_analysis") {
    if (context.analysisReady) {
      throw new OnboardingError(
        "ONBOARDING_COMMAND_INVALID",
        "A ready analysis does not need to be retried.",
        409,
      );
    }
    return { status: "in_progress", currentStep: "review" };
  }

  if (command === "accept_brand_profile") {
    if (!context.analysisReady || !context.hasDraftProfile) {
      throw new OnboardingError(
        "ONBOARDING_NOT_READY",
        "The Brand Profile is not ready for review.",
        409,
      );
    }
  }

  if (command === "complete") {
    if (!context.hasActiveProfile || !context.hasActivationArtifact) {
      throw new OnboardingError(
        "ONBOARDING_NOT_READY",
        "The workspace is still preparing its first content suggestion.",
        409,
      );
    }
    return { status: "completed", currentStep: "education" };
  }

  return {
    status: command === "save_identity" ? "in_progress" : state.status,
    currentStep: NEXT_STEP[command] ?? state.currentStep,
  };
}

