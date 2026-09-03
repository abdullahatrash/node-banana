import { SimpleStudioLayout } from "@/components/simple-studio-shell/SimpleStudioLayout";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function SimpleStudioRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shellContext = await getProductShellContext("/simple-studio/images");

  return <SimpleStudioLayout shellContext={shellContext}>{children}</SimpleStudioLayout>;
}
