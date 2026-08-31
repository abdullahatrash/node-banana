import { resolvePostAuthDestination } from "@/lib/auth/post-auth-destination";
import type { OnboardingRepository } from "./repository";

export async function resolveProductDestination(input: {
  repository: OnboardingRepository;
  userId: string;
  emailVerified: boolean;
  requestedPath?: string | null;
}): Promise<string> {
  const aggregate = await input.repository.readAggregate(input.userId);
  return resolvePostAuthDestination({
    emailVerified: input.emailVerified,
    onboardingStatus: aggregate?.session.status ?? null,
    requestedPath: input.requestedPath,
  });
}

export async function hasCompletedOnboarding(
  repository: OnboardingRepository,
  userId: string,
): Promise<boolean> {
  const aggregate = await repository.readAggregate(userId);
  return (
    aggregate?.session.status === "completed" ||
    aggregate?.session.status === "completed_legacy"
  );
}

