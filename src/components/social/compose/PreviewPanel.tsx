"use client"

import { useSocialComposerStore } from "@/store/socialComposerStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import { LinkedInPreview } from "./previews/LinkedInPreview"
import { XPreview } from "./previews/XPreview"
import { InstagramPreview } from "./previews/InstagramPreview"
import { FacebookPreview } from "./previews/FacebookPreview"
import { TikTokPreview } from "./previews/TikTokPreview"
import { YouTubePreview } from "./previews/YouTubePreview"
import { useTranslations } from "next-intl"
import { BlueskyPreview } from "./previews/BlueskyPreview"
import { MastodonPreview } from "./previews/MastodonPreview"
import type { SocialPlatform } from "@/lib/db/schema"

const PREVIEW_COMPONENTS: Record<
  string,
  React.ComponentType<{
    displayName: string
    username?: string | null
    content: string
    media: { type: "image" | "video"; url: string; alt?: string; mimeType?: string }[]
  }>
> = {
  linkedin: LinkedInPreview,
  x: XPreview,
  instagram: InstagramPreview,
  facebook: FacebookPreview,
  tiktok: TikTokPreview,
  youtube: YouTubePreview,
  bluesky: BlueskyPreview,
  mastodon: MastodonPreview,
}

export function PreviewPanel() {
  const t = useTranslations("social.compose")
  const platformT = useTranslations("social.platforms")
  const { content, selectedAccountIds, mediaUrls } = useSocialComposerStore()
  const accounts = useSocialAccountsStore((s) => s.accounts)

  if (selectedAccountIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-center text-xs text-muted-foreground">
          {t("preview.selectChannel")}
        </p>
      </div>
    )
  }

  if (content.trim().length === 0 && mediaUrls.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-center text-xs text-muted-foreground">
          {t("preview.startTyping")}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
      <h3 className="text-xs font-medium text-muted-foreground">
        {t("preview.title")}
      </h3>

      {selectedAccountIds.map((accountId) => {
        const account = accounts.find((a) => a.id === accountId)
        if (!account) return null

        const platform = account.platform as SocialPlatform
        const PreviewComponent = PREVIEW_COMPONENTS[platform]

        if (!PreviewComponent) {
          return (
            <div key={accountId} className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <PlatformIcon platform={platform} size={14} />
                <span>
                  {t("preview.unavailable", { platform: platformT(platform) })}
                </span>
              </div>
            </div>
          )
        }

        return (
          <div key={accountId}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <PlatformIcon platform={platform} size={12} />
              <span className="text-[10px] font-medium text-muted-foreground">
                {platformT(platform)}
              </span>
            </div>
            <PreviewComponent
              displayName={account.displayName}
              username={account.username}
              content={content}
              media={mediaUrls}
            />
          </div>
        )
      })}
    </div>
  )
}
