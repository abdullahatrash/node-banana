"use client"

import type { ComposerMediaItem } from "@/store/socialComposerStore"
import { useTranslations } from "next-intl"

interface MastodonPreviewProps {
  displayName: string
  username?: string | null
  content: string
  media: ComposerMediaItem[]
}

export function MastodonPreview({
  displayName,
  username,
  content,
  media,
}: MastodonPreviewProps) {
  const t = useTranslations("social.preview")
  const images = media.filter((m) => m.type === "image").slice(0, 4)

  return (
    <div className="overflow-hidden rounded-lg border bg-card p-3">
      <div className="flex gap-2.5">
        <div className="size-9 flex-shrink-0 rounded-full bg-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col">
            <bdi className="text-xs font-semibold">{displayName}</bdi>
            <span className="text-[10px] text-muted-foreground">
              <bdi dir="ltr">{username ? `@${username}` : ""}</bdi>
            </span>
          </div>
          <p dir="auto" className="mt-2 whitespace-pre-line text-xs leading-relaxed">
            {content}
          </p>
          {images.length > 0 && (
            <div
              className={`mt-2 overflow-hidden rounded-xl ${
                images.length === 1
                  ? ""
                  : "grid grid-cols-2 gap-px"
              }`}
            >
              {images.map((img, i) => (
                <div
                  key={i}
                  className={`bg-muted ${
                    images.length === 1 ? "aspect-video" : "aspect-square"
                  }`}
                >
                  {img.url && (
                    <img
                      src={img.url}
                      alt={img.alt || ""}
                      className="size-full object-cover"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-6 text-[10px] text-muted-foreground">
            <span>{t("reply")}</span>
            <span>{t("boost")}</span>
            <span>{t("favourite")}</span>
            <span>{t("bookmark")}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
