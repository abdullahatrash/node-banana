"use client"

import { usePathname } from "next/navigation"
import {
  PaletteIcon,
  VideoIcon,
  ActivityIcon,
  BarChart3Icon,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTranslations } from "next-intl"

const PILLAR_ITEMS = [
  { href: "/simple-studio/images", key: "simpleStudio", icon: PaletteIcon },
  { href: "/editor/projects", key: "videoEditor", icon: VideoIcon },
  { href: "/social", key: "socialHub", icon: ActivityIcon },
  { href: "/social/analytics", key: "analytics", icon: BarChart3Icon },
] as const

interface AppSwitcherProps {
  children: React.ReactNode
  align?: "start" | "center" | "end"
}

export function AppSwitcher({ children, align = "start" }: AppSwitcherProps) {
  const pathname = usePathname()
  const t = useTranslations("shell")

  const currentHref = PILLAR_ITEMS.find(
    (item) => pathname === item.href || pathname?.startsWith(item.href + "/")
  )?.href

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-48">
        {PILLAR_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.href}
            onClick={() => (window.location.href = item.href)}
          >
            <item.icon className="size-4" />
            <span>{t(`areas.${item.key}`)}</span>
            {item.href === currentHref && (
              <span className="ms-auto text-[10px] text-muted-foreground">
                {t("current")}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
