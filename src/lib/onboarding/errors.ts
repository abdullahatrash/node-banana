export type OnboardingErrorCode =
  | "ONBOARDING_COMMAND_INVALID"
  | "ONBOARDING_CONFLICT"
  | "ONBOARDING_NOT_FOUND"
  | "ONBOARDING_NOT_READY"
  | "ONBOARDING_UNAUTHORIZED"
  | "ONBOARDING_VALIDATION_FAILED";

export class OnboardingError extends Error {
  constructor(
    readonly code: OnboardingErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

