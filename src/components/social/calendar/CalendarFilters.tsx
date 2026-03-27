"use client"

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

export function CalendarFilters() {
  const {
    viewMode,
    setViewMode,
    navigatePrev,
    navigateNext,
    goToToday,
    getDateRangeLabel,
  } = useSocialCalendarStore()

  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      {/* View toggle */}
      <div className="flex rounded-md border">
        <button
          onClick={() => setViewMode("week")}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            viewMode === "week"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          Week
        </button>
        <button
          onClick={() => setViewMode("list")}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            viewMode === "list"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          List
        </button>
      </div>

      <Separator orientation="vertical" className="h-4" />

      {/* Navigation */}
      <Button variant="ghost" size="icon" className="size-7" onClick={navigatePrev}>
        <ChevronLeftIcon className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={navigateNext}>
        <ChevronRightIcon className="size-4" />
      </Button>
      <Button variant="outline" size="sm" className="text-xs" onClick={goToToday}>
        Today
      </Button>

      {/* Date range */}
      <span className="text-sm font-medium">{getDateRangeLabel()}</span>
    </div>
  )
}
