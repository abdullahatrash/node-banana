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
import {
  createSocialPost,
  updateSocialPost,
  publishSocialPost,
} from "@/lib/social/client"
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
    postId,
    isDirty,
    reset,
  } = useSocialComposerStore()

  const hasContent = content.trim().length > 0 || mediaUrls.length > 0
  const hasChannels = selectedAccountIds.length > 0
  const canPublish = hasContent && hasChannels
  const canSchedule = canPublish && scheduledAt && scheduledAt > new Date()

  async function handleSaveDraft() {
    if (!hasContent || !hasChannels) return
    setIsSubmitting("draft")
    try {
      // Create one draft per selected account
      for (const accountId of selectedAccountIds) {
        if (postId) {
          await updateSocialPost(postId, {
            content,
            mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
            scheduledAt: scheduledAt?.toISOString(),
          })
        } else {
          await createSocialPost({
            socialAccountId: accountId,
            content,
            mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
            scheduledAt: scheduledAt?.toISOString(),
          })
        }
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

  async function handleSchedule() {
    if (!canSchedule) return
    setIsSubmitting("schedule")
    try {
      for (const accountId of selectedAccountIds) {
        const post = await createSocialPost({
          socialAccountId: accountId,
          content,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          scheduledAt: scheduledAt!.toISOString(),
        })
        await publishSocialPost(post.id)
      }
      showToast("Post scheduled", "success")
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
    setIsSubmitting("publish")
    try {
      for (const accountId of selectedAccountIds) {
        const post = await createSocialPost({
          socialAccountId: accountId,
          content,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        })
        await publishSocialPost(post.id)
      }
      showToast("Publishing...", "success")
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
          <PostEditor />
          <MediaAttachments onOpenMediaPool={() => setMediaPoolOpen(true)} />
          <MediaPool open={mediaPoolOpen} onOpenChange={setMediaPoolOpen} />
          <SchedulePicker />
        </div>

        {/* Right: live preview panel */}
        <div className="hidden w-[340px] border-l bg-muted/30 lg:flex lg:flex-col">
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
