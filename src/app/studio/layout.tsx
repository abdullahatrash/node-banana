import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";

export default async function StudioLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerAuthSession(await headers());

  if (!session?.user) {
    redirect("/sign-in");
  }

  return children;
}
