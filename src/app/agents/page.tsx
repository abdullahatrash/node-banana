import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import AgentsClient from "./AgentsClient";

export default async function AgentsPage() {
  const session = await getServerAuthSession(await headers());
  if (!session?.user) {
    redirect("/sign-in?next=%2Fagents");
  }
  return <AgentsClient />;
}
