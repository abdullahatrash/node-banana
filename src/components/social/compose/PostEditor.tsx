"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { listSocialProviders } from "@/lib/social/client"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import type { SocialPlatform } from "@/lib/db/schema"
import { useFormatter, useTranslations } from "next-intl"
import type { ProviderCapabilities } from "@/lib/social/provider-interface"

// Module-level cache — fetched once per page load, reused across renders
let providerCache: ProviderCapabilities[] | null = null
let providerFetchPromise: Promise<ProviderCapabilities[]> | null = null

function useProviders(): ProviderCapabilities[] {
  const [providers, setProviders] = useState<ProviderCapabilities[]>(
    providerCache ?? [],
  )

  if (!providerCache && !providerFetchPromise) {
    providerFetchPromise = listSocialProviders().then((data) => {
      providerCache = data
      return data
    })
  }

  // Only fetch once, use cache after
  if (!providerCache && providerFetchPromise) {
    providerFetchPromise.then(setProviders).catch(() => {})
  }

  return providers
}

export function PostEditor() {
  const t = useTranslations("social.compose")
  const format = useFormatter()
  const content = useSocialComposerStore((s) => s.content)
  const setContent = useSocialComposerStore((s) => s.setContent)
  const selectedAccountIds = useSocialComposerStore((s) => s.selectedAccountIds)
  const accounts = useSocialAccountsStore((s) => s.accounts)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const providers = useProviders()

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

  // Derive char limit data from current state — no effect needed
  const charData = useMemo(() => {
    return selectedAccountIds
      .map((id) => {
        const account = accounts.find((a) => a.id === id)
        if (!account) return null
        const provider = providers.find((p) => p.identifier === account.platform)
        if (!provider?.maxContentLength) return null
        return {
          platform: account.platform as SocialPlatform,
          maxLength: provider.maxContentLength,
        }
      })
      .filter(Boolean) as Array<{ platform: SocialPlatform; maxLength: number }>
  }, [selectedAccountIds, accounts, providers])

  const charCount = content.length

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-muted-foreground">
        {t("content.label")}
      </label>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("content.placeholder")}
        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{ minHeight: 160 }}
      />

      {charData.length > 0 && charCount > 0 && (
        <div className="mt-2 flex flex-wrap gap-3">
          {charData.map((p) => {
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
                  <bdi>{format.number(charCount)} / {format.number(p.maxLength)}</bdi>
                </span>
                {ratio > 1 && <span className="font-medium">{t("content.over")}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
