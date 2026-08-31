import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { resolvePostAuthDestination } from "@/lib/auth/post-auth-destination";
import { PostgresOnboardingRepository } from "./postgres-repository";
import { shouldRequireOnboarding } from "./features";
import { ensurePersonalWorkspaceForUser } from "@/lib/studio/repository";

export async function requireOnboardingComplete(requestedPath: string) {
  const session = await getServerAuthSession(await headers());
  if (!session?.user) {
    redirect(`/sign-in?next=${encodeURIComponent(requestedPath)}`);
  }
  if (session.user.emailVerified !== true) {
    redirect(`/verify-email?next=${encodeURIComponent(requestedPath)}`);
  }
  if (!isDatabaseConfigured()) {
    redirect(`/onboarding?next=${encodeURIComponent(requestedPath)}`);
  }

  if (!shouldRequireOnboarding(session.user.id)) {
    await ensurePersonalWorkspaceForUser({
      userId: session.user.id,
      userName: session.user.name,
      userEmail: session.user.email,
    });
    const repository = new PostgresOnboardingRepository(getDb());
    return {
      session,
      aggregate: await repository.readAggregate(session.user.id),
      repository,
    };
  }

  const repository = new PostgresOnboardingRepository(getDb());
  const aggregate = await repository.readAggregate(session.user.id);
  const destination = resolvePostAuthDestination({
    emailVerified: true,
    onboardingStatus: aggregate?.session.status ?? null,
    requestedPath,
  });
  if (destination !== requestedPath) redirect(destination);
  return { session, aggregate, repository };
}
