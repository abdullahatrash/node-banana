"use client"

import { useMemo } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { format } from "date-fns"
import { useRouter } from "next/navigation"
import { useSocialCalendarStore } from "@/store/socialCalendarStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import { POST_STATUS_CONFIG } from "@/lib/social/constants"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { retrySocialPost } from "@/lib/social/client"
import { useToast } from "@/components/Toast"
import type { SocialPlatform, SocialPostStatus } from "@/lib/db/schema"

export function CalendarListView() {
  const t = useTranslations("social.calendarUi")
  const formatValue = useFormatter()
  const { posts } = useSocialCalendarStore()
  const accounts = useSocialAccountsStore((s) => s.accounts)
  const router = useRouter()
  const { show: showToast } = useToast()
  const fetchPosts = useSocialCalendarStore((s) => s.fetchPosts)

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, typeof posts>()
    for (const post of posts) {
      const dateStr = post.scheduledAt || post.publishedAt || post.createdAt
      const dateKey = dateStr ? format(new Date(dateStr), "yyyy-MM-dd") : "unknown"
      const existing = map.get(dateKey) ?? []
      existing.push(post)
      map.set(dateKey, existing)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [posts])

  if (posts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">{t("noPostsThisWeek")}</p>
      </div>
    )
  }

  async function handleRetry(postId: string) {
    try {
      await retrySocialPost(postId)
      showToast(t("toast.requeued"), "success")
      fetchPosts()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("errors.retry"),
        "error",
      )
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {grouped.map(([dateKey, datePosts]) => (
        <div key={dateKey} className="mb-6">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            {dateKey !== "unknown"
              ? formatValue.dateTime(new Date(dateKey), { weekday: "long", year: "numeric", month: "long", day: "numeric" })
              : t("unscheduled")}
          </h3>
          <div className="space-y-1.5">
            {datePosts.map((post) => {
              const statusConfig =
                POST_STATUS_CONFIG[post.status as SocialPostStatus]
              const time = post.scheduledAt || post.publishedAt || post.createdAt

              return (
                <div
                  key={post.id}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3"
                >
                  <PlatformIcon
                    platform={
                      (accounts.find((account) => account.id === post.socialAccountId)
                        ?.platform as SocialPlatform) ?? "linkedin"
                    }
                    size={16}
                  />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-xs">
                      {post.content?.slice(0, 80) || t("noContent")}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {t(`authority.${post.authority.kind}`)}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={`text-[10px] ${statusConfig?.color ?? ""}`}
                  >
                    {t(`status.${post.status}`)}
                  </Badge>
                  {time && (
                    <span className="text-[10px] text-muted-foreground">
                      {formatValue.dateTime(new Date(time), { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                  {post.authority.kind === "legacy_compatibility" && post.status === "draft" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => router.push(`/social/compose/${post.id}`)}
                    >
                      {t("actions.edit")}
                    </Button>
                  )}
                  {post.authority.kind === "legacy_compatibility" && post.status === "failed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-destructive"
                      onClick={() => handleRetry(post.id)}
                    >
                      {t("actions.retry")}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
