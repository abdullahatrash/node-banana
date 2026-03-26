"use client";

import Link from "next/link";
import { PillarSwitcher } from "./PillarSwitcher";
import { authClient } from "@/lib/auth/client";

export function SocialHeader() {
  const session = authClient.useSession();
  const userName =
    session.data?.user?.name || session.data?.user?.email || "User";

  return (
    <header className="flex h-11 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4">
      <Link href="/social" className="text-lg font-bold text-neutral-100">
        🍌
      </Link>
      <PillarSwitcher currentPillar="social" />

      <div className="flex-1" />

      <Link
        href="/social/compose"
        className="rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-500 transition-colors"
      >
        + New Post
      </Link>

      <span className="text-xs text-neutral-500">{userName}</span>
    </header>
  );
}
