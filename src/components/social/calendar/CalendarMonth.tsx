"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { useDrop } from "react-dnd"
import { DndProvider } from "react-dnd"
import { HTML5Backend } from "react-dnd-html5-backend"
import {
  addDays,
  endOfMonth,
  format,
  isSameMonth,
  startOfMonth,
} from "date-fns"
import {
  formatCalendarDayNumber,
  getCalendarWeekEnd,
  getCalendarWeekStart,
  useSocialCalendarStore,
} from "@/store/socialCalendarStore"
import { useDirectionStore } from "@/store/directionStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import type { CalendarItem, CanonicalCalendarBinding } from "@/lib/product-surfaces/calendar-projection"
import { useToast } from "@/components/Toast"
import { CalendarPostCard, POST_DND_TYPE } from "./CalendarPostCard"
import type { SocialPlatform } from "@/lib/db/schema"
import { canonicalCalendarReschedule } from "./canonical-reschedule"

const WEEK_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
const MAX_VISIBLE_POSTS = 3

interface CalendarDragItem {
  postId: string
  status: string
  scheduledAt?: string | null
  publishedAt?: string | null
  createdAt?: string | null
  source: CanonicalCalendarBinding | null
}

function getCalendarDate(post: CalendarItem) {
  return post.scheduledAt || post.publishedAt || post.createdAt
}

function canRescheduleItem(item: CalendarDragItem, targetTime: Date) {
  if (!item.source || item.status === "published" || targetTime.getTime() < Date.now()) {
    return false
  }
  if (item.status !== "publishing") return true
  return item.scheduledAt ? new Date(item.scheduledAt).getTime() > Date.now() : false
}

