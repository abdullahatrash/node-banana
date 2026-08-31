import { requireOnboardingComplete } from "@/lib/onboarding/server-access";

export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  await requireOnboardingComplete("/agents");
  return children;
}
