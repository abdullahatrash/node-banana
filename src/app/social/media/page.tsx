"use client"

import { useMemo, useRef, useState } from "react"
import { listSocialPosts, type SocialPost } from "@/lib/social/client"
import { Loader2Icon } from "lucide-react"
import { useTranslations } from "next-intl"

type MediaItem = {
  postId: string;
  type: string;
  url: string;
  createdAt: string;
}

export default function SocialMediaPage() {
  const t = useTranslations("social.media")
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const initialized = useRef(false)

  if (!initialized.current) {
    initialized.current = true
    listSocialPosts({ limit: 400 })
      .then(setPosts)
      .finally(() => setIsLoading(false))
  }

  const media = useMemo<MediaItem[]>(() => {
    return posts.flatMap((post) =>
      (post.mediaUrls || []).map((item) => ({
        postId: post.id,
        type: item.type,
        url: item.url,
        createdAt: post.createdAt,
      })),
    )
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
      {media.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {media.map((item, index) => (
            <div key={`${item.postId}-${index}`} className="rounded-lg border bg-card p-2">
              {item.type === "image" ? (
                <img
                  src={item.url}
                  alt={t("itemAlt", { number: index + 1 })}
                  className="h-36 w-full rounded-md object-cover"
                />
              ) : (
                <video
                  src={item.url}
                  className="h-36 w-full rounded-md object-cover"
                  controls
                />
              )}
              <div className="mt-2 text-[10px] text-muted-foreground">
                {t(`type.${item.type === "video" ? "video" : "image"}`)} · {t("post")} <bdi>{item.postId.slice(0, 8)}</bdi>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
