"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useShallow } from "zustand/shallow"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { useDirectionStore } from "@/store/directionStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { isolateLtr } from "@/i18n/bidi"
import type { SocialPlatform } from "@/lib/db/schema"

export function CalendarFilters() {
  const t = useTranslations("social.calendarUi")
  const { locale, direction } = useDirectionStore()
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

  const PreviousIcon = direction === "rtl" ? ChevronRightIcon : ChevronLeftIcon
  const NextIcon = direction === "rtl" ? ChevronLeftIcon : ChevronRightIcon

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2" dir={direction}>
      {/* View toggle */}
      <div className="flex max-w-full overflow-x-auto rounded-md border">
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
        <PreviousIcon className="size-4" data-testid="calendar-previous-icon" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={navigateNext} aria-label={t("next")}>
        <NextIcon className="size-4" data-testid="calendar-next-icon" />
      </Button>
      <Button variant="outline" size="sm" className="text-xs" onClick={goToToday}>
        {t("today")}
      </Button>

      {/* Date range */}
      <span className="text-sm font-medium" lang={locale} dir={direction}>{getDateRangeLabel(locale)}</span>

      <Separator orientation="vertical" className="h-4" />

      <select
        value={channelFilter ?? ""}
        onChange={(e) => {
          const next = e.target.value || null
          setChannelFilter(next)
          setSidebarChannelFilter(next)
        }}
        className="h-8 min-w-0 max-w-full rounded-md border bg-background px-2 text-xs sm:min-w-[180px]"
      >
        <option value="">{t("allChannels")}</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id} dir="auto">
            {account.displayName} ({isolateLtr(account.platform as SocialPlatform)})
          </option>
        ))}
      </select>
    </div>
  )
}
