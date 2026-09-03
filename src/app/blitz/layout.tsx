import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function BlitzLayout({ children }: { children: React.ReactNode }) {
  const shellContext = await getProductShellContext("/blitz");
  return <ProductShell context={shellContext}>{children}</ProductShell>;
}
