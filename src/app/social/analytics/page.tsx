"use client"

import { useMemo, useRef, useState } from "react"
import { listSocialEvents, listSocialPosts, type SocialPost } from "@/lib/social/client"
import { Loader2Icon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

const STATUS_ORDER = ["draft", "queued", "publishing", "published", "failed"] as const

export default function SocialAnalyticsPage() {
  const t = useTranslations("social.analytics")
  const format = useFormatter()
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [eventCount, setEventCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const initialized = useRef(false)

  if (!initialized.current) {
    initialized.current = true
    Promise.all([
      listSocialPosts({ limit: 500 }),
      listSocialEvents({ limit: 200 }),
    ])
      .then(([loadedPosts, events]) => {
        setPosts(loadedPosts)
        setEventCount(events.length)
      })
      .finally(() => setIsLoading(false))
  }

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const status of STATUS_ORDER) {
      counts.set(status, 0)
    }
    for (const post of posts) {
      counts.set(post.status, (counts.get(post.status) || 0) + 1)
    }
    return counts
  }, [posts])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t("totalPosts")}</div>
          <div className="mt-1 text-2xl font-semibold"><bdi>{format.number(posts.length)}</bdi></div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t("publishedPosts")}</div>
          <div className="mt-1 text-2xl font-semibold">
            <bdi>{format.number(statusCounts.get("published") || 0)}</bdi>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t("recentEvents")}</div>
          <div className="mt-1 text-2xl font-semibold"><bdi>{format.number(eventCount)}</bdi></div>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium">{t("distribution")}</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STATUS_ORDER.map((status) => (
            <div key={status} className="rounded-md bg-muted px-3 py-2">
              <div className="text-[10px] uppercase text-muted-foreground">
                {t(`status.${status}`)}
              </div>
              <div className="text-lg font-semibold">
                <bdi>{format.number(statusCounts.get(status) || 0)}</bdi>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
