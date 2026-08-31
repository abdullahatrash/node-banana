import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthSession } from "@/lib/auth/session";
import PairAgentClient from "./PairAgentClient";

export default async function PairAgentPage({
  params,
}: {
  params: Promise<{ challengeId: string }>;
}) {
  const { challengeId } = await params;
  const session = await getServerAuthSession(await headers());
  if (!session?.user) {
    const next = encodeURIComponent(`/agents/pair/${challengeId}`);
    redirect(`/sign-in?next=${next}`);
  }
  return <PairAgentClient confirmationId={challengeId} />;
}
