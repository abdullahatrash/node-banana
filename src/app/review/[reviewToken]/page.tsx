import type { Metadata } from "next";
import { ReviewGuestClient } from "@/components/governance/ReviewGuestClient";

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function ReviewGuestPage({ params }: { params: Promise<{ reviewToken: string }> }) {
  const { reviewToken } = await params;
  return <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4"><ReviewGuestClient reviewToken={reviewToken} /></main>;
}
