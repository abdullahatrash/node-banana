import type { ReactNode } from "react";
import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export async function SupportLayout({ children, path }: { children: ReactNode; path: string }) {
  const context = await getProductShellContext(path);
  return <ProductShell context={context}>{children}</ProductShell>;
}
