"use client"

import { useState } from "react"
import type { SocialAccount } from "@/lib/social/client"
import {
  connectSocialAccount,
  disconnectSocialAccount,
  updateSocialAccount,
} from "@/lib/social/client"
import { PlatformIcon } from "./shared/PlatformIcon"
import { PLATFORM_LABELS } from "@/lib/social/constants"
import { useToast } from "@/components/Toast"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SocialPlatform } from "@/lib/db/schema"

interface ChannelCardProps {
  account: SocialAccount
}

export function ChannelCard({ account }: ChannelCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [displayName, setDisplayName] = useState(account.displayName)
  const [postingTimes, setPostingTimes] = useState(
    Array.isArray(account.additionalSettings?.postingTimes)
      ? (account.additionalSettings?.postingTimes as number[]).join(",")
      : "",
  )
  const [customerName, setCustomerName] = useState(
    typeof account.additionalSettings?.customerName === "string"
      ? account.additionalSettings.customerName
      : "",
  )
  const { show: showToast } = useToast()
  const { removeAccount, addOrUpdateAccount } = useSocialAccountsStore((s) => ({
    removeAccount: s.removeAccount,
    addOrUpdateAccount: s.addOrUpdateAccount,
  }))

  async function handleDisconnect() {
    setIsDisconnecting(true)
    try {
      await disconnectSocialAccount(account.id)
      removeAccount(account.id)
      showToast(`${account.displayName} disconnected`, "success")
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("existing posts") &&
        confirm("This channel has linked posts. Force disconnect and remove linked posts?")
      ) {
        try {
          await disconnectSocialAccount(account.id, true)
          removeAccount(account.id)
          showToast(`${account.displayName} force-disconnected`, "success")
          return
        } catch (forceError) {
          showToast(
            forceError instanceof Error
              ? forceError.message
              : "Force disconnect failed",
            "error",
          )
          return
        }
      }
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
      const { authUrl } = await connectSocialAccount(account.platform, account.id)
      window.location.href = authUrl
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to reconnect",
        "error",
      )
      setIsReconnecting(false)
    }
  }

  async function handleToggleDisabled() {
    setIsSaving(true)
    try {
      const updated = await updateSocialAccount(account.id, {
        disabled: !account.disabled,
      })
      addOrUpdateAccount(updated)
      showToast(
        updated.disabled ? "Channel disabled" : "Channel enabled",
        "success",
      )
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to update channel",
        "error",
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveSettings() {
    setIsSaving(true)
    try {
      const parsedTimes = postingTimes
        .split(",")
        .map((v) => Number.parseInt(v.trim(), 10))
        .filter((v) => Number.isInteger(v) && v >= 0 && v <= 23)
      const mergedSettings = {
        ...(account.additionalSettings || {}),
        postingTimes: parsedTimes,
        customerName: customerName.trim() || null,
      }
      const updated = await updateSocialAccount(account.id, {
        displayName: displayName.trim(),
        additionalSettings: mergedSettings,
      })
      addOrUpdateAccount(updated)
      showToast("Channel settings updated", "success")
      setShowSettings(false)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to save settings",
        "error",
      )
    } finally {
      setIsSaving(false)
    }
  }

  function handleCopyId() {
    navigator.clipboard
      .writeText(account.id)
      .then(() => showToast("Channel ID copied", "success"))
      .catch(() => showToast("Failed to copy channel ID", "error"))
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
        <Button size="sm" variant="outline" className="flex-1" render={<a href={`/social/compose?accountId=${account.id}`} />} nativeButton={false}>
          Create Post
        </Button>

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
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => setShowSettings(true)}
          >
            Settings
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="text-xs"
          onClick={handleCopyId}
        >
          Copy ID
        </Button>

        {!account.requiresReauth && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            onClick={handleToggleDisabled}
            disabled={isSaving}
          >
            {account.disabled ? "Enable" : "Disable"}
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

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Channel settings</DialogTitle>
            <DialogDescription>
              Update display name and channel-specific scheduling metadata.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Display name</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Channel name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Posting times (0-23, comma separated)</Label>
              <Input
                value={postingTimes}
                onChange={(e) => setPostingTimes(e.target.value)}
                placeholder="9,12,18"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Customer/Group name</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Acme Social Team"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSettings(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveSettings} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
