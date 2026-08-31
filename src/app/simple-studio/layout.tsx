import { SimpleStudioLayout } from "@/components/simple-studio-shell/SimpleStudioLayout";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";

export default async function SimpleStudioRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireOnboardingComplete("/simple-studio/images");

  return <SimpleStudioLayout>{children}</SimpleStudioLayout>;
}
