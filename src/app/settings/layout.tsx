import type { ReactNode } from "react";
import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const context = await getProductShellContext("/settings");
  return <ProductShell context={context}>{children}</ProductShell>;
}
