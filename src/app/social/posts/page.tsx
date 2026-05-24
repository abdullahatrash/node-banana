"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"
import { listSocialPosts, type SocialPost } from "@/lib/social/client"
import { PostRow } from "@/components/social/posts/PostRow"
import type { SocialPostStatus } from "@/lib/db/schema"

type PostStatusTab = SocialPostStatus | "all" | "scheduled"

const STATUS_TABS: { value: PostStatusTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Failed" },
]

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
      .catch((error) => {
        setError(error instanceof Error ? error.message : "Failed to load posts")
        setPosts([])
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  function handleTabChange(tab: PostStatusTab) {
    setActiveTab(tab)
    fetchPosts(tab)
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Status tab filters */}
      <div className="flex items-center gap-1 border-b px-4 py-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleTabChange(tab.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {tab.label}
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
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">
              {activeTab === "all"
                ? "No posts yet. Create one from the Compose page."
                : `No ${activeTab} posts.`}
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
    </div>
  )
}
