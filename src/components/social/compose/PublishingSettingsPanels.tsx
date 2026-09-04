"use client"

import { useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import type { ReactNode } from "react"
import type { SocialPlatform } from "@/lib/db/schema"
import { getPublishingSettingsDefinition } from "@/lib/social/publishing-settings"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import { StatusDot } from "@/components/social/shared/StatusDot"
import { Input } from "@/components/ui/input"

type SettingsValue = Record<string, unknown>

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function asBoolean(value: unknown) {
  return value === true
}

function tagsToInput(value: unknown) {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string").join(", ")
    : ""
}

function inputToTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="block text-[11px] font-medium text-muted-foreground">
      {children}
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {children}
      </select>
    </div>
  )
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-input"
      />
      <span>{label}</span>
    </label>
  )
}

function YouTubeSettings({
  settings,
  update,
}: {
  settings: SettingsValue
  update: (patch: SettingsValue) => void
}) {
  const t = useTranslations("social.publishingSettings")
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <FieldLabel>{t("title")}</FieldLabel>
        <Input
          value={asString(settings.title)}
          onChange={(event) => update({ title: event.target.value })}
          maxLength={100}
        />
      </div>
      <SelectField
        label={t("privacy")}
        value={asString(settings.privacyStatus) || "private"}
        onChange={(privacyStatus) => update({ privacyStatus })}
      >
        <option value="private">{t("visibility.private")}</option>
        <option value="unlisted">{t("visibility.unlisted")}</option>
        <option value="public">{t("visibility.public")}</option>
      </SelectField>
      <div className="space-y-1.5">
        <FieldLabel>{t("tags")}</FieldLabel>
        <Input
          value={tagsToInput(settings.tags)}
          onChange={(event) => update({ tags: inputToTags(event.target.value) })}
        />
      </div>
      <CheckboxField
        label={t("madeForKids")}
        checked={asBoolean(settings.madeForKids)}
        onChange={(madeForKids) => update({ madeForKids })}
      />
    </div>
  )
}

function TikTokSettings({
  settings,
  update,
}: {
  settings: SettingsValue
  update: (patch: SettingsValue) => void
}) {
  const t = useTranslations("social.publishingSettings")
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField
        label={t("visibilityLabel")}
        value={asString(settings.privacyLevel) || "SELF_ONLY"}
        onChange={(privacyLevel) => update({ privacyLevel })}
      >
        <option value="SELF_ONLY">{t("visibility.onlyMe")}</option>
        <option value="FOLLOWER_OF_CREATOR">{t("visibility.followers")}</option>
        <option value="MUTUAL_FOLLOW_FRIENDS">{t("visibility.mutualFriends")}</option>
        <option value="PUBLIC_TO_EVERYONE">{t("visibility.public")}</option>
      </SelectField>
      <SelectField
        label={t("postingMethod")}
        value={asString(settings.contentPostingMethod) || "UPLOAD"}
        onChange={(contentPostingMethod) => update({ contentPostingMethod })}
      >
        <option value="UPLOAD">{t("methods.upload")}</option>
        <option value="DIRECT_POST">{t("methods.direct")}</option>
      </SelectField>
      <CheckboxField
        label={t("allowComments")}
        checked={settings.allowComments !== false}
        onChange={(allowComments) => update({ allowComments })}
      />
      <CheckboxField
        label={t("allowDuet")}
        checked={asBoolean(settings.allowDuet)}
        onChange={(allowDuet) => update({ allowDuet })}
      />
      <CheckboxField
        label={t("allowStitch")}
        checked={asBoolean(settings.allowStitch)}
        onChange={(allowStitch) => update({ allowStitch })}
      />
      <CheckboxField
        label={t("autoAddMusic")}
        checked={asBoolean(settings.autoAddMusic)}
        onChange={(autoAddMusic) => update({ autoAddMusic })}
      />
      <CheckboxField
        label={t("videoMadeWithAi")}
        checked={asBoolean(settings.videoMadeWithAi)}
        onChange={(videoMadeWithAi) => update({ videoMadeWithAi })}
      />
      <CheckboxField
        label={t("brandedContent")}
        checked={asBoolean(settings.brandedContent)}
        onChange={(brandedContent) => update({ brandedContent })}
      />
      <CheckboxField
        label={t("yourBrand")}
        checked={asBoolean(settings.yourBrand)}
        onChange={(yourBrand) => update({ yourBrand })}
      />
    </div>
  )
}

