"use client"

import { create } from "zustand"
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  format,
} from "date-fns"
import { listSocialPosts, type SocialPost } from "@/lib/social/client"

type ViewMode = "day" | "week" | "month" | "list"

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
  applyOptimisticReschedule: (postId: string, scheduledAt: string) => SocialPost[] | null
  restorePosts: (posts: SocialPost[]) => void
  replacePost: (post: SocialPost) => void
  getWeekStart: () => Date
  getWeekEnd: () => Date
  getDateRangeLabel: () => string
  hydrateFromStorage: () => void
}

function getStoredViewMode(): ViewMode | null {
  if (typeof window === "undefined") return null
  const stored = localStorage.getItem("social-calendar-view") as ViewMode | null
  if (stored === "day" || stored === "week" || stored === "month" || stored === "list") {
    return stored
  }
  return null
}

export const useSocialCalendarStore = create<SocialCalendarState>(
  (set, get) => ({
    viewMode: "week",
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
      set((s) => ({
        currentDate:
          s.viewMode === "day"
            ? addDays(s.currentDate, 1)
            : s.viewMode === "month" || s.viewMode === "list"
              ? addMonths(s.currentDate, 1)
              : addWeeks(s.currentDate, 1),
      }))
    },

    navigatePrev: () => {
      set((s) => ({
        currentDate:
          s.viewMode === "day"
            ? subDays(s.currentDate, 1)
            : s.viewMode === "month" || s.viewMode === "list"
              ? subMonths(s.currentDate, 1)
              : subWeeks(s.currentDate, 1),
      }))
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
        const range =
          get().viewMode === "day"
            ? {
                start: startOfDay(currentDate),
                end: endOfDay(currentDate),
              }
            : get().viewMode === "month" || get().viewMode === "list"
              ? {
                  start: startOfMonth(currentDate),
                  end: endOfMonth(currentDate),
                }
              : {
                  start: startOfWeek(currentDate, { weekStartsOn: 1 }),
                  end: endOfWeek(currentDate, { weekStartsOn: 1 }),
                }
        const posts = await listSocialPosts({
          startDate: range.start.toISOString(),
          endDate: range.end.toISOString(),
          socialAccountId: channelFilter ?? undefined,
        })
        set({ posts, isLoading: false })
      } catch {
        set({ isLoading: false })
      }
    },

    applyOptimisticReschedule: (postId, scheduledAt) => {
      const previousPosts = get().posts
      const foundPost = previousPosts.find((post) => post.id === postId)
      if (!foundPost) return null

      set({
        posts: previousPosts.map((post) =>
          post.id === postId
            ? {
                ...post,
                status: post.status === "publishing" ? "queued" : post.status,
                scheduledAt,
                updatedAt: new Date().toISOString(),
              }
            : post,
        ),
      })

      return previousPosts
    },

    restorePosts: (posts) => {
      set({ posts })
    },

    replacePost: (updatedPost) => {
      set((state) => ({
        posts: state.posts.map((post) =>
          post.id === updatedPost.id ? updatedPost : post,
        ),
      }))
    },

    getWeekStart: () => startOfWeek(get().currentDate, { weekStartsOn: 1 }),
    getWeekEnd: () => endOfWeek(get().currentDate, { weekStartsOn: 1 }),

    hydrateFromStorage: () => {
      const stored = getStoredViewMode()
      if (stored && stored !== get().viewMode) {
        set({ viewMode: stored })
      }
    },

    getDateRangeLabel: () => {
      const viewMode = get().viewMode
      if (viewMode === "day") {
        return format(get().currentDate, "EEEE, MMM d, yyyy")
      }
      if (viewMode === "month" || viewMode === "list") {
        return format(get().currentDate, "MMMM yyyy")
      }
      const start = startOfWeek(get().currentDate, { weekStartsOn: 1 })
      const end = endOfWeek(get().currentDate, { weekStartsOn: 1 })
      return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`
    },
  }),
)
