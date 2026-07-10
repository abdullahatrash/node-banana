"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ProviderCapabilities } from "@/lib/social/provider-interface"
import {
  connectSocialAccount,
  listSocialProviders,
} from "@/lib/social/client"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { PlatformIcon } from "./shared/PlatformIcon"
import { PLATFORM_LABELS } from "@/lib/social/constants"
import { useToast } from "@/components/Toast"
import { BlueskyConnectModal } from "./BlueskyConnectModal"
import { MastodonConnectModal } from "./MastodonConnectModal"
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

interface SocialOAuthCompleteMessage {
  type: "social-oauth-complete"
  success: boolean
  message: string
}

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
  const [blueskyModalOpen, setBlueskyModalOpen] = useState(false)
  const [mastodonModalOpen, setMastodonModalOpen] = useState(false)
  const popupRef = useRef<Window | null>(null)
  const popupCheckRef = useRef<number | null>(null)
  const { show: showToast } = useToast()
  const { fetchAccounts } = useSocialAccountsStore()

  const cleanupPopup = useCallback(() => {
    if (popupCheckRef.current) {
      window.clearInterval(popupCheckRef.current)
      popupCheckRef.current = null
    }
    popupRef.current = null
  }, [])

  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const data = event.data as Partial<SocialOAuthCompleteMessage>
      if (data.type !== "social-oauth-complete") return

      cleanupPopup()
      setConnectingPlatform(null)

      if (data.success) {
        showToast(data.message || "Channel connected successfully!", "success")
        fetchAccounts()
        onOpenChange(false)
      } else {
        showToast(data.message || "Failed to complete connection", "error")
      }
    }

    window.addEventListener("message", handleOAuthMessage)
    return () => {
      window.removeEventListener("message", handleOAuthMessage)
      cleanupPopup()
    }
  }, [cleanupPopup, fetchAccounts, onOpenChange, showToast])

  useEffect(() => {
    if (!open || providers.length > 0 || providerCache) return

    let cancelled = false
    getProviders()
      .then((data) => {
        if (!cancelled) setProviders(data)
      })
      .catch(() => {
        if (!cancelled) showToast("Failed to load providers", "error")
      })

    return () => {
      cancelled = true
    }
  }, [open, providers.length, showToast])

  async function handleConnect(platform: string, configured: boolean) {
    if (!configured) return

    if (platform === "bluesky") {
      setBlueskyModalOpen(true)
      return
    }
    if (platform === "mastodon") {
      setMastodonModalOpen(true)
      return
    }

    setConnectingPlatform(platform)
    const width = 760
    const height = 760
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)
    const popup = window.open(
      "about:blank",
      `connect-${platform}`,
      `width=${width},height=${height},left=${left},top=${top}`,
    )
    popupRef.current = popup

    try {
      const { authUrl } = await connectSocialAccount(platform)
      if (!popup || popup.closed) {
        window.location.href = authUrl
        return
      }

      popup.location.href = authUrl
      popup.focus()
      popupCheckRef.current = window.setInterval(() => {
        if (!popup.closed) return
        cleanupPopup()
        setConnectingPlatform(null)
      }, 500)
    } catch (error) {
      popup?.close()
      cleanupPopup()
      showToast(
        error instanceof Error ? error.message : "Failed to connect",
        "error",
      )
      setConnectingPlatform(null)
    }
  }

  const platforms: Array<{
    identifier: SocialPlatform
    name: string
    configured: boolean
  }> =
    providers.length > 0
      ? providers.map((p) => ({
          identifier: p.identifier,
          name: p.displayName,
          // Non-standard-OAuth platforms (bluesky, mastodon) and any
          // provider that doesn't report a status default to connectable.
          configured: p.configured !== false,
        }))
      : (
          ["linkedin", "instagram", "x", "tiktok", "facebook", "youtube"] as const
        ).map((id) => ({ identifier: id, name: PLATFORM_LABELS[id], configured: true }))

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
                onClick={() => handleConnect(platform.identifier, platform.configured)}
                disabled={!platform.configured || !!connectingPlatform}
                title={
                  platform.configured
                    ? undefined
                    : `${platform.name} is not configured on this server. Contact your administrator to enable it.`
                }
                className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <PlatformIcon platform={platform.identifier} size={20} />
                </div>
                <span className="text-xs font-medium">
                  {isConnecting ? "Connecting..." : platform.name}
                </span>
                {!platform.configured && (
                  <span className="text-[10px] leading-none text-muted-foreground">
                    Not configured
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </DialogContent>
      <BlueskyConnectModal
        open={blueskyModalOpen}
        onOpenChange={(v) => {
          setBlueskyModalOpen(v)
          if (!v) fetchAccounts()
        }}
      />
      <MastodonConnectModal
        open={mastodonModalOpen}
        onOpenChange={(v) => {
          setMastodonModalOpen(v)
          if (!v) fetchAccounts()
        }}
      />
    </Dialog>
  )
}
