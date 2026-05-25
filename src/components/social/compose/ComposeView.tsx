"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  SaveIcon,
  CalendarClockIcon,
  SendIcon,
  Loader2Icon,
} from "lucide-react"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { PlatformSelector } from "./PlatformSelector"
import { PostEditor } from "./PostEditor"
import { PreviewPanel } from "./PreviewPanel"
import { MediaPool } from "./MediaPool"
import { SchedulePicker } from "./SchedulePicker"
import { MediaAttachments } from "./MediaAttachments"
import { PublishingSettingsPanels } from "./PublishingSettingsPanels"
import {
  createSocialPost,
  updateSocialPost,
  publishSocialPost,
} from "@/lib/social/client"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import {
  pickSelectedPublishingSettings,
  validateSelectedPublishingSettings,
} from "@/lib/social/publishing-settings"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/Toast"
import type { SocialPlatform } from "@/lib/db/schema"

export function ComposeView() {
  const router = useRouter()
  const { show: showToast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState<
    "draft" | "schedule" | "publish" | null
  >(null)
  const [mediaPoolOpen, setMediaPoolOpen] = useState(false)

  const {
    content,
    selectedAccountIds,
    mediaUrls,
    scheduledAt,
    platformSettings,
    postId,
    editSourceAccountId,
    isDirty,
    reset,
  } = useSocialComposerStore()
  const accounts = useSocialAccountsStore((state) => state.accounts)

  const hasContent = content.trim().length > 0 || mediaUrls.length > 0
  const hasChannels = selectedAccountIds.length > 0
  const canPublish = hasContent && hasChannels
  const canSchedule = canPublish && scheduledAt && scheduledAt > new Date()
  const sourceAccountId = editSourceAccountId ?? selectedAccountIds[0] ?? null

  function getAccountMaps() {
    const platformByChannelId: Record<string, SocialPlatform> = {}
    const labelByChannelId: Record<string, string> = {}
    for (const account of accounts) {
      platformByChannelId[account.id] = account.platform as SocialPlatform
      labelByChannelId[account.id] = account.displayName
    }
    return { platformByChannelId, labelByChannelId }
  }

  function getPreparedSettings() {
    const { platformByChannelId } = getAccountMaps()
    return pickSelectedPublishingSettings(
      selectedAccountIds,
      platformSettings,
      platformByChannelId,
    )
  }

  function validateBeforePublish() {
    const { platformByChannelId, labelByChannelId } = getAccountMaps()
    return validateSelectedPublishingSettings({
      selectedChannelIds: selectedAccountIds,
      settingsByChannelId: platformSettings,
      platformByChannelId,
      labelByChannelId,
      content,
      media: mediaUrls,
    })
  }

  async function handleSaveDraft() {
    if (!hasContent || !hasChannels) return
    setIsSubmitting("draft")
    try {
      const preparedSettings = getPreparedSettings()

      if (postId) {
        await updateSocialPost(postId, {
          content,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          platformSettings: sourceAccountId
            ? preparedSettings[sourceAccountId]
            : undefined,
          scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
        })
      }

      const extraAccountIds = postId
        ? selectedAccountIds.filter((accountId) => accountId !== sourceAccountId)
        : selectedAccountIds

      for (const accountId of extraAccountIds) {
        await createSocialPost({
          socialAccountId: accountId,
          content,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          platformSettings: preparedSettings[accountId],
          scheduledAt: scheduledAt?.toISOString(),
        })
      }
      showToast("Draft saved", "success")
      reset()
      router.push("/social/posts")
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to save draft",
        "error",
      )
    } finally {
      setIsSubmitting(null)
    }
  }

  async function publishAll(postIds: string[]) {
    const results = await Promise.allSettled(
      postIds.map((id) => publishSocialPost(id)),
    )
    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    )
    if (failed.length === results.length) {
      throw failed[0].reason instanceof Error
        ? failed[0].reason
        : new Error("All publish attempts failed")
    }
    return { total: results.length, failed: failed.length }
  }

  async function handleSchedule() {
    if (!canSchedule) return
    const validation = validateBeforePublish()
    if (!validation.valid) {
      showToast(validation.errors[0] ?? "Publishing settings need attention", "error")
      return
    }
    setIsSubmitting("schedule")
    try {
      const publishQueue: string[] = []
      const preparedSettings = getPreparedSettings()

      if (postId) {
        const updated = await updateSocialPost(postId, {
          content,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          platformSettings: sourceAccountId
            ? preparedSettings[sourceAccountId]
            : undefined,
          scheduledAt: scheduledAt!.toISOString(),
        })
        publishQueue.push(updated.id)
      }

      const extraAccountIds = postId
        ? selectedAccountIds.filter((accountId) => accountId !== sourceAccountId)
        : selectedAccountIds

      for (const accountId of extraAccountIds) {
        const created = await createSocialPost({
          socialAccountId: accountId,
          content,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          platformSettings: preparedSettings[accountId],
          scheduledAt: scheduledAt!.toISOString(),
        })
        publishQueue.push(created.id)
      }

      const { total, failed } = await publishAll(publishQueue)
      if (failed > 0) {
        showToast(
          `Scheduled ${total - failed} of ${total} posts. ${failed} failed.`,
          "error",
        )
      } else {
        showToast("Post scheduled", "success")
      }
      reset()
      router.push("/social/calendar")
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to schedule",
        "error",
      )
    } finally {
      setIsSubmitting(null)
    }
  }

  async function handlePublishNow() {
    if (!canPublish) return
    const validation = validateBeforePublish()
    if (!validation.valid) {
      showToast(validation.errors[0] ?? "Publishing settings need attention", "error")
      return
    }
    setIsSubmitting("publish")
    try {
      const publishQueue: string[] = []
      const preparedSettings = getPreparedSettings()

      if (postId) {
        const updated = await updateSocialPost(postId, {
          content,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          platformSettings: sourceAccountId
            ? preparedSettings[sourceAccountId]
            : undefined,
          scheduledAt: null,
        })
        publishQueue.push(updated.id)
      }

      const extraAccountIds = postId
        ? selectedAccountIds.filter((accountId) => accountId !== sourceAccountId)
        : selectedAccountIds

      for (const accountId of extraAccountIds) {
        const created = await createSocialPost({
          socialAccountId: accountId,
          content,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          platformSettings: preparedSettings[accountId],
        })
        publishQueue.push(created.id)
      }

      const { total, failed } = await publishAll(publishQueue)
      if (failed > 0) {
        showToast(
          `Published ${total - failed} of ${total} posts. ${failed} failed.`,
          "error",
        )
      } else {
        showToast("Publishing...", "success")
      }
      reset()
      router.push("/social/calendar")
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to publish",
        "error",
      )
    } finally {
      setIsSubmitting(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (isDirty && !confirm("Discard unsaved changes?")) return
            reset()
            router.push("/social/calendar")
          }}
        >
          <ArrowLeftIcon className="size-4" />
          Back
        </Button>
        <Separator orientation="vertical" className="h-4" />
        <span className="text-sm font-medium">
          {postId ? "Edit Draft" : "New Post"}
        </span>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: editor */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
          <PlatformSelector />
          <PublishingSettingsPanels />
          <PostEditor />
          <MediaAttachments onOpenMediaPool={() => setMediaPoolOpen(true)} />
          <MediaPool open={mediaPoolOpen} onOpenChange={setMediaPoolOpen} />
          <SchedulePicker />
        </div>

        {/* Right: live preview panel */}
        <div className="hidden w-[340px] border-s bg-muted/30 lg:flex lg:flex-col">
          <PreviewPanel />
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="flex items-center gap-2 border-t px-6 py-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSaveDraft}
          disabled={!hasContent || !hasChannels || !!isSubmitting}
        >
          {isSubmitting === "draft" ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SaveIcon className="size-4" />
          )}
          Save Draft
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={handleSchedule}
          disabled={!canSchedule || !!isSubmitting}
        >
          {isSubmitting === "schedule" ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <CalendarClockIcon className="size-4" />
          )}
          Schedule
        </Button>

        <Button
          size="sm"
          onClick={handlePublishNow}
          disabled={!canPublish || !!isSubmitting}
        >
          {isSubmitting === "publish" ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SendIcon className="size-4" />
          )}
          Publish Now
        </Button>
      </div>
    </div>
  )
}
