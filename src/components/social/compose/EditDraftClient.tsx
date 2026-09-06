"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { ComposeView } from "./ComposeView"
import { getSocialPost } from "@/lib/social/client"
import { useToast } from "@/components/Toast"
import { useTranslations } from "next-intl"
import { useClientErrorPresentation } from "@/hooks/use-client-error-presentation"

interface EditDraftClientProps {
  postId: string
}

export function EditDraftClient({ postId }: EditDraftClientProps) {
  const t = useTranslations("social.editDraft")
  const router = useRouter()
  const { show: showToast } = useToast()
  const { show: showClientError } = useClientErrorPresentation()
  const { loadDraft, reset } = useSocialComposerStore()
  const [isLoading, setIsLoading] = useState(true)
  const initialized = useRef(false)

  // Fetch draft on first render
  if (!initialized.current) {
    initialized.current = true
    reset()
    getSocialPost(postId)
      .then((post) => {
        if (post.status !== "draft") {
          showToast(t("onlyDrafts"), "warning")
          router.push("/social/posts")
          return
        }
        loadDraft({
          postId: post.id,
          content: post.content,
          mediaUrls: post.mediaUrls as any,
          stableMediaRefs: post.stableMediaRefs,
          platformSettings: post.platformSettings,
          scheduledAt: post.scheduledAt,
          socialAccountId: post.socialAccountId,
        })
        setIsLoading(false)
      })
      .catch((error) => {
        showClientError(showToast, error, t("loadFailed"))
        router.push("/social/posts")
      })
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <ComposeView />
}