function CalendarMonthDayCell({
  day,
  inCurrentMonth,
  posts,
  platformForPost,
  locale,
}: {
  day: Date
  inCurrentMonth: boolean
  posts: CalendarItem[]
  platformForPost: (post: CalendarItem) => SocialPlatform | undefined
  locale: "ar" | "en"
}) {
  const t = useTranslations("social.calendarUi")
  const { show: showToast } = useToast()
  const setViewMode = useSocialCalendarStore((s) => s.setViewMode)
  const applyOptimisticReschedule = useSocialCalendarStore((s) => s.applyOptimisticReschedule)
  const restorePosts = useSocialCalendarStore((s) => s.restorePosts)
  const fetchPosts = useSocialCalendarStore((s) => s.fetchPosts)

  const [{ isOver, canDrop }, dropRef] = useDrop(() => ({
    accept: POST_DND_TYPE,
    canDrop: (item: CalendarDragItem) => {
      const originalTime = item.scheduledAt || item.publishedAt || item.createdAt
      const target = new Date(day)
      if (originalTime) {
        const original = new Date(originalTime)
        target.setHours(original.getHours(), original.getMinutes(), 0, 0)
      }
      return canRescheduleItem(item, target)
    },
    drop: async (item: CalendarDragItem) => {
      const originalTime = item.scheduledAt || item.publishedAt || item.createdAt
      const target = new Date(day)
      if (originalTime) {
        const original = new Date(originalTime)
        target.setHours(original.getHours(), original.getMinutes(), 0, 0)
      }

      if (!canRescheduleItem(item, target)) {
        showToast(t("errors.cannotReschedule"), "warning")
        return
      }

      const scheduledAt = target.toISOString()
      const previousPosts = applyOptimisticReschedule(item.postId, scheduledAt)

      try {
        if (!item.source) return
        const result = await canonicalCalendarReschedule({ source: item.source, scheduledAt, confirmReleasedDelivery: () => confirm(t("confirmCancelReleasedDelivery")) })
        if (previousPosts) restorePosts(previousPosts)
        await fetchPosts()
        if (result.kind === "cancellation_not_guaranteed") showToast(t("errors.cancellationNotGuaranteed"), "warning")
        else showToast(t("toast.approvalRequired"), "success")
      } catch (error) {
        if (previousPosts) restorePosts(previousPosts)
        showToast(
          error instanceof Error ? error.message : t("errors.reschedule"),
          "error",
        )
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [applyOptimisticReschedule, day, fetchPosts, restorePosts, showToast, t])

  const visiblePosts = posts.slice(0, MAX_VISIBLE_POSTS)
  const hiddenCount = Math.max(0, posts.length - visiblePosts.length)

  return (
    <div
      ref={dropRef as unknown as React.Ref<HTMLDivElement>}
      className={`min-h-[120px] border-e border-b p-2 text-start transition-colors ${
        inCurrentMonth ? "text-foreground" : "text-muted-foreground/50"
      } ${isOver && canDrop ? "bg-purple-500/10 ring-1 ring-inset ring-purple-500/40" : ""} ${
        isOver && !canDrop ? "bg-destructive/5" : "hover:bg-accent/30"
      }`}
      onDoubleClick={() => {
        useSocialCalendarStore.setState({ currentDate: day })
        setViewMode("day")
      }}
    >
      <button
        type="button"
        onClick={() => {
          useSocialCalendarStore.setState({ currentDate: day })
          setViewMode("day")
        }}
        className="mb-1 text-xs font-medium"
      >
        <span lang={locale}>{formatCalendarDayNumber(day, locale)}</span>
      </button>
      <div className="space-y-1">
        {visiblePosts.map((post) => (
          <CalendarPostCard
            key={post.id}
            post={post}
            platform={platformForPost(post)}
          />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
            onClick={() => {
              useSocialCalendarStore.setState({ currentDate: day })
              setViewMode("day")
            }}
          >
            {t("more", { count: hiddenCount })}
          </button>
        )}
      </div>
    </div>
  )
}

export function CalendarMonth() {
  const t = useTranslations("social.calendarUi")
  const locale = useDirectionStore((state) => state.locale)
  const { currentDate, posts, weekStartsOn } = useSocialCalendarStore()
  const accounts = useSocialAccountsStore((s) => s.accounts)
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const calendarStart = getCalendarWeekStart(monthStart, weekStartsOn)
  const calendarEnd = getCalendarWeekEnd(monthEnd, weekStartsOn)
  const firstWeekday = weekStartsOn
  const weekdays = Array.from(
    { length: 7 },
    (_, offset) => WEEK_DAYS[(firstWeekday + offset) % 7]!,
  )

  const days = useMemo(() => {
    const values: Date[] = []
    let cursor = new Date(calendarStart)
    while (cursor <= calendarEnd) {
      values.push(new Date(cursor))
      cursor = addDays(cursor, 1)
    }
    return values
  }, [calendarStart, calendarEnd])

  const postsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const post of posts) {
      const dateStr = getCalendarDate(post)
      if (!dateStr) continue
      const d = new Date(dateStr)
      const key = format(d, "yyyy-MM-dd")
      const existing = map.get(key) ?? []
      existing.push(post)
      map.set(key, existing)
    }
    return map
  }, [posts])

  function getPostsForDate(day: Date) {
    return postsByDate.get(format(day, "yyyy-MM-dd")) ?? []
  }

  function platformForPost(post: CalendarItem) {
    return accounts.find((account) => account.id === post.socialAccountId)
      ?.platform as SocialPlatform | undefined
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="grid grid-cols-7 border-b">
          {weekdays.map((day) => (
            <div
              key={day}
              className="p-2 text-center text-xs font-medium text-muted-foreground"
            >
              {t(`weekdays.${day}`)}
            </div>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-7 auto-rows-fr">
          {days.map((day) => (
            <CalendarMonthDayCell
              key={day.toISOString()}
              day={day}
              inCurrentMonth={isSameMonth(day, currentDate)}
              posts={getPostsForDate(day)}
              platformForPost={platformForPost}
              locale={locale}
            />
          ))}
        </div>
      </div>
    </DndProvider>
  )
}
