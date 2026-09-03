"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useTranslations } from "next-intl"

const PAGE_TITLES = {
  "/social/calendar": "calendar",
  "/social/compose": "compose",
  "/social/posts": "posts",
  "/social/channels": "channels",
  "/social/events": "events",
  "/social/analytics": "analytics",
  "/social/media": "media",
  "/social/integrations": "integrations",
  "/social/plugs": "plugs",
  "/social/agents": "agents",
} as const

export function SocialSiteHeader() {
  const pathname = usePathname()
  const t = useTranslations("shell")

  // Find the matching title
  const titleKey =
    Object.entries(PAGE_TITLES).find(
      ([path]) => pathname === path || pathname?.startsWith(path + "/"),
    )?.[1]
  const title = titleKey ? t(`routes.${titleKey}`) : t("areas.socialHub")

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ms-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <h1 className="text-base font-medium">{title}</h1>

        <div className="ms-auto">
          <Button size="sm" render={<Link href="/social/compose" />} nativeButton={false}>
            <PlusIcon className="size-4" />
            {t("actions.newPost")}
          </Button>
        </div>
      </div>
    </header>
  )
}
