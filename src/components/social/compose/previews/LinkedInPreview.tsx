"use client"

import type { ComposerMediaItem } from "@/store/socialComposerStore"
import { useTranslations } from "next-intl"

interface LinkedInPreviewProps {
  displayName: string
  content: string
  media: ComposerMediaItem[]
}

export function LinkedInPreview({ displayName, content, media }: LinkedInPreviewProps) {
  const t = useTranslations("social.preview")
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 pt-3">
        <div className="size-10 rounded-full bg-muted" />
        <div>
          <p className="text-xs font-semibold">{displayName}</p>
          <p className="text-[10px] text-muted-foreground">{t("linkedin")} · {t("justNow")}</p>
        </div>
      </div>
      {/* Content */}
      <div className="px-3 py-2">
        <p className="whitespace-pre-line text-xs leading-relaxed">{content}</p>
      </div>
      {/* Media */}
      {media.length > 0 && (
        <div className={media.length === 1 ? "" : "grid grid-cols-2 gap-px"}>
          {media.slice(0, 4).map((m, i) => (
            <div key={i} className="aspect-video bg-muted">
              {m.type === "image" && m.url && (
                <img src={m.url} alt="" className="size-full object-cover" />
              )}
            </div>
          ))}
        </div>
      )}
      {/* Engagement */}
      <div className="flex gap-4 border-t px-3 py-2 text-[10px] text-muted-foreground">
        <span>{t("like")}</span>
        <span>{t("comment")}</span>
        <span>{t("repost")}</span>
        <span>{t("send")}</span>
      </div>
    </div>
  )
}
