"use client"

import type { ComposerMediaItem } from "@/store/socialComposerStore"

interface TikTokPreviewProps {
  displayName: string
  username?: string | null
  content: string
  media: ComposerMediaItem[]
}

export function TikTokPreview({ displayName, username, content, media }: TikTokPreviewProps) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-black" style={{ aspectRatio: "9/14" }}>
      {/* Media background */}
      {media.length > 0 && media[0].type === "image" && media[0].url ? (
        <img src={media[0].url} alt="" className="size-full object-cover opacity-80" />
      ) : (
        <div className="size-full bg-neutral-900" />
      )}

      {/* Overlay content */}
      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 to-transparent p-3">
        <p className="text-[10px] font-medium text-white">
          @{username || displayName}
        </p>
        <p className="mt-0.5 line-clamp-3 text-[10px] leading-relaxed text-white/80">
          {content}
        </p>
      </div>

      {/* Right sidebar engagement */}
      <div className="absolute bottom-8 right-2 flex flex-col items-center gap-3">
        <div className="flex flex-col items-center">
          <div className="flex size-7 items-center justify-center rounded-full bg-white/20 text-[10px] text-white">
            ❤️
          </div>
          <span className="mt-0.5 text-[8px] text-white/70">1.2K</span>
        </div>
        <div className="flex flex-col items-center">
          <div className="flex size-7 items-center justify-center rounded-full bg-white/20 text-[10px] text-white">
            💬
          </div>
          <span className="mt-0.5 text-[8px] text-white/70">48</span>
        </div>
        <div className="flex flex-col items-center">
          <div className="flex size-7 items-center justify-center rounded-full bg-white/20 text-[10px] text-white">
            ↗
          </div>
          <span className="mt-0.5 text-[8px] text-white/70">12</span>
        </div>
      </div>
    </div>
  )
}
