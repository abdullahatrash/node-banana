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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const PILLAR_ITEMS = [
  { href: "/studio", label: "AI Studio", icon: PaletteIcon },
  { href: "/editor/projects", label: "Video Editor", icon: VideoIcon },
  { href: "/social", label: "Social Hub", icon: ActivityIcon },
  { href: "/analytics", label: "Analytics", icon: BarChart3Icon },
]

interface AppSwitcherProps {
  children: React.ReactNode
  align?: "start" | "center" | "end"
}

export function AppSwitcher({ children, align = "start" }: AppSwitcherProps) {
  const pathname = usePathname()

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
            <span>{item.label}</span>
            {item.href === currentHref && (
              <span className="ms-auto text-[10px] text-muted-foreground">
                current
              </span>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => (window.location.href = "/dashboard")}
        >
          <BarChart3Icon className="size-4" />
          <span>Command Center</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
