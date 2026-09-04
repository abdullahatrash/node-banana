"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { PostStatusBadge } from "./PostStatusBadge"
import { Button } from "@/components/ui/button"
import {
  createSocialPost,
  deleteSocialPost,
  retrySocialPost,
} from "@/lib/social/client"
import { useToast } from "@/components/Toast"
import type { SocialPost } from "@/lib/social/client"
import type { SocialPostStatus } from "@/lib/db/schema"
import { useFormatter, useTranslations } from "next-intl"

interface PostRowProps {
  post: SocialPost
  onMutate: () => void
}

export function PostRow({ post, onMutate }: PostRowProps) {
  const t = useTranslations("social.posts")
  const format = useFormatter()
  const router = useRouter()
  const { show: showToast } = useToast()
  const [showError, setShowError] = useState(false)
  const [isActing, setIsActing] = useState(false)

  const time = post.scheduledAt || post.publishedAt || post.createdAt
  const isWaitingForScheduledPublish =
    post.status === "publishing" &&
    post.scheduledAt !== null &&
    post.scheduledAt !== undefined &&
    new Date(post.scheduledAt).getTime() > Date.now()

  async function handleRetry() {
    setIsActing(true)
    try {
      await retrySocialPost(post.id)
      showToast(t("toast.requeued"), "success")
      onMutate()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("errors.retry"),
        "error",
      )
    } finally {
      setIsActing(false)
    }
  }

  async function handleDelete() {
    if (!confirm(t("confirmDelete"))) return
    setIsActing(true)
    try {
      await deleteSocialPost(post.id)
      showToast(t("toast.deleted"), "success")
      onMutate()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("errors.delete"),
        "error",
      )
    } finally {
      setIsActing(false)
    }
  }

  async function handleDuplicate() {
    setIsActing(true)
    try {
      const duplicated = await createSocialPost({
        socialAccountId: post.socialAccountId,
        content: post.content ?? undefined,
        mediaUrls: (post.mediaUrls as Array<{ type: string; url: string; alt?: string }>) ?? undefined,
        mediaReferences: post.stableMediaRefs?.map((reference) => ({ resourceKind: reference.resourceKind ?? "studio_asset", id: reference.assetId, digest: reference.assetDigest })),
      })
      showToast(t("toast.duplicated"), "success")
      router.push(`/social/compose?postId=${duplicated.id}`)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("errors.duplicate"),
        "error",
      )
    } finally {
      setIsActing(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3">
        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            {post.content?.slice(0, 100) || t("noContent")}
          </p>
          {post.mediaUrls && post.mediaUrls.length > 0 && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {t("mediaAttached", { count: post.mediaUrls.length })}
            </p>
          )}
        </div>

        {/* Status */}
        <PostStatusBadge
          status={
            isWaitingForScheduledPublish
              ? "queued"
              : (post.status as SocialPostStatus)
          }
          label={isWaitingForScheduledPublish ? t("scheduled") : undefined}
        />

        {/* Time */}
        {time && (
          <span className="flex-shrink-0 text-xs text-muted-foreground">
            <bdi>{format.dateTime(new Date(time), { dateStyle: "medium", timeStyle: "short" })}</bdi>
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1">
          {post.status === "draft" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => router.push(`/social/compose?postId=${post.id}`)}
              aria-label={t("actions.edit")}
            >
              <PencilIcon className="size-3.5" />
            </Button>
          )}
          {post.status === "failed" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive"
              onClick={handleRetry}
              disabled={isActing}
              aria-label={t("actions.retry")}
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
          )}
          {post.status === "published" && post.platformPostUrl && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              render={<a href={post.platformPostUrl} target="_blank" rel="noopener" />}
              nativeButton={false}
              aria-label={t("actions.openPublished")}
            >
              <ExternalLinkIcon className="size-3.5" />
            </Button>
          )}
          {post.status !== "published" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              disabled={isActing}
              aria-label={t("actions.delete")}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleDuplicate}
            disabled={isActing}
            aria-label={t("actions.duplicate")}
          >
            <CopyIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Expandable error */}
      {post.status === "failed" && post.errorMessage && (
        <div className="border-t">
          <button
            onClick={() => setShowError(!showError)}
            className="flex w-full items-center gap-1 px-3 py-1.5 text-[10px] text-destructive hover:bg-accent/50"
          >
            <ChevronDownIcon
              className={`size-3 transition-transform ${showError ? "rotate-180" : ""}`}
            />
            {showError ? t("hideError") : t("showError")}
          </button>
          {showError && (
            <div className="px-3 pb-2 text-[10px] text-destructive/80">
              {post.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
