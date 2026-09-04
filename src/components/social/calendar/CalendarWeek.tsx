"use client"

import { useMemo } from "react"
import { DndProvider } from "react-dnd"
import { HTML5Backend } from "react-dnd-html5-backend"
import {
  addDays,
  format,
  isToday,
} from "date-fns"
import {
  formatCalendarDayHeader,
  formatCalendarTime,
  getCalendarWeekStart,
  useSocialCalendarStore,
} from "@/store/socialCalendarStore"
import { useDirectionStore } from "@/store/directionStore"
import { CalendarColumn } from "./CalendarColumn"
import type { SocialPost } from "@/lib/social/client"

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 15, 30, 45]

export function CalendarWeek() {
  const { currentDate, posts, weekStartsOn } = useSocialCalendarStore()
  const locale = useDirectionStore((state) => state.locale)

  const weekStart = getCalendarWeekStart(currentDate, weekStartsOn)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  // Group posts by day + hour
  const postsBySlot = useMemo(() => {
    const map = new Map<string, SocialPost[]>()
    for (const post of posts) {
      const dateStr = post.scheduledAt || post.publishedAt || post.createdAt
      if (!dateStr) continue
      const d = new Date(dateStr)
      const minute = Math.floor(d.getMinutes() / 15) * 15
      const key = `${format(d, "yyyy-MM-dd")}-${d.getHours()}-${minute}`
      const existing = map.get(key) ?? []
      existing.push(post)
      map.set(key, existing)
    }
    return map
  }, [posts])

  function getPostsForSlot(day: Date, hour: number, minute: number): SocialPost[] {
    const key = `${format(day, "yyyy-MM-dd")}-${hour}-${minute}`
    return postsBySlot.get(key) ?? []
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex flex-1 overflow-auto">
        {/* Time labels */}
        <div className="w-[60px] flex-shrink-0 border-e">
          {/* Header spacer */}
          <div className="h-8 border-b" />
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="flex h-28 items-start justify-end border-b pe-2 pt-0.5 text-[10px] text-muted-foreground"
            >
              {formatCalendarTime(new Date(new Date().setHours(hour, 0)), locale)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div className="grid flex-1 grid-cols-7">
          {days.map((day) => (
            <div key={day.toISOString()} className="min-w-0">
              {/* Day header */}
              <div
                className={`flex h-8 items-center justify-center border-b border-e text-xs font-medium ${
                  isToday(day)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground"
                }`}
              >
                <span lang={locale}>{formatCalendarDayHeader(day, locale)}</span>
              </div>

              {/* Hour slots */}
              {HOURS.map((hour) => (
                <div key={hour}>
                  {MINUTES.map((minute) => (
                    <CalendarColumn
                      key={`${hour}-${minute}`}
                      date={day}
                      hour={hour}
                      minute={minute}
                      posts={getPostsForSlot(day, hour, minute)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </DndProvider>
  )
}
