"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { format } from "date-fns"
import { PostStatusBadge } from "./PostStatusBadge"
import { Button } from "@/components/ui/button"
import {
  deleteSocialPost,
  retrySocialPost,
} from "@/lib/social/client"
import { useToast } from "@/components/Toast"
import type { SocialPost } from "@/lib/social/client"
import type { SocialPostStatus } from "@/lib/db/schema"

interface PostRowProps {
  post: SocialPost
  onMutate: () => void
}

export function PostRow({ post, onMutate }: PostRowProps) {
  const router = useRouter()
  const { show: showToast } = useToast()
  const [showError, setShowError] = useState(false)
  const [isActing, setIsActing] = useState(false)

  const time = post.scheduledAt || post.publishedAt || post.createdAt

  async function handleRetry() {
    setIsActing(true)
    try {
      await retrySocialPost(post.id)
      showToast("Post re-queued", "success")
      onMutate()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Retry failed",
        "error",
      )
    } finally {
      setIsActing(false)
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this post?")) return
    setIsActing(true)
    try {
      await deleteSocialPost(post.id)
      showToast("Post deleted", "success")
      onMutate()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Delete failed",
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
            {post.content?.slice(0, 100) || "No content"}
          </p>
          {post.mediaUrls && post.mediaUrls.length > 0 && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {post.mediaUrls.length} media attached
            </p>
          )}
        </div>

        {/* Status */}
        <PostStatusBadge status={post.status as SocialPostStatus} />

        {/* Time */}
        {time && (
          <span className="flex-shrink-0 text-xs text-muted-foreground">
            {format(new Date(time), "MMM d, HH:mm")}
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1">
          {post.status === "draft" && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => router.push(`/social/compose/${post.id}`)}
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
            >
              <ExternalLinkIcon className="size-3.5" />
            </Button>
          )}
          {(post.status === "draft" || post.status === "failed") && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              disabled={isActing}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          )}
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
            {showError ? "Hide error" : "Show error"}
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
