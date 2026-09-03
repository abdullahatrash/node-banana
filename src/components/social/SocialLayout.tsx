"use client"

import { useEffect } from "react"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { SocialHeaderActions } from "./SocialSiteHeader"
import { ProductShell } from "@/components/product-shell/ProductShell"
import type { ProductShellContext } from "@/lib/product-shell/server"

interface SocialLayoutProps {
  children: React.ReactNode
  shellContext: ProductShellContext
}

export function SocialLayout({ children, shellContext }: SocialLayoutProps) {
  const fetchAccounts = useSocialAccountsStore((s) => s.fetchAccounts)

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  return (
    <ProductShell context={shellContext} headerActions={<SocialHeaderActions />}>
      {children}
    </ProductShell>
  )
}
