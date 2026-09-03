import type { OnboardingStatus } from "@/lib/onboarding/contracts";

export function isSafeLocalPath(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes(":") &&
      !value.startsWith("/api/"),
  );
}

export function resolvePostAuthDestination(input: {
  emailVerified: boolean;
  onboardingStatus: OnboardingStatus | null;
  requestedPath?: string | null;
}): string {
  const requestedPath = isSafeLocalPath(input.requestedPath)
    ? input.requestedPath
    : null;

  if (!input.emailVerified) {
    const next = requestedPath
      ? `?next=${encodeURIComponent(requestedPath)}`
      : "";
    return `/verify-email${next}`;
  }

  if (
    input.onboardingStatus !== "completed" &&
    input.onboardingStatus !== "completed_legacy"
  ) {
    const next = requestedPath
      ? `?next=${encodeURIComponent(requestedPath)}`
      : "";
    return `/onboarding${next}`;
  }

  if (requestedPath) return requestedPath;
  return "/dashboard";
}
