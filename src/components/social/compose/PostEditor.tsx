"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { listSocialProviders } from "@/lib/social/client"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import type { SocialPlatform } from "@/lib/db/schema"
import type { ProviderCapabilities } from "@/lib/social/provider-interface"

export function PostEditor() {
  const { content, setContent, selectedAccountIds } = useSocialComposerStore()
  const accounts = useSocialAccountsStore((s) => s.accounts)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [providers, setProviders] = useState<ProviderCapabilities[]>([])

  useEffect(() => {
    listSocialProviders().then(setProviders).catch(() => {})
  }, [])

  // Auto-grow textarea
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = "auto"
      ta.style.height = `${Math.max(160, ta.scrollHeight)}px`
    }
  }, [])

  useEffect(() => {
    adjustHeight()
  }, [content, adjustHeight])

  // Get char limits for selected platforms
  const selectedPlatforms = selectedAccountIds
    .map((id) => accounts.find((a) => a.id === id))
    .filter(Boolean)
    .map((a) => {
      const provider = providers.find(
        (p) => p.identifier === a!.platform,
      )
      return {
        platform: a!.platform as SocialPlatform,
        displayName: a!.displayName,
        maxLength: provider?.maxContentLength ?? 0,
      }
    })

  const charCount = content.length

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-muted-foreground">
        Content
      </label>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What's on your mind?"
        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{ minHeight: 160 }}
      />

      {/* Per-platform character counts */}
      {selectedPlatforms.length > 0 && charCount > 0 && (
        <div className="mt-2 flex flex-wrap gap-3">
          {selectedPlatforms.map((p) => {
            if (!p.maxLength) return null
            const ratio = charCount / p.maxLength
            const colorClass =
              ratio > 1
                ? "text-destructive"
                : ratio > 0.8
                  ? "text-amber-500"
                  : "text-muted-foreground"

            return (
              <div
                key={p.platform}
                className={`flex items-center gap-1.5 text-[10px] ${colorClass}`}
              >
                <PlatformIcon platform={p.platform} size={12} />
                <span>
                  {charCount.toLocaleString()} / {p.maxLength.toLocaleString()}
                </span>
                {ratio > 1 && <span className="font-medium">over</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
