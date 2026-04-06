import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import { SimpleStudioLayout } from "@/components/simple-studio-shell/SimpleStudioLayout";

export default async function SimpleStudioRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerAuthSession(await headers());

  if (!session?.user) {
    redirect("/sign-in?next=%2Fsimple-studio%2Fimages");
  }

  return <SimpleStudioLayout>{children}</SimpleStudioLayout>;
}
