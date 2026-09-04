import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  return <ProductShell context={await getProductShellContext("/billing")}>{children}</ProductShell>;
}
