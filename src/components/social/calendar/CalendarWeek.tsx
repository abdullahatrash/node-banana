"use client"

import { useMemo } from "react"
import { DndProvider } from "react-dnd"
import { HTML5Backend } from "react-dnd-html5-backend"
import {
  startOfWeek,
  addDays,
  format,
  isToday,
} from "date-fns"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { CalendarColumn } from "./CalendarColumn"
import type { SocialPost } from "@/lib/social/client"

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export function CalendarWeek() {
  const { currentDate, posts } = useSocialCalendarStore()

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  // Group posts by day + hour
  const postsBySlot = useMemo(() => {
    const map = new Map<string, SocialPost[]>()
    for (const post of posts) {
      const dateStr = post.scheduledAt || post.publishedAt || post.createdAt
      if (!dateStr) continue
      const d = new Date(dateStr)
      const key = `${format(d, "yyyy-MM-dd")}-${d.getHours()}`
      const existing = map.get(key) ?? []
      existing.push(post)
      map.set(key, existing)
    }
    return map
  }, [posts])

  function getPostsForSlot(day: Date, hour: number): SocialPost[] {
    const key = `${format(day, "yyyy-MM-dd")}-${hour}`
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
              className="flex h-12 items-start justify-end border-b pe-2 pt-0.5 text-[10px] text-muted-foreground"
            >
              {format(new Date().setHours(hour, 0), "HH:mm")}
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
                <span>{format(day, "EEE d")}</span>
              </div>

              {/* Hour slots */}
              {HOURS.map((hour) => (
                <CalendarColumn
                  key={hour}
                  date={day}
                  hour={hour}
                  posts={getPostsForSlot(day, hour)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </DndProvider>
  )
}
