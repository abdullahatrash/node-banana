"use client"

import { useDrop } from "react-dnd"
import { useRouter } from "next/navigation"
import { isPast } from "date-fns"
import { POST_DND_TYPE, CalendarPostCard } from "./CalendarPostCard"
import { rescheduleSocialPost } from "@/lib/social/client"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { useToast } from "@/components/Toast"
import type { SocialPost } from "@/lib/social/client"

interface CalendarColumnProps {
  date: Date
  hour: number
  minute?: number
  posts: SocialPost[]
}

interface CalendarDragItem {
  postId: string
  status: string
  scheduledAt?: string | null
  publishedAt?: string | null
  createdAt?: string | null
}

function canRescheduleItem(item: CalendarDragItem, isInPast: boolean) {
  if (isInPast || item.status === "published") return false
  if (item.status !== "publishing") return true
  return item.scheduledAt ? new Date(item.scheduledAt).getTime() > Date.now() : false
}

export function CalendarColumn({ date, hour, minute = 0, posts }: CalendarColumnProps) {
  const router = useRouter()
  const { show: showToast } = useToast()
  const applyOptimisticReschedule = useSocialCalendarStore((s) => s.applyOptimisticReschedule)
  const restorePosts = useSocialCalendarStore((s) => s.restorePosts)
  const replacePost = useSocialCalendarStore((s) => s.replacePost)

  const slotTime = new Date(date)
  slotTime.setHours(hour, minute, 0, 0)
  const isInPast = isPast(slotTime)

  const [{ isOver, canDrop }, dropRef] = useDrop(() => ({
    accept: POST_DND_TYPE,
    canDrop: (item: CalendarDragItem) => canRescheduleItem(item, isInPast),
    drop: async (item: CalendarDragItem) => {
      if (isInPast) return

      if (!canRescheduleItem(item, isInPast)) {
        showToast("This post cannot be rescheduled.", "warning")
        return
      }

      const scheduledAt = slotTime.toISOString()
      const previousPosts = applyOptimisticReschedule(item.postId, scheduledAt)

      try {
        const updatedPost = await rescheduleSocialPost(item.postId, scheduledAt)
        replacePost(updatedPost)
        showToast("Post rescheduled", "success")
      } catch (error) {
        if (previousPosts) restorePosts(previousPosts)
        showToast(
          error instanceof Error ? error.message : "Failed to reschedule",
          "error",
        )
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }))

  function handleClickSlot() {
    if (isInPast) return
    router.push(`/social/compose?date=${slotTime.toISOString()}`)
  }

  return (
    <div
      ref={dropRef as unknown as React.Ref<HTMLDivElement>}
      onClick={posts.length === 0 ? handleClickSlot : undefined}
      className={`min-h-[28px] border-b border-e p-0.5 transition-colors ${
        isInPast
          ? "cursor-not-allowed bg-muted/30"
          : posts.length === 0
            ? "cursor-pointer hover:bg-accent/30"
            : ""
      } ${isOver && canDrop ? "bg-purple-500/10 ring-1 ring-inset ring-purple-500/40" : ""} ${
        isOver && !canDrop ? "bg-destructive/5" : ""
      }`}
    >
      {posts.map((post) => (
        <CalendarPostCard key={post.id} post={post} />
      ))}
    </div>
  )
}
