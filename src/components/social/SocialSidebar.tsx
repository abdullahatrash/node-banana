"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSocialAccountsStore } from "@/store/socialAccountsStore";
import { ChannelAvatar } from "./shared/ChannelAvatar";
import { StatusDot } from "./shared/StatusDot";
import { CalendarIcon, ComposeIcon, PostsIcon, ChannelsIcon, PlusIcon } from "./icons";
import type { SocialPlatform } from "@/lib/db/schema";

const NAV_ITEMS = [
  { href: "/social/calendar", label: "Calendar", Icon: CalendarIcon },
  { href: "/social/compose", label: "Compose", Icon: ComposeIcon },
  { href: "/social/posts", label: "Posts", Icon: PostsIcon },
  { href: "/social/channels", label: "Channels", Icon: ChannelsIcon },
];

export function SocialSidebar() {
  const pathname = usePathname();
  const { accounts, selectedChannelFilter, setChannelFilter } =
    useSocialAccountsStore();

  return (
    <aside className="flex w-[220px] flex-shrink-0 flex-col border-r border-neutral-900 bg-[#0a0a0a]">
      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 p-3">
        <div className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-neutral-600">
          Navigation
        </div>
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-xs transition-all duration-150 ${
                isActive
                  ? "bg-neutral-900 text-green-400"
                  : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
              }`}
            >
              <item.Icon size={14} className={isActive ? "opacity-100" : "opacity-60"} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="mx-3 border-t border-neutral-900" />

      {/* Channels */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        <div className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-neutral-600">
          Channels
        </div>
        {accounts.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-neutral-700">
            No channels connected
          </div>
        ) : (
          accounts.map((account) => {
            const isFiltered = selectedChannelFilter === account.id;
            return (
              <button
                key={account.id}
                onClick={() =>
                  setChannelFilter(isFiltered ? null : account.id)
                }
                className={`group relative flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[11px] transition-all duration-150 ${
                  isFiltered
                    ? "bg-neutral-900 text-neutral-100"
                    : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
                }`}
              >
                {/* Hover accent bar */}
                <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-sm bg-gradient-to-b from-green-400 to-cyan-400 opacity-0 transition-opacity group-hover:opacity-100" />
                <ChannelAvatar
                  platform={account.platform as SocialPlatform}
                  displayName={account.displayName}
                  avatarUrl={account.avatarUrl}
                  size={22}
                />
                <span className="min-w-0 flex-1 truncate">
                  {account.displayName}
                </span>
                <StatusDot
                  status={
                    account.requiresReauth
                      ? "needs-reauth"
                      : account.disabled
                        ? "disabled"
                        : "connected"
                  }
                />
              </button>
            );
          })
        )}

        <Link
          href="/social/channels"
          className="mt-2 flex items-center gap-1.5 rounded-[5px] border border-dashed border-neutral-800 px-2 py-1.5 text-[11px] text-neutral-600 transition-all duration-150 hover:border-neutral-700 hover:bg-[#0f0f0f] hover:text-neutral-500"
        >
          <PlusIcon size={12} />
          <span>Add channel</span>
        </Link>
      </div>
    </aside>
  );
}
