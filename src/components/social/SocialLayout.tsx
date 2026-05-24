"use client"

import { useEffect } from "react"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { SocialAppSidebar } from "./SocialAppSidebar"
import { SocialSiteHeader } from "./SocialSiteHeader"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

interface SocialLayoutProps {
  children: React.ReactNode
}

export function SocialLayout({ children }: SocialLayoutProps) {
  const fetchAccounts = useSocialAccountsStore((s) => s.fetchAccounts)

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <SocialAppSidebar variant="inset" />
      <SidebarInset>
        <SocialSiteHeader />
        <div className="flex flex-1 flex-col">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
