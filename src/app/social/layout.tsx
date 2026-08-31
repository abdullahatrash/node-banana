import { SocialLayout } from "@/components/social/SocialLayout";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";

export default async function SocialRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireOnboardingComplete("/social/calendar");

  return <SocialLayout>{children}</SocialLayout>;
}
