import { ProductShell } from "@/components/product-shell/ProductShell";
import { getProductShellContext } from "@/lib/product-shell/server";
export default async function ChannelOnboardingLayout({ children }: { children: React.ReactNode }) { const context = await getProductShellContext("/channels/onboarding"); return <ProductShell context={context}>{children}</ProductShell>; }
