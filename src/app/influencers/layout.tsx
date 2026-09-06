import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function InfluencersLayout({ children }: { children: React.ReactNode }) {
  const context = await getProductShellContext("/influencers");
  return <ProductShell context={context}>{children}</ProductShell>;
}
