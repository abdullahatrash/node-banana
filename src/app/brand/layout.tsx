import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function BrandLayout({ children }: { children: React.ReactNode }) {
  return <ProductShell context={await getProductShellContext("/brand")}>{children}</ProductShell>;
}

