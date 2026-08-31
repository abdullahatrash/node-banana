import { requireOnboardingComplete } from "@/lib/onboarding/server-access";

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  await requireOnboardingComplete("/editor");
  return children;
}