function RedditSettings({
  settings,
  update,
}: {
  settings: SettingsValue
  update: (patch: SettingsValue) => void
}) {
  const t = useTranslations("social.publishingSettings")
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <FieldLabel>{t("subreddit")}</FieldLabel>
        <Input
          value={asString(settings.subreddit)}
          onChange={(event) => update({ subreddit: event.target.value })}
          placeholder={t("subredditPlaceholder")}
          dir="ltr"
        />
      </div>
      <div className="space-y-1.5">
        <FieldLabel>{t("title")}</FieldLabel>
        <Input
          value={asString(settings.title)}
          onChange={(event) => update({ title: event.target.value })}
        />
      </div>
      <SelectField
        label={t("type")}
        value={asString(settings.type) || "self"}
        onChange={(type) => update({ type })}
      >
        <option value="self">{t("types.text")}</option>
        <option value="link">{t("types.link")}</option>
      </SelectField>
      {(settings.type || "self") === "link" && (
        <div className="space-y-1.5">
          <FieldLabel>{t("link")}</FieldLabel>
          <Input
            value={asString(settings.url)}
            onChange={(event) => update({ url: event.target.value })}
            type="url"
          />
        </div>
      )}
    </div>
  )
}

function PlatformSettingsFields({
  platform,
  settings,
  update,
}: {
  platform: SocialPlatform
  settings: SettingsValue
  update: (patch: SettingsValue) => void
}) {
  if (platform === "youtube") {
    return <YouTubeSettings settings={settings} update={update} />
  }
  if (platform === "tiktok") {
    return <TikTokSettings settings={settings} update={update} />
  }
  if (platform === "reddit") {
    return <RedditSettings settings={settings} update={update} />
  }
  if (platform === "mastodon") {
    return <MastodonSettings settings={settings} update={update} />
  }
  return null
}

function MastodonSettings({
  settings,
  update,
}: {
  settings: SettingsValue
  update: (patch: SettingsValue) => void
}) {
  const t = useTranslations("social.publishingSettings")
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField
        label={t("visibilityLabel")}
        value={asString(settings.visibility) || "public"}
        onChange={(visibility) => update({ visibility })}
      >
        <option value="public">{t("visibility.public")}</option>
        <option value="unlisted">{t("visibility.unlisted")}</option>
        <option value="private">{t("visibility.followersOnly")}</option>
        <option value="direct">{t("visibility.mentionedOnly")}</option>
      </SelectField>
      <div className="space-y-1.5">
        <FieldLabel>{t("contentWarning")}</FieldLabel>
        <Input
          value={asString(settings.contentWarning)}
          onChange={(event) => update({ contentWarning: event.target.value })}
          placeholder={t("contentWarningPlaceholder")}
        />
      </div>
    </div>
  )
}

export function PublishingSettingsPanels() {
  const t = useTranslations("social.publishingSettings")
  const accounts = useSocialAccountsStore((state) => state.accounts)
  const {
    selectedAccountIds,
    platformSettings,
    setPlatformSettings,
    hydratePlatformSettings,
  } = useSocialComposerStore()

  const selectedAccounts = useMemo(
    () =>
      selectedAccountIds
        .map((id) => accounts.find((account) => account.id === id))
        .filter(Boolean),
    [accounts, selectedAccountIds],
  )

  const supportedAccounts = useMemo(
    () =>
      selectedAccounts.filter((account) => {
        if (!account) return false
        try {
          getPublishingSettingsDefinition(account.platform as SocialPlatform)
          return true
        } catch {
          return false
        }
      }),
    [selectedAccounts],
  )

  useEffect(() => {
    for (const account of supportedAccounts) {
      if (!account) continue
      hydratePlatformSettings(account.id, account.platform as SocialPlatform)
    }
  }, [hydratePlatformSettings, supportedAccounts])

  if (supportedAccounts.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">
        {t("heading")}
      </div>
      <div className="space-y-2">
        {supportedAccounts.map((account) => {
          if (!account) return null
          const platform = account.platform as SocialPlatform
          const definition = getPublishingSettingsDefinition(platform)
          const settings =
            platformSettings[account.id] ?? definition.normalize(definition.defaults)

          return (
            <details
              key={account.id}
              className="rounded-lg border bg-card p-3"
              open
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <PlatformIcon platform={platform} size={16} />
                  <span className="truncate text-sm font-medium">
                    {account.displayName}
                  </span>
                </span>
                <StatusDot status="connected" size="sm" />
              </summary>
              <div className="mt-3">
                <PlatformSettingsFields
                  platform={platform}
                  settings={settings}
                  update={(patch) =>
                    setPlatformSettings(account.id, {
                      ...settings,
                      ...patch,
                    })
                  }
                />
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
