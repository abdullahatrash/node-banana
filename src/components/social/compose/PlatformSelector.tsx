"use client"

import Link from "next/link"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@/lib/social/constants"
import { CheckIcon } from "lucide-react"
import type { SocialPlatform } from "@/lib/db/schema"
import { useTranslations } from "next-intl"

export function PlatformSelector() {
  const t = useTranslations("social.compose")
  const accounts = useSocialAccountsStore((s) => s.accounts)
  const { selectedAccountIds, toggleAccount } = useSocialComposerStore()

  const activeAccounts = accounts.filter(
    (a) => !a.disabled && !a.requiresReauth,
  )

  if (activeAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">
          {t("channels.none")} {" "}
          <Link href="/social/channels" className="text-primary underline">
            {t("channels.connect")}
          </Link>{" "}
          {t("channels.start")}
        </p>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-muted-foreground">
        {t("channels.postTo")}
      </label>
      <div className="flex flex-wrap gap-2">
        {activeAccounts.map((account) => {
          const isSelected = selectedAccountIds.includes(account.id)
          const platform = account.platform as SocialPlatform
          const color = PLATFORM_COLORS[platform]

          return (
            <button
              key={account.id}
              onClick={() => toggleAccount(account.id, platform)}
              title={`${PLATFORM_LABELS[platform]}${account.username ? ` · @${account.username}` : ""}`}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                isSelected
                  ? "text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent"
              }`}
              style={
                isSelected
                  ? {
                      borderColor: `${color}50`,
                      backgroundColor: `${color}15`,
                    }
                  : undefined
              }
            >
              <PlatformIcon platform={platform} size={16} />
              <span>{account.displayName}</span>
              {isSelected && <CheckIcon className="size-3" style={{ color }} />}
            </button>
          )
        })}
      </div>
      {selectedAccountIds.length === 0 && (
        <p className="mt-2 text-xs text-destructive">
          {t("channels.required")}
        </p>
      )}
    </div>
  )
}
