"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

const PAGE_TITLES: Record<string, string> = {
  "/social/calendar": "Calendar",
  "/social/compose": "Compose",
  "/social/posts": "Posts",
  "/social/channels": "Channels",
  "/social/events": "Events",
  "/social/analytics": "Analytics",
  "/social/media": "Media",
  "/social/integrations": "Integrations",
  "/social/plugs": "Plugs",
  "/social/agents": "Agents",
}

export function SocialSiteHeader() {
  const pathname = usePathname()

  // Find the matching title
  const title =
    Object.entries(PAGE_TITLES).find(
      ([path]) => pathname === path || pathname?.startsWith(path + "/"),
    )?.[1] ?? "Social Hub"

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
            New Post
          </Button>
        </div>
      </div>
    </header>
  )
}
