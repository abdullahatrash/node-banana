"use client"

import { useMemo } from "react"
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function CalendarMonth() {
  const { currentDate, posts, setViewMode } = useSocialCalendarStore()
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

  const days = useMemo(() => {
    const values: Date[] = []
    let cursor = new Date(calendarStart)
    while (cursor <= calendarEnd) {
      values.push(new Date(cursor))
      cursor = addDays(cursor, 1)
    }
    return values
  }, [calendarStart, calendarEnd])

  function countPostsForDate(day: Date) {
    return posts.filter((post) => {
      const dateStr = post.scheduledAt || post.publishedAt || post.createdAt
      if (!dateStr) return false
      const d = new Date(dateStr)
      return (
        d.getFullYear() === day.getFullYear() &&
        d.getMonth() === day.getMonth() &&
        d.getDate() === day.getDate()
      )
    }).length
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="grid grid-cols-7 border-b">
        {WEEK_DAYS.map((day) => (
          <div
            key={day}
            className="p-2 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 auto-rows-fr">
        {days.map((day) => {
          const inCurrentMonth = isSameMonth(day, currentDate)
          const postCount = countPostsForDate(day)
          return (
            <button
              key={day.toISOString()}
              onClick={() => {
                useSocialCalendarStore.setState({ currentDate: day })
                setViewMode("day")
              }}
              className={`min-h-[90px] border-e border-b p-2 text-start transition-colors hover:bg-accent/30 ${
                inCurrentMonth ? "text-foreground" : "text-muted-foreground/50"
              }`}
            >
              <div className="text-xs font-medium">{format(day, "d")}</div>
              {postCount > 0 && (
                <div className="mt-2 inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
                  {postCount} post{postCount > 1 ? "s" : ""}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

