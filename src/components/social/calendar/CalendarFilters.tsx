"use client"

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { SocialPlatform } from "@/lib/db/schema"

export function CalendarFilters() {
  const {
    viewMode,
    setViewMode,
    channelFilter,
    setChannelFilter,
    navigatePrev,
    navigateNext,
    goToToday,
    getDateRangeLabel,
  } = useSocialCalendarStore()
  const { accounts, setSidebarChannelFilter } = useSocialAccountsStore((s) => ({
    accounts: s.accounts,
    setSidebarChannelFilter: s.setChannelFilter,
  }))

  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      {/* View toggle */}
      <div className="flex rounded-md border">
        <button
          onClick={() => setViewMode("day")}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            viewMode === "day"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          Day
        </button>
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
          onClick={() => setViewMode("month")}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            viewMode === "month"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          Month
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

      <Separator orientation="vertical" className="h-4" />

      <select
        value={channelFilter ?? ""}
        onChange={(e) => {
          const next = e.target.value || null
          setChannelFilter(next)
          setSidebarChannelFilter(next)
        }}
        className="h-8 min-w-[180px] rounded-md border bg-background px-2 text-xs"
      >
        <option value="">All channels</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.displayName} ({account.platform as SocialPlatform})
          </option>
        ))}
      </select>
    </div>
  )
}
