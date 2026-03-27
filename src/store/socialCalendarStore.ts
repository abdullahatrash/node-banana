"use client"

import { create } from "zustand"
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  format,
} from "date-fns"
import { listSocialPosts, type SocialPost } from "@/lib/social/client"

type ViewMode = "week" | "list"

interface SocialCalendarState {
  viewMode: ViewMode
  currentDate: Date
  channelFilter: string | null
  posts: SocialPost[]
  isLoading: boolean

  setViewMode: (mode: ViewMode) => void
  navigateNext: () => void
  navigatePrev: () => void
  goToToday: () => void
  setChannelFilter: (accountId: string | null) => void
  fetchPosts: () => Promise<void>
  getWeekStart: () => Date
  getWeekEnd: () => Date
  getDateRangeLabel: () => string
}

function loadViewMode(): ViewMode {
  if (typeof window === "undefined") return "week"
  return (localStorage.getItem("social-calendar-view") as ViewMode) ?? "week"
}

export const useSocialCalendarStore = create<SocialCalendarState>(
  (set, get) => ({
    viewMode: loadViewMode(),
    currentDate: new Date(),
    channelFilter: null,
    posts: [],
    isLoading: false,

    setViewMode: (mode) => {
      if (typeof window !== "undefined") {
        localStorage.setItem("social-calendar-view", mode)
      }
      set({ viewMode: mode })
    },

    navigateNext: () => {
      set((s) => ({ currentDate: addWeeks(s.currentDate, 1) }))
    },

    navigatePrev: () => {
      set((s) => ({ currentDate: subWeeks(s.currentDate, 1) }))
    },

    goToToday: () => {
      set({ currentDate: new Date() })
    },

    setChannelFilter: (accountId) => {
      set({ channelFilter: accountId })
    },

    fetchPosts: async () => {
      const { currentDate, channelFilter } = get()
      if (get().isLoading) return
      set({ isLoading: true })
      try {
        const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
        const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
        const posts = await listSocialPosts({
          startDate: weekStart.toISOString(),
          endDate: weekEnd.toISOString(),
          socialAccountId: channelFilter ?? undefined,
        })
        set({ posts, isLoading: false })
      } catch {
        set({ isLoading: false })
      }
    },

    getWeekStart: () => startOfWeek(get().currentDate, { weekStartsOn: 1 }),
    getWeekEnd: () => endOfWeek(get().currentDate, { weekStartsOn: 1 }),

    getDateRangeLabel: () => {
      const start = startOfWeek(get().currentDate, { weekStartsOn: 1 })
      const end = endOfWeek(get().currentDate, { weekStartsOn: 1 })
      return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`
    },
  }),
)
