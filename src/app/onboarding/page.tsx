import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import { shouldRequireOnboarding } from "@/lib/onboarding/features";
import { ensurePersonalWorkspaceForUser } from "@/lib/studio/repository";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getServerAuthSession(await headers());
  if (session?.user?.emailVerified && !shouldRequireOnboarding(session.user.id)) {
    await ensurePersonalWorkspaceForUser({
      userId: session.user.id,
      userName: session.user.name,
      userEmail: session.user.email,
    });
    redirect("/dashboard");
  }
  return <OnboardingFlow />;
}
