import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function AgentsLayout({ children }: { children: React.ReactNode }) {
  const shellContext = await getProductShellContext("/agents");
  return <ProductShell context={shellContext}>{children}</ProductShell>;
}
