"use client"

import { useDrag } from "react-dnd"
import { useRouter } from "next/navigation"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import { POST_STATUS_CONFIG } from "@/lib/social/constants"
import { format, isPast } from "date-fns"
import type { SocialPost } from "@/lib/social/client"
import type { SocialPlatform, SocialPostStatus } from "@/lib/db/schema"

interface CalendarPostCardProps {
  post: SocialPost
  platform?: SocialPlatform
}

export const POST_DND_TYPE = "social-post"

export function CalendarPostCard({ post, platform }: CalendarPostCardProps) {
  const router = useRouter()
  const statusConfig = POST_STATUS_CONFIG[post.status as SocialPostStatus]
  const postTime = post.scheduledAt || post.publishedAt || post.createdAt
  const isInPast = postTime ? isPast(new Date(postTime)) : false

  const [{ isDragging }, dragRef] = useDrag(() => ({
    type: POST_DND_TYPE,
    item: { postId: post.id, status: post.status },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }))

  return (
    <div
      ref={dragRef as unknown as React.Ref<HTMLDivElement>}
      onClick={() => {
        if (post.status === "draft") {
          router.push(`/social/compose/${post.id}`)
        }
      }}
      className={`group cursor-grab rounded border text-[10px] transition-all active:cursor-grabbing ${statusConfig?.borderColor ?? "border-border"} ${
        isDragging ? "opacity-30" : ""
      } ${isInPast ? "opacity-60 grayscale" : ""} ${
        post.status === "draft" ? "cursor-pointer" : ""
      }`}
    >
      {/* Status strip */}
      <div className={`h-0.5 rounded-t ${statusConfig?.bgColor ?? "bg-muted"}`} />
      {/* Body */}
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        {platform && <PlatformIcon platform={platform} size={10} />}
        <span className="flex-1 truncate">
          {post.status === "draft" && (
            <span className="me-1 text-muted-foreground">Draft:</span>
          )}
          {post.content?.slice(0, 40) || "No content"}
        </span>
        {postTime && (
          <span className="flex-shrink-0 text-muted-foreground">
            {format(new Date(postTime), "HH:mm")}
          </span>
        )}
      </div>
    </div>
  )
}
