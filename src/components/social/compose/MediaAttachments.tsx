"use client"

import { useSocialComposerStore } from "@/store/socialComposerStore"
import { XIcon, ImagePlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"

interface MediaAttachmentsProps {
  onOpenMediaPool?: () => void
}

export function MediaAttachments({ onOpenMediaPool }: MediaAttachmentsProps) {
  const t = useTranslations("social.compose")
  const { mediaUrls, removeMedia } = useSocialComposerStore()

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-muted-foreground">
        {t("media.label")}
      </label>
      <div className="flex flex-wrap gap-2">
        {mediaUrls.map((item, index) => (
          <div
            key={`${item.url}-${index}`}
            className="group relative size-20 overflow-hidden rounded-lg border border-border bg-muted"
          >
            {item.type === "image" ? (
              <img
                src={item.url}
                alt={item.alt || ""}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                {t("media.video")}
              </div>
            )}
            <button
              onClick={() => removeMedia(index)}
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label={t("media.remove", { number: index + 1 })}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ))}

        <Button
          variant="outline"
          className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border-dashed"
          onClick={onOpenMediaPool}
        >
          <ImagePlusIcon className="size-4 text-muted-foreground" />
          <span className="text-[9px] text-muted-foreground">{t("media.add")}</span>
        </Button>
      </div>
    </div>
  )
}
