"use client"

import { DndProvider } from "react-dnd"
import { HTML5Backend } from "react-dnd-html5-backend"
import { format } from "date-fns"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { CalendarColumn } from "./CalendarColumn"

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export function CalendarDay() {
  const { currentDate, posts } = useSocialCalendarStore()
  const day = new Date(currentDate)

  function getPostsForHour(hour: number) {
    return posts.filter((post) => {
      const dateStr = post.scheduledAt || post.publishedAt || post.createdAt
      if (!dateStr) return false
      const d = new Date(dateStr)
      return (
        d.getFullYear() === day.getFullYear() &&
        d.getMonth() === day.getMonth() &&
        d.getDate() === day.getDate() &&
        d.getHours() === hour
      )
    })
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex flex-1 overflow-auto">
        <div className="w-[60px] flex-shrink-0 border-e">
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
        <div className="flex-1 min-w-0">
          <div className="flex h-8 items-center justify-center border-b text-xs font-medium text-muted-foreground">
            {format(day, "EEEE, MMM d")}
          </div>
          {HOURS.map((hour) => (
            <CalendarColumn
              key={hour}
              date={day}
              hour={hour}
              posts={getPostsForHour(hour)}
            />
          ))}
        </div>
      </div>
    </DndProvider>
  )
}

