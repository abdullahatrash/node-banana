"use client";

import Link from "next/link";
import { PillarSwitcher } from "./PillarSwitcher";
import { PlusIcon } from "./icons";
import { authClient } from "@/lib/auth/client";

export function SocialHeader() {
  const session = authClient.useSession();
  const userName =
    session.data?.user?.name || session.data?.user?.email || "";

  return (
    <header className="flex h-11 items-center gap-2.5 border-b border-neutral-900 bg-[#0f0f0f] px-4">
      <Link href="/social" className="text-base font-bold text-neutral-100">
        🍌
      </Link>
      <PillarSwitcher currentPillar="social" />

      <div className="flex-1" />

      <Link
        href="/social/compose"
        className="flex items-center gap-1 rounded-[5px] bg-green-700 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-green-600"
      >
        <PlusIcon size={12} />
        New Post
      </Link>

      {userName && (
        <span className="text-[11px] text-neutral-600">{userName}</span>
      )}
    </header>
  );
}
