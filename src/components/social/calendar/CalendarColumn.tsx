"use client"

import { useDrop } from "react-dnd"
import { useRouter } from "next/navigation"
import { isPast } from "date-fns"
import { POST_DND_TYPE, CalendarPostCard } from "./CalendarPostCard"
import { updateSocialPost } from "@/lib/social/client"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { useToast } from "@/components/Toast"
import type { SocialPost } from "@/lib/social/client"

interface CalendarColumnProps {
  date: Date
  hour: number
  posts: SocialPost[]
}

export function CalendarColumn({ date, hour, posts }: CalendarColumnProps) {
  const router = useRouter()
  const { show: showToast } = useToast()
  const fetchPosts = useSocialCalendarStore((s) => s.fetchPosts)

  const slotTime = new Date(date)
  slotTime.setHours(hour, 0, 0, 0)
  const isInPast = isPast(slotTime)

  const [{ isOver, canDrop }, dropRef] = useDrop(() => ({
    accept: POST_DND_TYPE,
    canDrop: (item: { postId: string; status: string }) =>
      !isInPast && item.status !== "published" && item.status !== "publishing",
    drop: async (item: { postId: string; status: string }) => {
      if (isInPast) return

      if (item.status === "published" || item.status === "publishing") {
        showToast("Published posts cannot be rescheduled.", "warning")
        return
      }

      if (item.status === "queued") {
        if (!confirm("Reschedule this post to the new time?")) return
      }

      try {
        await updateSocialPost(item.postId, {
          scheduledAt: slotTime.toISOString(),
        })
        await fetchPosts()
        showToast("Post rescheduled", "success")
      } catch (error) {
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
      className={`min-h-[48px] border-b border-e p-0.5 transition-colors ${
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
