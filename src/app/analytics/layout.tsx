import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const shellContext = await getProductShellContext("/analytics");
  return <ProductShell context={shellContext}>{children}</ProductShell>;
}
