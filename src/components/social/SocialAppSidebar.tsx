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
  BarChart3Icon,
  ImageIcon,
  PlugIcon,
  BotIcon,
  PuzzleIcon,
  BellIcon,
  SparklesIcon,
  KeyRoundIcon,
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
import { useTranslations } from "next-intl"

const NAV_ITEMS = [
  { href: "/social/calendar", key: "calendar", icon: CalendarIcon },
  { href: "/social/compose", key: "compose", icon: PenSquareIcon },
  { href: "/social/copilot", key: "copilot", icon: SparklesIcon },
  { href: "/social/posts", key: "posts", icon: FileTextIcon },
  { href: "/social/channels", key: "channels", icon: ActivityIcon },
  { href: "/social/events", key: "events", icon: BellIcon },
  { href: "/social/analytics", key: "analytics", icon: BarChart3Icon },
  { href: "/social/media", key: "media", icon: ImageIcon },
  { href: "/social/integrations", key: "integrations", icon: PuzzleIcon },
  { href: "/social/plugs", key: "plugs", icon: PlugIcon },
  { href: "/social/agents", key: "agents", icon: BotIcon },
  { href: "/social/settings", key: "settings", icon: KeyRoundIcon },
] as const


export function SocialAppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { accounts, selectedChannelFilter, setChannelFilter } =
    useSocialAccountsStore()
  const session = authClient.useSession()
  const t = useTranslations("shell")

  const user = {
    name: session.data?.user?.name || t("userFallback"),
    email: session.data?.user?.email || "",
    avatar: session.data?.user?.image || "",
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <AppSwitcher>
              <div className="flex w-full items-center gap-2 rounded-md p-1.5 text-start text-sm font-semibold hover:bg-sidebar-accent cursor-pointer">
                <BananaIcon className="size-5" />
                <span className="text-base font-semibold">{t("areas.socialHub")}</span>
              </div>
            </AppSwitcher>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>{t("groups.navigation")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive =
                  pathname === item.href || pathname?.startsWith(item.href + "/")
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton isActive={isActive} render={<Link href={item.href} />}>
                        <item.icon />
                        <span>{t(`routes.${item.key}`)}</span>
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
          <SidebarGroupLabel>{t("groups.channels")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {accounts.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton className="text-muted-foreground">
                    <span className="text-xs">{t("noChannels")}</span>
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
                  <span>{t("actions.addChannel")}</span>
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
