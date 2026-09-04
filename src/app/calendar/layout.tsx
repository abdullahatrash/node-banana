import { SocialLayout } from "@/components/social/SocialLayout";
import { getProductShellContext } from "@/lib/product-shell/server";
export default async function CalendarLayout({ children }: { children: React.ReactNode }) { return <SocialLayout shellContext={await getProductShellContext("/calendar")}>{children}</SocialLayout>; }
