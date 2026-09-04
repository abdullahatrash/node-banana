"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useShallow } from "zustand/shallow"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { SocialPlatform } from "@/lib/db/schema"

export function CalendarFilters() {
  const t = useTranslations("social.calendarUi")
  const {
    viewMode,
    setViewMode,
    channelFilter,
    setChannelFilter,
    navigatePrev,
    navigateNext,
    goToToday,
    getDateRangeLabel,
    hydrateFromStorage,
  } = useSocialCalendarStore()
  const { accounts, setSidebarChannelFilter } = useSocialAccountsStore(useShallow((s) => ({
    accounts: s.accounts,
    setSidebarChannelFilter: s.setChannelFilter,
  })))

  useEffect(() => {
    hydrateFromStorage()
  }, [hydrateFromStorage])

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
          {t("views.day")}
        </button>
        <button
          onClick={() => setViewMode("week")}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            viewMode === "week"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          {t("views.week")}
        </button>
        <button
          onClick={() => setViewMode("month")}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            viewMode === "month"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          {t("views.month")}
        </button>
        <button
          onClick={() => setViewMode("list")}
          className={`px-3 py-1 text-xs font-medium transition-colors ${
            viewMode === "list"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          {t("views.list")}
        </button>
      </div>

      <Separator orientation="vertical" className="h-4" />

      {/* Navigation */}
      <Button variant="ghost" size="icon" className="size-7" onClick={navigatePrev} aria-label={t("previous")}>
        <ChevronLeftIcon className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={navigateNext} aria-label={t("next")}>
        <ChevronRightIcon className="size-4" />
      </Button>
      <Button variant="outline" size="sm" className="text-xs" onClick={goToToday}>
        {t("today")}
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
        <option value="">{t("allChannels")}</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.displayName} ({account.platform as SocialPlatform})
          </option>
        ))}
      </select>
    </div>
  )
}
