"use client"

import { useState } from "react"
import type { ProviderCapabilities } from "@/lib/social/provider-interface"
import {
  connectSocialAccount,
  listSocialProviders,
} from "@/lib/social/client"
import { PlatformIcon } from "./shared/PlatformIcon"
import { PLATFORM_LABELS } from "@/lib/social/constants"
import { useToast } from "@/components/Toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SocialPlatform } from "@/lib/db/schema"

// Module-level cache — fetched once, reused across all PlatformPicker renders
let providerCache: ProviderCapabilities[] | null = null

function getProviders(): Promise<ProviderCapabilities[]> {
  if (providerCache) return Promise.resolve(providerCache)
  return listSocialProviders().then((data) => {
    providerCache = data
    return data
  })
}

interface PlatformPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PlatformPicker({ open, onOpenChange }: PlatformPickerProps) {
  const [providers, setProviders] = useState<ProviderCapabilities[]>(
    providerCache ?? [],
  )
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null)
  const { show: showToast } = useToast()

  // Fetch on open if not cached — triggered by state check, not useEffect
  if (open && providers.length === 0 && !providerCache) {
    getProviders()
      .then(setProviders)
      .catch(() => showToast("Failed to load providers", "error"))
  }

  async function handleConnect(platform: string) {
    setConnectingPlatform(platform)
    try {
      const { authUrl } = await connectSocialAccount(platform)
      window.location.href = authUrl
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to connect",
        "error",
      )
      setConnectingPlatform(null)
    }
  }

  const platforms: Array<{ identifier: SocialPlatform; name: string }> =
    providers.length > 0
      ? providers.map((p) => ({
          identifier: p.identifier,
          name: p.displayName,
        }))
      : (
          ["linkedin", "instagram", "x", "tiktok", "facebook", "youtube"] as const
        ).map((id) => ({ identifier: id, name: PLATFORM_LABELS[id] }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a channel</DialogTitle>
          <DialogDescription>
            Select the platform you want to link
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 pt-2">
          {platforms.map((platform) => {
            const isConnecting = connectingPlatform === platform.identifier
            return (
              <button
                key={platform.identifier}
                onClick={() => handleConnect(platform.identifier)}
                disabled={!!connectingPlatform}
                className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <PlatformIcon platform={platform.identifier} size={20} />
                </div>
                <span className="text-xs font-medium">
                  {isConnecting ? "Connecting..." : platform.name}
                </span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
