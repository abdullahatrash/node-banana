"use client"

import { DndProvider } from "react-dnd"
import { HTML5Backend } from "react-dnd-html5-backend"
import {
  formatCalendarDayHeading,
  formatCalendarTime,
  useSocialCalendarStore,
} from "@/store/socialCalendarStore"
import { useDirectionStore } from "@/store/directionStore"
import { CalendarColumn } from "./CalendarColumn"

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 15, 30, 45]

export function CalendarDay() {
  const { currentDate, posts } = useSocialCalendarStore()
  const locale = useDirectionStore((state) => state.locale)
  const day = new Date(currentDate)

  function getPostsForSlot(hour: number, minute: number) {
    return posts.filter((post) => {
      const dateStr = post.scheduledAt || post.publishedAt || post.createdAt
      if (!dateStr) return false
      const d = new Date(dateStr)
      const slotMinute = Math.floor(d.getMinutes() / 15) * 15
      return (
        d.getFullYear() === day.getFullYear() &&
        d.getMonth() === day.getMonth() &&
        d.getDate() === day.getDate() &&
        d.getHours() === hour &&
        slotMinute === minute
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
              className="flex h-28 items-start justify-end border-b pe-2 pt-0.5 text-[10px] text-muted-foreground"
            >
              {formatCalendarTime(new Date(new Date().setHours(hour, 0)), locale)}
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex h-8 items-center justify-center border-b text-xs font-medium text-muted-foreground">
            <span lang={locale}>{formatCalendarDayHeading(day, locale)}</span>
          </div>
          {HOURS.map((hour) => (
            <div key={hour}>
              {MINUTES.map((minute) => (
                <CalendarColumn
                  key={`${hour}-${minute}`}
                  date={day}
                  hour={hour}
                  minute={minute}
                  posts={getPostsForSlot(hour, minute)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </DndProvider>
  )
}
