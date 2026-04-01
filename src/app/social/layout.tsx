import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import { SocialLayout } from "@/components/social/SocialLayout";

export default async function SocialRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerAuthSession(await headers());

  if (!session?.user) {
    redirect("/sign-in?next=%2Fsocial%2Fcalendar");
  }

  return <SocialLayout>{children}</SocialLayout>;
}
