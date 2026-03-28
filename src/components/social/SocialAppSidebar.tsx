"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  CalendarIcon,
  PenSquareIcon,
  FileTextIcon,
  ActivityIcon,
  PlusIcon,
  BananaIcon,
} from "lucide-react"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { PlatformIcon } from "./shared/PlatformIcon"
import { StatusDot } from "./shared/StatusDot"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { AppSwitcher } from "@/components/AppSwitcher"
import type { SocialPlatform } from "@/lib/db/schema"
import { PLATFORM_LABELS } from "@/lib/social/constants"
import { authClient } from "@/lib/auth/client"

const NAV_ITEMS = [
  { href: "/social/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/social/compose", label: "Compose", icon: PenSquareIcon },
  { href: "/social/posts", label: "Posts", icon: FileTextIcon },
  { href: "/social/channels", label: "Channels", icon: ActivityIcon },
]


export function SocialAppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { accounts, selectedChannelFilter, setChannelFilter } =
    useSocialAccountsStore()
  const session = authClient.useSession()

  const user = {
    name: session.data?.user?.name || "User",
    email: session.data?.user?.email || "",
    avatar: session.data?.user?.image || "",
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <AppSwitcher>
              <button className="flex w-full items-center gap-2 rounded-md p-1.5 text-start text-sm font-semibold hover:bg-sidebar-accent">
                <BananaIcon className="size-5" />
                <span className="text-base font-semibold">Social Hub</span>
              </button>
            </AppSwitcher>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive =
                  pathname === item.href || pathname?.startsWith(item.href + "/")
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton isActive={isActive} render={<Link href={item.href} />}>
                        <item.icon />
                        <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Connected Channels */}
        <SidebarGroup>
          <SidebarGroupLabel>Channels</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {accounts.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton className="text-muted-foreground">
                    <span className="text-xs">No channels connected</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                accounts.map((account) => {
                  const isFiltered = selectedChannelFilter === account.id
                  return (
                    <SidebarMenuItem key={account.id}>
                      <SidebarMenuButton
                        isActive={isFiltered}
                        onClick={() =>
                          setChannelFilter(isFiltered ? null : account.id)
                        }
                        tooltip={`${account.displayName} (${PLATFORM_LABELS[account.platform as SocialPlatform] ?? account.platform})`}
                      >
                        <PlatformIcon
                          platform={account.platform as SocialPlatform}
                          size={16}
                        />
                        <span className="truncate">{account.displayName}</span>
                        <StatusDot
                          status={
                            account.requiresReauth
                              ? "needs-reauth"
                              : account.disabled
                                ? "disabled"
                                : "connected"
                          }
                          size="sm"
                        />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })
              )}

              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/social/channels" />} className="text-muted-foreground">
                  <PlusIcon />
                  <span>Add channel</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
