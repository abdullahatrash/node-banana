"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { PlusIcon, Loader2Icon } from "lucide-react"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import { PlatformPicker } from "@/components/social/PlatformPicker"
import { ChannelCard } from "@/components/social/ChannelCard"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  handleOAuthCallback,
  selectPage,
} from "@/lib/social/client"
import type { PageInfo } from "@/lib/social/client"
import { useClientErrorPresentation } from "@/hooks/use-client-error-presentation"

interface ChannelsPageClientProps {
  oauthCallback: {
    platform: string
    code: string
    state: string
  } | null
  oauthError?: string | null
}

export function ChannelsPageClient({
  oauthCallback,
  oauthError,
}: ChannelsPageClientProps) {
  const t = useTranslations("social.channels.page")
  const router = useRouter()
  const { accounts, isLoading, fetchAccounts } = useSocialAccountsStore()
  const [showPicker, setShowPicker] = useState(false)
  const [isProcessingCallback, setIsProcessingCallback] = useState(!!oauthCallback)
  const [pageSelection, setPageSelection] = useState<{
    pages: PageInfo[]
    platform: string
    selectionSessionId: string
  } | null>(null)
  const { show: showToast } = useToast()
  const { present: presentClientError, show: showClientError } = useClientErrorPresentation()
  const initialized = useRef(false)

  function notifyOpener(success: boolean, message: string) {
    if (typeof window === "undefined" || !window.opener) {
      return false
    }

    window.opener.postMessage(
      {
        type: "social-oauth-complete",
        success,
        message,
      },
      window.location.origin,
    )
    window.close()
    return true
  }

  const processOAuthCallback = useCallback(
    async (platform: string, code: string, state: string) => {
      try {
        const result = await handleOAuthCallback(platform, code, state)

        if (
          result.requiresPageSelection &&
          result.pages &&
          result.selectionSessionId
        ) {
          setPageSelection({
            pages: result.pages,
            platform,
            selectionSessionId: result.selectionSessionId,
          })
        } else if (result.requiresPageSelection) {
          throw new Error("CHANNEL_PAGE_SELECTION_MISSING")
        } else {
          if (notifyOpener(true, t("connected"))) {
            return
          }
          showToast(t("connected"), "success")
          fetchAccounts()
        }

        // Clean URL params
        router.replace("/social/channels")
      } catch (error) {
        const fallback = error instanceof Error && error.message === "CHANNEL_PAGE_SELECTION_MISSING"
          ? t("errors.missingSelection")
          : t("errors.complete")
        const presentation = presentClientError(error, fallback)
        const message = presentation.message
        if (notifyOpener(false, message)) {
          return
        }
        showToast(message, "error")
        router.replace("/social/channels")
      } finally {
        setIsProcessingCallback(false)
      }
    },
    [fetchAccounts, presentClientError, router, showToast, t],
  )

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    if (oauthCallback) {
      void processOAuthCallback(
        oauthCallback.platform,
        oauthCallback.code,
        oauthCallback.state,
      )
      return
    }

    setIsProcessingCallback(false)
    if (oauthError) {
      const message = t("errors.complete")
      if (notifyOpener(false, message)) {
        return
      }
      showToast(message, "error")
      router.replace("/social/channels")
    }
  }, [oauthCallback, oauthError, processOAuthCallback, router, showToast, t])

  async function handlePageSelect(page: PageInfo) {
    if (!pageSelection) return
    try {
      await selectPage(
        pageSelection.platform,
        page.id,
        pageSelection.selectionSessionId,
      )
      if (notifyOpener(true, t("pageConnected", { name: page.name }))) {
        return
      }
      showToast(t("pageConnected", { name: page.name }), "success")
      fetchAccounts()
      setPageSelection(null)
    } catch (error) {
      showClientError(showToast, error, t("errors.selectPage"))
    }
  }

  // Processing callback
  if (isProcessingCallback) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2Icon className="mx-auto mb-3 size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("completing")}</p>
        </div>
      </div>
    )
  }

  // Empty state
  if (!isLoading && accounts.length === 0) {
    return (
      <>
        <div className="flex h-full items-center justify-center">
          <div className="max-w-sm text-center">
            <h2 className="mb-2 text-lg font-semibold">
              {t("emptyTitle")}
            </h2>
            <p className="mb-6 text-sm text-muted-foreground">
              {t("emptyDescription")}
            </p>
            <Button onClick={() => setShowPicker(true)}>
              <PlusIcon className="size-4" />
              {t("connect")}
            </Button>
            <Link href="/channels/onboarding" className="ms-2 inline-flex min-h-9 items-center rounded-md border px-4 text-sm font-medium">{t("managedOnboarding")}</Link>
          </div>
        </div>
        <PlatformPicker open={showPicker} onOpenChange={setShowPicker} />
      </>
    )
  }

  // Connected channels
  return (
    <>
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t("title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("description")}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowPicker(true)}>
            <PlusIcon className="size-4" />
            {t("connect")}
          </Button>
          <Link href="/channels/onboarding" className="inline-flex min-h-8 items-center rounded-md border px-3 text-sm font-medium">{t("managedOnboarding")}</Link>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <ChannelCard key={account.id} account={account} />
          ))}
        </div>
      </div>

      <PlatformPicker open={showPicker} onOpenChange={setShowPicker} />

      {/* Page selection dialog (two-step auth) */}
      <Dialog open={!!pageSelection} onOpenChange={() => setPageSelection(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("selectAccount")}</DialogTitle>
            <DialogDescription>
              {t("selectAccountDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto">
            {pageSelection?.pages.map((page) => (
              <button
                key={page.id}
                onClick={() => handlePageSelect(page)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start transition-colors hover:bg-accent"
              >
                {page.picture ? (
                  <img
                    src={page.picture}
                    alt={page.name}
                    className="size-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs">
                    {page.name[0]}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium">{page.name}</p>
                  {page.username && (
                    <p className="text-xs text-muted-foreground"><bdi>@{page.username}</bdi></p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
