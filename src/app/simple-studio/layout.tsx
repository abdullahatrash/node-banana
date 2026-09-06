import { SimpleStudioLayout } from "@/components/simple-studio-shell/SimpleStudioLayout";
import { getProductShellContext } from "@/lib/product-shell/server";
import { requireOnboardingComplete } from "@/lib/onboarding/server-access";
import { validateWorkspaceContentLanguage } from "@/lib/product-surfaces/workspace-language-preferences";

export default async function SimpleStudioRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [shellContext, access] = await Promise.all([
    getProductShellContext("/simple-studio/images"),
    requireOnboardingComplete("/simple-studio/images"),
  ]);
  const defaultContentLanguage = validateWorkspaceContentLanguage(access.aggregate?.contentLanguage ?? "ar");

  return <SimpleStudioLayout shellContext={shellContext} defaultContentLanguage={defaultContentLanguage}>{children}</SimpleStudioLayout>;
}
