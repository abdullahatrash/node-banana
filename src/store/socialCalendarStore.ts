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
  type Day,
} from "date-fns"
import type { AppLocale } from "@/i18n/config"
import { listSocialPosts, type SocialPost } from "@/lib/social/client"
import { useDirectionStore } from "@/store/directionStore"

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
  getWeekStart: (locale?: AppLocale) => Date
  getWeekEnd: (locale?: AppLocale) => Date
  getDateRangeLabel: (locale?: AppLocale) => string
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

const calendarLocale = (locale: AppLocale) =>
  locale === "ar" ? "ar-u-ca-gregory-nu-arab" : "en-u-ca-gregory-nu-latn"

function selectedLocale(): AppLocale {
  return useDirectionStore.getState().locale
}

/** CLDR week starts: Saturday for generic Arabic, Sunday for generic English. */
export function getCalendarWeekStartsOn(locale: AppLocale): Day {
  return locale === "ar" ? 6 : 0
}

export function getCalendarWeekStart(date: Date, locale: AppLocale): Date {
  return startOfWeek(date, { weekStartsOn: getCalendarWeekStartsOn(locale) })
}

export function getCalendarWeekEnd(date: Date, locale: AppLocale): Date {
  return endOfWeek(date, { weekStartsOn: getCalendarWeekStartsOn(locale) })
}

export function formatCalendarDateRange(
  date: Date,
  viewMode: ViewMode,
  locale: AppLocale,
): string {
  const localeName = calendarLocale(locale)
  if (viewMode === "day") {
    return new Intl.DateTimeFormat(localeName, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date)
  }
  if (viewMode === "month" || viewMode === "list") {
    return new Intl.DateTimeFormat(localeName, {
      month: "long",
      year: "numeric",
    }).format(date)
  }
  const formatter = new Intl.DateTimeFormat(localeName, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return formatter.formatRange(
    getCalendarWeekStart(date, locale),
    getCalendarWeekEnd(date, locale),
  )
}

export function formatCalendarDayHeader(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(calendarLocale(locale), {
    weekday: "short",
    day: "numeric",
  }).format(date)
}

export function formatCalendarDayHeading(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(calendarLocale(locale), {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date)
}

export function formatCalendarDayNumber(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(calendarLocale(locale), {
    day: "numeric",
  }).format(date)
}

export function formatCalendarTime(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(calendarLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
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
                  start: getCalendarWeekStart(currentDate, selectedLocale()),
                  end: getCalendarWeekEnd(currentDate, selectedLocale()),
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

    getWeekStart: (locale = selectedLocale()) =>
      getCalendarWeekStart(get().currentDate, locale),
    getWeekEnd: (locale = selectedLocale()) =>
      getCalendarWeekEnd(get().currentDate, locale),

    hydrateFromStorage: () => {
      const stored = getStoredViewMode()
      if (stored && stored !== get().viewMode) {
        set({ viewMode: stored })
      }
    },

    getDateRangeLabel: (locale = selectedLocale()) =>
      formatCalendarDateRange(get().currentDate, get().viewMode, locale),
  }),
)
