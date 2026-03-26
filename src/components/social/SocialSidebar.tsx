"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSocialAccountsStore } from "@/store/socialAccountsStore";
import { ChannelAvatar } from "./shared/ChannelAvatar";
import { StatusDot } from "./shared/StatusDot";
import type { SocialPlatform } from "@/lib/db/schema";

const NAV_ITEMS = [
  { href: "/social/calendar", label: "Calendar", icon: "📅" },
  { href: "/social/compose", label: "Compose", icon: "✏️" },
  { href: "/social/posts", label: "Posts", icon: "📝" },
  { href: "/social/channels", label: "Channels", icon: "📱" },
];

export function SocialSidebar() {
  const pathname = usePathname();
  const { accounts, selectedChannelFilter, setChannelFilter } =
    useSocialAccountsStore();

  return (
    <aside className="flex w-[220px] flex-shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 p-3">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-neutral-600">
          Navigation
        </div>
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                isActive
                  ? "bg-neutral-800 text-green-400"
                  : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="mx-3 border-t border-neutral-800" />

      {/* Channels */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-neutral-600">
          Channels
        </div>
        {accounts.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-neutral-600">
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
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  isFiltered
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200"
                }`}
              >
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
          className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-500 transition-colors hover:border-neutral-600 hover:text-neutral-400"
        >
          <span>+</span>
          <span>Add Channel</span>
        </Link>
      </div>
    </aside>
  );
}
