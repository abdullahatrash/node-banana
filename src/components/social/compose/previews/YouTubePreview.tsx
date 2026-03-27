"use client"

import type { ComposerMediaItem } from "@/store/socialComposerStore"

interface YouTubePreviewProps {
  displayName: string
  content: string
  media: ComposerMediaItem[]
}

export function YouTubePreview({ displayName, content, media }: YouTubePreviewProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* Video thumbnail */}
      <div className="relative aspect-video bg-muted">
        {media.length > 0 && media[0].url && (
          <img src={media[0].url} alt="" className="size-full object-cover" />
        )}
        <div className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[9px] text-white">
          0:00
        </div>
      </div>
      {/* Info */}
      <div className="flex gap-2.5 p-3">
        <div className="size-8 flex-shrink-0 rounded-full bg-muted" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-medium leading-snug">
            {content || "Untitled video"}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {displayName}
          </p>
          <p className="text-[10px] text-muted-foreground">
            0 views · Just now
          </p>
        </div>
      </div>
    </div>
  )
}
