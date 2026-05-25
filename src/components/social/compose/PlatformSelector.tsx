"use client"

import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@/lib/social/constants"
import { CheckIcon } from "lucide-react"
import type { SocialPlatform } from "@/lib/db/schema"

export function PlatformSelector() {
  const accounts = useSocialAccountsStore((s) => s.accounts)
  const { selectedAccountIds, toggleAccount } = useSocialComposerStore()

  const activeAccounts = accounts.filter(
    (a) => !a.disabled && !a.requiresReauth,
  )

  if (activeAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">
          No channels connected.{" "}
          <a href="/social/channels" className="text-primary underline">
            Connect one
          </a>{" "}
          to start posting.
        </p>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-muted-foreground">
        Post to
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
          Select at least one channel to publish
        </p>
      )}
    </div>
  )
}
