"use client"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { EllipsisVerticalIcon, CircleUserRoundIcon, LogOutIcon, LanguagesIcon } from "lucide-react"
import { useDirectionStore } from "@/store/directionStore"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { authClient } from "@/lib/auth/client"
import { getActiveWorkspaceId } from "@/lib/studio/client"

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
}) {
  const { isMobile } = useSidebar()
  const locale = useLocale()
  const setLocale = useDirectionStore((state) => state.setLocale)
  const router = useRouter()
  const t = useTranslations("common")
  const initials = user.name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase() || "—"

  function toggleLanguage() {
    const next = locale === "en" ? "ar" : "en"
    const workspaceId = getActiveWorkspaceId()
    setLocale(next)
    void fetch("/api/preferences/locale", {
      method: "POST",
      headers: { "content-type": "application/json", ...(workspaceId ? { "x-workspace-id": workspaceId } : {}) },
      body: JSON.stringify({ locale: next }),
      keepalive: true,
    })
    router.refresh()
  }

  async function logOut() {
    await authClient.signOut()
    router.replace("/sign-in")
    router.refresh()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
            }
          >
            <Avatar className="size-8 rounded-lg grayscale">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span dir="ltr" className="truncate text-start text-xs text-foreground/70">
                {user.email}
              </span>
            </div>
            <EllipsisVerticalIcon className="ms-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : locale === "ar" ? "left" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
                  <Avatar className="size-8">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-start text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span dir="ltr" className="truncate text-start text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push("/settings?section=account")}>
                <CircleUserRoundIcon
                />
                {t("account")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={toggleLanguage}>
              <LanguagesIcon />
              {t(`languageSwitch.${locale === "en" ? "ar" : "en"}`)}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logOut()}>
              <LogOutIcon
              />
              {t("logOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
