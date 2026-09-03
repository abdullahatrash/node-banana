import type { Metadata } from "next";
import { InvitationAcceptanceClient } from "@/components/governance/InvitationAcceptanceClient";

export const metadata: Metadata = { robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };

export default async function InvitationPage({ params }: { params: Promise<{ invitationToken: string }> }) {
  const { invitationToken } = await params;
  return <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4"><InvitationAcceptanceClient invitationToken={invitationToken} /></main>;
}
