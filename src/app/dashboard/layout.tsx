import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const shellContext = await getProductShellContext("/dashboard");
  return <ProductShell context={shellContext}>{children}</ProductShell>;
}
