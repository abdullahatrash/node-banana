"use client"

import type { ComposerMediaItem } from "@/store/socialComposerStore"

interface XPreviewProps {
  displayName: string
  username?: string | null
  content: string
  media: ComposerMediaItem[]
}

export function XPreview({ displayName, username, content, media }: XPreviewProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card p-3">
      <div className="flex gap-2.5">
        <div className="size-9 flex-shrink-0 rounded-full bg-muted" />
        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold">{displayName}</span>
            <span className="text-[10px] text-muted-foreground">
              {username ? `@${username}` : ""} · now
            </span>
          </div>
          {/* Content */}
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed">{content}</p>
          {/* Media */}
          {media.length > 0 && (
            <div
              className={`mt-2 overflow-hidden rounded-xl ${
                media.length === 1
                  ? ""
                  : media.length === 2
                    ? "grid grid-cols-2 gap-px"
                    : "grid grid-cols-2 gap-px"
              }`}
            >
              {media.slice(0, 4).map((m, i) => (
                <div
                  key={i}
                  className={`bg-muted ${
                    media.length === 1 ? "aspect-video" : "aspect-square"
                  }`}
                >
                  {m.type === "image" && m.url && (
                    <img src={m.url} alt="" className="size-full object-cover" />
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Engagement */}
          <div className="mt-2 flex gap-6 text-[10px] text-muted-foreground">
            <span>Reply</span>
            <span>Repost</span>
            <span>Like</span>
            <span>Views</span>
          </div>
        </div>
      </div>
    </div>
  )
}
