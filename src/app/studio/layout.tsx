import { requireOnboardingComplete } from "@/lib/onboarding/server-access";

export default async function StudioLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireOnboardingComplete("/studio/usage");

  return children;
}
