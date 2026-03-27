"use client"

import type { ComposerMediaItem } from "@/store/socialComposerStore"

interface InstagramPreviewProps {
  displayName: string
  content: string
  media: ComposerMediaItem[]
}

export function InstagramPreview({ displayName, content, media }: InstagramPreviewProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="size-8 rounded-full bg-muted" />
        <span className="text-xs font-semibold">{displayName}</span>
      </div>
      {/* Media (full width) */}
      {media.length > 0 ? (
        <div className="aspect-square bg-muted">
          {media[0].type === "image" && media[0].url && (
            <img src={media[0].url} alt="" className="size-full object-cover" />
          )}
        </div>
      ) : (
        <div className="aspect-square bg-muted" />
      )}
      {/* Engagement */}
      <div className="flex gap-3 px-3 py-2">
        <span className="text-xs">❤️</span>
        <span className="text-xs">💬</span>
        <span className="text-xs">📤</span>
      </div>
      {/* Caption */}
      <div className="px-3 pb-3">
        <p className="text-xs leading-relaxed">
          <span className="font-semibold">{displayName}</span>{" "}
          {content}
        </p>
      </div>
    </div>
  )
}
