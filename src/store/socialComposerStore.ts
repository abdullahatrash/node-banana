"use client"

import { create } from "zustand"
import type { SocialPlatform } from "@/lib/db/schema"
import { getPublishingSettingsDefinition } from "@/lib/social/publishing-settings"

export interface ComposerMediaItem {
  assetId?: string
  resourceKind?: "studio_asset" | "artifact"
  assetDigest?: string
  type: "image" | "video"
  url: string
  alt?: string
  mimeType?: string
}

interface SocialComposerState {
  // Content
  content: string
  selectedAccountIds: string[]
  mediaUrls: ComposerMediaItem[]
  scheduledAt: Date | null
  platformSettings: Record<string, Record<string, unknown>>

  // Edit mode
  postId: string | null
  editSourceAccountId: string | null
  isDirty: boolean
  autoSaveTimer: ReturnType<typeof setTimeout> | null

  // Actions
  setContent: (content: string) => void
  toggleAccount: (accountId: string, platform?: SocialPlatform) => void
  setSelectedAccounts: (accountIds: string[]) => void
  addMedia: (media: ComposerMediaItem[]) => void
  removeMedia: (index: number) => void
  reorderMedia: (fromIndex: number, toIndex: number) => void
  setScheduledAt: (date: Date | null) => void
  setPlatformSettings: (
    accountId: string,
    settings: Record<string, unknown>,
  ) => void
  hydratePlatformSettings: (
    accountId: string,
    platform: SocialPlatform,
  ) => void
  markDirty: () => void
  reset: () => void
  loadDraft: (draft: {
    postId: string
    content?: string | null
    mediaUrls?: ComposerMediaItem[] | null
    stableMediaRefs?: Array<{ assetId: string; assetDigest: string; order: number; resourceKind?: "studio_asset" | "artifact" }> | null
    platformSettings?: Record<string, unknown> | null
    scheduledAt?: string | null
    socialAccountId: string
  }) => void
}

const INITIAL_STATE = {
  content: "",
  selectedAccountIds: [],
  mediaUrls: [],
  scheduledAt: null,
  platformSettings: {},
  postId: null,
  editSourceAccountId: null,
  isDirty: false,
  autoSaveTimer: null,
}

export const useSocialComposerStore = create<SocialComposerState>(
  (set, get) => ({
    ...INITIAL_STATE,

    setContent: (content) => {
      set({ content, isDirty: true })
    },

    toggleAccount: (accountId, platform) => {
      set((state) => {
        const exists = state.selectedAccountIds.includes(accountId)
        const nextSettings = { ...state.platformSettings }
        if (!exists && platform && !nextSettings[accountId]) {
          try {
            const definition = getPublishingSettingsDefinition(platform)
            nextSettings[accountId] = definition.normalize(definition.defaults)
          } catch {
            // Some platforms do not need Publishing Settings yet.
          }
        }
        return {
          selectedAccountIds: exists
            ? state.selectedAccountIds.filter((id) => id !== accountId)
            : [...state.selectedAccountIds, accountId],
          platformSettings: nextSettings,
          isDirty: true,
        }
      })
    },

    setSelectedAccounts: (accountIds) => {
      set({ selectedAccountIds: accountIds, isDirty: true })
    },

    addMedia: (media) => {
      set((state) => ({
        mediaUrls: [...state.mediaUrls, ...media],
        isDirty: true,
      }))
    },

    removeMedia: (index) => {
      set((state) => ({
        mediaUrls: state.mediaUrls.filter((_, i) => i !== index),
        isDirty: true,
      }))
    },

    reorderMedia: (fromIndex, toIndex) => {
      set((state) => {
        const items = [...state.mediaUrls]
        const [moved] = items.splice(fromIndex, 1)
        items.splice(toIndex, 0, moved)
        return { mediaUrls: items, isDirty: true }
      })
    },

    setScheduledAt: (date) => {
      set({ scheduledAt: date, isDirty: true })
    },

    setPlatformSettings: (accountId, settings) => {
      set((state) => ({
        platformSettings: {
          ...state.platformSettings,
          [accountId]: settings,
        },
        isDirty: true,
      }))
    },

    hydratePlatformSettings: (accountId, platform) => {
      set((state) => {
        if (state.platformSettings[accountId]) return state
        try {
          const definition = getPublishingSettingsDefinition(platform)
          return {
            platformSettings: {
              ...state.platformSettings,
              [accountId]: definition.normalize(definition.defaults),
            },
          }
        } catch {
          return state
        }
      })
    },

    markDirty: () => set({ isDirty: true }),

    reset: () => {
      const timer = get().autoSaveTimer
      if (timer) clearTimeout(timer)
      set({ ...INITIAL_STATE })
    },

    loadDraft: (draft) => {
      set({
        postId: draft.postId,
        editSourceAccountId: draft.socialAccountId,
        content: draft.content ?? "",
        mediaUrls: (draft.mediaUrls ?? []).map((media, order) => ({
          ...media,
          assetId: media.assetId || draft.stableMediaRefs?.find((reference) => reference.order === order)?.assetId || "",
          resourceKind: media.resourceKind || draft.stableMediaRefs?.find((reference) => reference.order === order)?.resourceKind || "studio_asset",
          assetDigest: media.assetDigest || draft.stableMediaRefs?.find((reference) => reference.order === order)?.assetDigest,
        })),
        platformSettings: draft.platformSettings
          ? { [draft.socialAccountId]: draft.platformSettings }
          : {},
        scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt) : null,
        selectedAccountIds: [draft.socialAccountId],
        isDirty: false,
      })
    },
  }),
)
