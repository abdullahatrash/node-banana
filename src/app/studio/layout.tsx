import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function StudioLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shellContext = await getProductShellContext("/studio/usage");

  return <ProductShell context={shellContext}>{children}</ProductShell>;
}
