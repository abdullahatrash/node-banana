"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { listSocialPosts, type SocialPost } from "@/lib/social/client"
import { PostRow } from "@/components/social/posts/PostRow"
type PostStatusTab = "all" | "draft" | "scheduled" | "published" | "failed"

const STATUS_TABS: PostStatusTab[] = ["all", "draft", "scheduled", "published", "failed"]

function isWaitingForScheduledPublish(post: SocialPost) {
  return (
    post.status === "publishing" &&
    post.scheduledAt !== null &&
    post.scheduledAt !== undefined &&
    new Date(post.scheduledAt).getTime() > Date.now()
  )
}

function isScheduledPost(post: SocialPost) {
  return post.status === "queued" || isWaitingForScheduledPublish(post)
}

export default function PostsPage() {
  const t = useTranslations("social.postsPage")
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<PostStatusTab>("all")
  const [error, setError] = useState<string | null>(null)

  const fetchPosts = useCallback((status?: PostStatusTab) => {
    setIsLoading(true)
    setError(null)
    listSocialPosts({
      status: status && status !== "all" && status !== "scheduled"
        ? status
        : undefined,
    })
      .then((posts) => {
        setPosts(status === "scheduled" ? posts.filter(isScheduledPost) : posts)
      })
      .catch(() => {
        setError(t("errors.load"))
        setPosts([])
      })
      .finally(() => setIsLoading(false))
  }, [t])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  function handleTabChange(tab: PostStatusTab) {
    setActiveTab(tab)
    fetchPosts(tab)
  }

  return (
    <main className="flex flex-1 flex-col">
      {/* Status tab filters */}
      <div className="flex items-center gap-1 border-b px-4 py-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            aria-pressed={activeTab === tab}
            onClick={() => handleTabChange(tab)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Posts list */}
      <div className="flex-1 overflow-y-auto p-4">
        {error ? (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {isLoading ? (
          <div className="flex items-center justify-center py-12" role="status" aria-label={t("loading")}>
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">
              {activeTab === "all"
                ? t("empty.all")
                : t("empty.filtered", { status: t(`tabs.${activeTab}`) })}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                onMutate={() => fetchPosts(activeTab)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
