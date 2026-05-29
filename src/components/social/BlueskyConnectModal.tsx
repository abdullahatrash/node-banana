"use client"

import { useState } from "react"
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

interface BlueskyConnectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BlueskyConnectModal({
  open,
  onOpenChange,
}: BlueskyConnectModalProps) {
  const [handle, setHandle] = useState("")
  const [appPassword, setAppPassword] = useState("")
  const [isConnecting, setIsConnecting] = useState(false)
  const { show: showToast } = useToast()
  const { fetchAccounts } = useSocialAccountsStore()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!handle.trim() || !appPassword.trim()) {
      showToast("Handle and app password are required.", "error")
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
        throw new Error(data.error || "Failed to connect Bluesky account")
      }

      showToast("Bluesky channel connected!", "success")
      fetchAccounts()
      onOpenChange(false)
      setHandle("")
      setAppPassword("")
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to connect",
        "error",
      )
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Bluesky</DialogTitle>
          <DialogDescription>
            Enter your Bluesky handle and an{" "}
            <a
              href="https://bsky.app/settings/app-passwords"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 underline"
            >
              App Password
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
              Handle
            </label>
            <Input
              id="bluesky-handle"
              placeholder="alice.bsky.social"
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
              App Password
            </label>
            <Input
              id="bluesky-password"
              type="password"
              placeholder="xxxx-xxxx-xxxx-xxxx"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              disabled={isConnecting}
            />
          </div>
          <Button type="submit" disabled={isConnecting}>
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
