import { SocialLayout } from "@/components/social/SocialLayout";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function SocialRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shellContext = await getProductShellContext("/social/calendar");

  return <SocialLayout shellContext={shellContext}>{children}</SocialLayout>;
}
