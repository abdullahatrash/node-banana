"use client"

import { useState } from "react"
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
import { useClientErrorPresentation } from "@/hooks/use-client-error-presentation"

interface BlueskyConnectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BlueskyConnectModal({
  open,
  onOpenChange,
}: BlueskyConnectModalProps) {
  const t = useTranslations("social.channels.connect")
  const [handle, setHandle] = useState("")
  const [appPassword, setAppPassword] = useState("")
  const [isConnecting, setIsConnecting] = useState(false)
  const { show: showToast } = useToast()
  const { show: showClientError } = useClientErrorPresentation()
  const { fetchAccounts } = useSocialAccountsStore()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!handle.trim() || !appPassword.trim()) {
      showToast(t("bluesky.required"), "error")
      return
    }

    setIsConnecting(true)
    try {
      const response = await fetch("/api/social/accounts/connect-bluesky", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim(),
          appPassword: appPassword.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error("BLUESKY_CONNECT_FAILED")
      }

      showToast(t("bluesky.connected"), "success")
      fetchAccounts()
      onOpenChange(false)
      setHandle("")
      setAppPassword("")
    } catch (error) {
      showClientError(showToast, error, t("bluesky.errors.connect"))
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("bluesky.title")}</DialogTitle>
          <DialogDescription>
            {t("bluesky.descriptionPrefix")}{" "}
            <a
              href="https://bsky.app/settings/app-passwords"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 underline"
            >
              {t("bluesky.appPasswordLink")}
            </a>
            .
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="bluesky-handle"
              className="text-[11px] font-medium text-muted-foreground"
            >
              {t("bluesky.handle")}
            </label>
            <Input
              id="bluesky-handle"
              dir="ltr"
              placeholder={t("bluesky.handlePlaceholder")}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={isConnecting}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="bluesky-password"
              className="text-[11px] font-medium text-muted-foreground"
            >
              {t("bluesky.appPassword")}
            </label>
            <Input
              id="bluesky-password"
              type="password"
              dir="ltr"
              placeholder={t("bluesky.passwordPlaceholder")}
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              disabled={isConnecting}
            />
          </div>
          <Button type="submit" disabled={isConnecting}>
            {isConnecting ? t("connecting") : t("action")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
