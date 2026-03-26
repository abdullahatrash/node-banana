"use client"

import { useState } from "react"
import type { SocialAccount } from "@/lib/social/client"
import {
  connectSocialAccount,
  disconnectSocialAccount,
} from "@/lib/social/client"
import { PlatformIcon } from "./shared/PlatformIcon"
import { PLATFORM_LABELS } from "@/lib/social/constants"
import { useToast } from "@/components/Toast"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { SocialPlatform } from "@/lib/db/schema"

interface ChannelCardProps {
  account: SocialAccount
}

export function ChannelCard({ account }: ChannelCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const { show: showToast } = useToast()
  const removeAccount = useSocialAccountsStore((s) => s.removeAccount)

  const initials = account.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  async function handleDisconnect() {
    setIsDisconnecting(true)
    try {
      await disconnectSocialAccount(account.id)
      removeAccount(account.id)
      showToast(`${account.displayName} disconnected`, "success")
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to disconnect",
        "error",
      )
    } finally {
      setIsDisconnecting(false)
      setShowConfirm(false)
    }
  }

  async function handleReconnect() {
    setIsReconnecting(true)
    try {
      const { authUrl } = await connectSocialAccount(account.platform)
      window.location.href = authUrl
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to reconnect",
        "error",
      )
      setIsReconnecting(false)
    }
  }

  return (
    <Card className={account.requiresReauth ? "border-destructive/30" : ""}>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-3">
        <Avatar className="size-10 rounded-lg">
          {account.avatarUrl && <AvatarImage src={account.avatarUrl} alt={account.displayName} />}
          <AvatarFallback className="rounded-lg">
            <PlatformIcon platform={account.platform as SocialPlatform} size={20} />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{account.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {PLATFORM_LABELS[account.platform as SocialPlatform] ?? account.platform}
            {account.username ? ` · @${account.username}` : ""}
          </p>
        </div>
        <Badge
          variant={account.requiresReauth ? "destructive" : "secondary"}
          className="text-[10px]"
        >
          {account.requiresReauth ? "Re-auth needed" : account.disabled ? "Disabled" : "Connected"}
        </Badge>
      </CardHeader>

      <CardFooter className="gap-2 pt-0">
        {account.requiresReauth ? (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-amber-800 text-amber-400 hover:bg-amber-950"
            onClick={handleReconnect}
            disabled={isReconnecting}
          >
            {isReconnecting ? "Reconnecting..." : "Reconnect"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="flex-1">
            Settings
          </Button>
        )}

        {showConfirm ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? "Removing..." : "Confirm"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowConfirm(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setShowConfirm(true)}
          >
            Disconnect
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
