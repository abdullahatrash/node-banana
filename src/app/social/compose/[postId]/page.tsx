"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { ComposeView } from "@/components/social/compose/ComposeView"
import { getSocialPost } from "@/lib/social/client"
import { useToast } from "@/components/Toast"

export default function EditDraftPage() {
  const params = useParams<{ postId: string }>()
  const router = useRouter()
  const { show: showToast } = useToast()
  const { loadDraft, reset } = useSocialComposerStore()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    reset()

    async function load() {
      try {
        const post = await getSocialPost(params.postId)
        if (post.status !== "draft") {
          showToast("Only drafts can be edited", "warning")
          router.push("/social/posts")
          return
        }
        loadDraft({
          postId: post.id,
          content: post.content,
          mediaUrls: post.mediaUrls as any,
          scheduledAt: post.scheduledAt,
          socialAccountId: post.socialAccountId,
        })
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : "Failed to load draft",
          "error",
        )
        router.push("/social/posts")
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [params.postId])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <ComposeView />
}
