"use client"

import { useRef, useState } from "react"
import { useDrag } from "react-dnd"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import { POST_STATUS_CONFIG } from "@/lib/social/constants"
import { format, isPast } from "date-fns"
import { CalendarPostDetailsPopover } from "./CalendarPostDetailsPopover"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import type { SocialPost } from "@/lib/social/client"
import type { SocialPlatform, SocialPostStatus } from "@/lib/db/schema"

interface CalendarPostCardProps {
  post: SocialPost
  platform?: SocialPlatform
}

export const POST_DND_TYPE = "social-post"

export function CalendarPostCard({ post, platform }: CalendarPostCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const fetchPosts = useSocialCalendarStore((s) => s.fetchPosts)
  const accounts = useSocialAccountsStore((s) => s.accounts)
  const account = accounts.find((item) => item.id === post.socialAccountId)
  const resolvedPlatform = (platform ?? account?.platform ?? "linkedin") as SocialPlatform
  const channelName = account?.displayName ?? "Unknown channel"
  const statusConfig = POST_STATUS_CONFIG[post.status as SocialPostStatus]
  const postTime = post.scheduledAt || post.publishedAt || post.createdAt
  const isInPast = postTime ? isPast(new Date(postTime)) : false
  const initials = channelName
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const [{ isDragging }, dragRef] = useDrag(() => ({
    type: POST_DND_TYPE,
    item: {
      postId: post.id,
      status: post.status,
      scheduledAt: post.scheduledAt,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [post])

  function attachRef(element: HTMLDivElement | null) {
    cardRef.current = element
    dragRef(element)
  }

  return (
    <>
      <div
        ref={attachRef}
        onClick={(event) => {
          event.stopPropagation()
          setShowDetails(true)
        }}
        className={`group cursor-grab rounded border bg-card text-[10px] transition-all active:cursor-grabbing ${statusConfig?.borderColor ?? "border-border"} ${
          isDragging ? "opacity-30" : ""
        } ${isInPast ? "opacity-60 grayscale" : ""}`}
      >
        <div className={`h-0.5 rounded-t ${statusConfig?.bgColor ?? "bg-muted"}`} />
        <div className="flex items-start gap-1.5 px-1.5 py-1">
          <div className="relative size-[18px] flex-shrink-0">
            {account?.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt={channelName}
                className="size-[18px] rounded-full object-cover"
              />
            ) : (
              <div className="flex size-[18px] items-center justify-center rounded-full bg-muted text-[7px] font-medium text-muted-foreground">
                {initials}
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border border-border bg-background shadow-sm">
              <PlatformIcon platform={resolvedPlatform} size={9} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-medium" title={channelName}>
                {channelName}
              </span>
              {postTime && (
                <span className="flex-shrink-0 text-muted-foreground">
                  {format(new Date(postTime), "HH:mm")}
                </span>
              )}
            </div>
            <div className="truncate text-muted-foreground">
              {post.status === "draft" && (
                <span className="me-1">Draft:</span>
              )}
              {post.content?.slice(0, 48) || "No content"}
            </div>
          </div>
          {!account && (
            <span className="sr-only">
              Destination channel information is unavailable.
            </span>
          )}
        </div>
      </div>
      <CalendarPostDetailsPopover
        post={post}
        anchor={cardRef.current}
        open={showDetails}
        onClose={() => setShowDetails(false)}
        onMutate={fetchPosts}
      />
    </>
  )
}
