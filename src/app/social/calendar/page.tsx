"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useShallow } from "zustand/shallow"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { CalendarFilters } from "@/components/social/calendar/CalendarFilters"
import { CalendarWeek } from "@/components/social/calendar/CalendarWeek"
import { CalendarDay } from "@/components/social/calendar/CalendarDay"
import { CalendarMonth } from "@/components/social/calendar/CalendarMonth"
import { CalendarListView } from "@/components/social/calendar/CalendarListView"
import { Button } from "@/components/ui/button"
import { PlusIcon, Loader2Icon } from "lucide-react"
import { useTranslations } from "next-intl"

export default function CalendarPage() {
  const t = useTranslations("social.calendar")
  const {
    viewMode,
    isLoading,
    fetchPosts,
    currentDate,
    channelFilter,
    setChannelFilter,
    setCalendarPreferences,
  } =
    useSocialCalendarStore()
  const { accounts, selectedChannelFilter } = useSocialAccountsStore(useShallow((s) => ({
    accounts: s.accounts,
    selectedChannelFilter: s.selectedChannelFilter,
  })))
  // Fetch posts on mount and when date/filter/view changes
  useEffect(() => {
    fetchPosts()
  }, [fetchPosts, viewMode, currentDate, channelFilter])

  useEffect(() => {
    const workspaceId = window.localStorage.getItem("node-banana-active-workspace-id")
    if (!workspaceId) return
    const controller = new AbortController()
    void fetch("/api/studio/calendar/preferences", {
      cache: "no-store",
      headers: { "x-workspace-id": workspaceId },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return
      const body = await response.json() as { preferences?: { timezone: string; weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 } }
      if (body.preferences) setCalendarPreferences(body.preferences)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [setCalendarPreferences])

  // Keep calendar filter aligned with sidebar channel filter
  useEffect(() => {
    if (selectedChannelFilter !== channelFilter) {
      setChannelFilter(selectedChannelFilter)
    }
  }, [selectedChannelFilter, channelFilter, setChannelFilter])

  // Empty state: no channels
  if (accounts.length === 0) {
    return (
      <main className="flex flex-1 flex-col">
        <CalendarFilters />
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center">
            <h2 className="mb-2 text-lg font-semibold">{t("noChannels")}</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              {t("noChannelsHelp")}
            </p>
            <Button render={<Link href="/social/channels" />} nativeButton={false}>
              <PlusIcon className="size-4" />
              {t("connectChannel")}
            </Button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <CalendarFilters />
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : viewMode === "day" ? (
        <CalendarDay />
      ) : viewMode === "week" ? (
        <CalendarWeek />
      ) : viewMode === "month" ? (
        <CalendarMonth />
      ) : (
        <CalendarListView />
      )}
    </main>
  )
}
