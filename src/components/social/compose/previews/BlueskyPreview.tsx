"use client"

import type { ComposerMediaItem } from "@/store/socialComposerStore"

interface BlueskyPreviewProps {
  displayName: string
  username?: string | null
  content: string
  media: ComposerMediaItem[]
}

export function BlueskyPreview({
  displayName,
  username,
  content,
  media,
}: BlueskyPreviewProps) {
  const images = media.filter((m) => m.type === "image").slice(0, 4)

  return (
    <div className="overflow-hidden rounded-lg border bg-card p-3">
      <div className="flex gap-2.5">
        <div className="size-9 flex-shrink-0 rounded-full bg-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold">{displayName}</span>
            <span className="text-[10px] text-muted-foreground">
              {username ? `@${username}` : ""}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed">
            {content}
          </p>
          {images.length > 0 && (
            <div
              className={`mt-2 overflow-hidden rounded-xl ${
                images.length === 1
                  ? ""
                  : images.length === 3
                    ? "grid grid-cols-2 gap-px"
                    : "grid grid-cols-2 gap-px"
              }`}
            >
              {images.map((img, i) => (
                <div
                  key={i}
                  className={`bg-muted ${
                    images.length === 1
                      ? "aspect-video"
                      : images.length === 3 && i === 0
                        ? "row-span-2 aspect-square"
                        : "aspect-square"
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
            <span>Reply</span>
            <span>Repost</span>
            <span>Like</span>
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  )
}
