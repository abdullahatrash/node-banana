"use client"

import { useEffect, useRef } from "react"
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

export default function CalendarPage() {
  const {
    viewMode,
    isLoading,
    fetchPosts,
    currentDate,
    channelFilter,
    setChannelFilter,
  } =
    useSocialCalendarStore()
  const { accounts, selectedChannelFilter } = useSocialAccountsStore(useShallow((s) => ({
    accounts: s.accounts,
    selectedChannelFilter: s.selectedChannelFilter,
  })))
  const initialized = useRef(false)

  // Fetch posts on first render
  if (!initialized.current) {
    initialized.current = true
    fetchPosts()
  }

  // Refetch when date or filter changes — track previous values via ref
  const prevKey = useRef("")
  const key = `${viewMode}-${currentDate.toISOString()}-${channelFilter}`
  if (prevKey.current && prevKey.current !== key) {
    fetchPosts()
  }
  prevKey.current = key

  // Keep calendar filter aligned with sidebar channel filter
  useEffect(() => {
    if (selectedChannelFilter !== channelFilter) {
      setChannelFilter(selectedChannelFilter)
    }
  }, [selectedChannelFilter, channelFilter, setChannelFilter])

  // Empty state: no channels
  if (accounts.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <CalendarFilters />
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center">
            <h2 className="mb-2 text-lg font-semibold">No channels connected</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Connect a social account to start scheduling posts.
            </p>
            <Button render={<a href="/social/channels" />} nativeButton={false}>
              <PlusIcon className="size-4" />
              Connect Channel
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
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
    </div>
  )
}
