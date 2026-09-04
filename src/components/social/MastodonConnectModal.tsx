"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/Toast"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"

const POPULAR_INSTANCES = ["mastodon.social", "fosstodon.org", "hachyderm.io"]

interface MastodonConnectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MastodonConnectModal({
  open,
  onOpenChange,
}: MastodonConnectModalProps) {
  const t = useTranslations("social.channels.connect")
  const [instanceUrl, setInstanceUrl] = useState("")
  const [isConnecting, setIsConnecting] = useState(false)
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
      if (event.data?.type !== "social-oauth-complete") return

      cleanupPopup()
      setIsConnecting(false)

      if (event.data.success) {
        showToast(
          event.data.message || t("mastodon.connected"),
          "success",
        )
        fetchAccounts()
        onOpenChange(false)
        setInstanceUrl("")
      } else {
        showToast(
          event.data.message || t("errors.complete"),
          "error",
        )
      }
    }

    window.addEventListener("message", handleOAuthMessage)
    return () => {
      window.removeEventListener("message", handleOAuthMessage)
      cleanupPopup()
    }
  }, [cleanupPopup, fetchAccounts, onOpenChange, showToast, t])

  async function handleSubmit(url: string) {
    const instance = url.trim()
    if (!instance) {
      showToast(t("mastodon.required"), "error")
      return
    }

    setIsConnecting(true)
    const width = 760
    const height = 760
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)
    const popup = window.open(
      "about:blank",
      "connect-mastodon",
      `width=${width},height=${height},left=${left},top=${top}`,
    )
    popupRef.current = popup

    try {
      const response = await fetch("/api/social/accounts/connect-mastodon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceUrl: instance }),
      })

      const data = await response.json()

      if (!response.ok || !data.success || !data.authUrl) {
        throw new Error(data.error || t("mastodon.errors.start"))
      }

      if (!popup || popup.closed) {
        window.location.href = data.authUrl
        return
      }

      popup.location.href = data.authUrl
      popup.focus()
      popupCheckRef.current = window.setInterval(() => {
        if (!popup.closed) return
        cleanupPopup()
        setIsConnecting(false)
      }, 500)
    } catch (error) {
      popup?.close()
      cleanupPopup()
      showToast(
        error instanceof Error ? error.message : t("errors.connect"),
        "error",
      )
      setIsConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("mastodon.title")}</DialogTitle>
          <DialogDescription>
            {t("mastodon.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex gap-2">
            {POPULAR_INSTANCES.map((instance) => (
              <Button
                key={instance}
                variant="outline"
                size="sm"
                disabled={isConnecting}
                onClick={() => handleSubmit(instance)}
                className="text-xs"
              >
                <bdi>{instance}</bdi>
              </Button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSubmit(instanceUrl)
            }}
            className="flex gap-2"
          >
            <Input
              dir="ltr"
              placeholder={t("mastodon.instancePlaceholder")}
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              disabled={isConnecting}
            />
            <Button type="submit" disabled={isConnecting} className="shrink-0">
              {isConnecting ? t("connecting") : t("action")}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
