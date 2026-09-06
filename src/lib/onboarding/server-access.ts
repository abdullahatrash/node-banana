import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { resolvePostAuthDestination } from "@/lib/auth/post-auth-destination";
import { PostgresOnboardingRepository } from "./postgres-repository";
import { shouldRequireOnboarding } from "./features";
import { ensurePersonalWorkspaceForUser } from "@/lib/studio/repository";

export const requireOnboardingComplete = cache(async (requestedPath: string) => {
  const requestHeaders = await headers();
  const headerPath = requestHeaders.get("x-interface-route");
  const resolvedPath =
    headerPath &&
    headerPath.startsWith("/") &&
    !headerPath.startsWith("//") &&
    !headerPath.startsWith("/api/") &&
    !headerPath.includes(":")
      ? headerPath
      : requestedPath;
  const session = await getServerAuthSession(requestHeaders);
  if (!session?.user) {
    redirect(`/sign-in?next=${encodeURIComponent(resolvedPath)}`);
  }
  if (session.user.emailVerified !== true) {
    redirect(`/verify-email?next=${encodeURIComponent(resolvedPath)}`);
  }
  if (!isDatabaseConfigured()) {
    redirect(`/onboarding?next=${encodeURIComponent(resolvedPath)}`);
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
    requestedPath: resolvedPath,
  });
  if (destination !== resolvedPath) redirect(destination);
  return { session, aggregate, repository };
});
