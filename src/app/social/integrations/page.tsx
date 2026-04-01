"use client"

import { useRef, useState } from "react"
import { listSocialAccounts, listSocialProviders } from "@/lib/social/client"
import type { SocialAccount } from "@/lib/social/client"
import type { ProviderCapabilities } from "@/lib/social/provider-interface"
import { Loader2Icon } from "lucide-react"

export default function SocialIntegrationsPage() {
  const [providers, setProviders] = useState<ProviderCapabilities[]>([])
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const initialized = useRef(false)

  if (!initialized.current) {
    initialized.current = true
    Promise.all([listSocialProviders(), listSocialAccounts()])
      .then(([loadedProviders, loadedAccounts]) => {
        setProviders(loadedProviders)
        setAccounts(loadedAccounts)
      })
      .finally(() => setIsLoading(false))
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <h2 className="text-lg font-semibold">Integrations</h2>
      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-medium">Connected channels</div>
        <div className="mt-2 text-sm text-muted-foreground">{accounts.length}</div>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-medium">Available providers</div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
          {providers.map((provider) => (
            <div key={provider.identifier} className="rounded-md bg-muted px-3 py-2 text-xs">
              {provider.displayName}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
