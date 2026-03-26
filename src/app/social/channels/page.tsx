"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
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

export default function ChannelsPage() {
  const { accounts, isLoading, fetchAccounts } = useSocialAccountsStore()
  const [showPicker, setShowPicker] = useState(false)
  const [isProcessingCallback, setIsProcessingCallback] = useState(false)
  const [pageSelection, setPageSelection] = useState<{
    pages: PageInfo[]
    platform: string
    selectionSessionId: string
  } | null>(null)
  const { show: showToast } = useToast()
  const searchParams = useSearchParams()

  useEffect(() => {
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    const platform = searchParams.get("platform")
    const oauthToken = searchParams.get("oauth_token")
    const oauthVerifier = searchParams.get("oauth_verifier")

    if ((code && state) || (oauthToken && oauthVerifier)) {
      processOAuthCallback(
        platform || "",
        code || oauthVerifier || "",
        state || oauthToken || "",
      )
    }
  }, [])

  async function processOAuthCallback(
    platform: string,
    code: string,
    state: string,
  ) {
    setIsProcessingCallback(true)
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
        throw new Error("Missing secure selection session. Please reconnect.")
      } else {
        showToast("Channel connected successfully!", "success")
        fetchAccounts()
      }

      window.history.replaceState({}, "", "/social/channels")
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to complete connection",
        "error",
      )
      window.history.replaceState({}, "", "/social/channels")
    } finally {
      setIsProcessingCallback(false)
    }
  }

  async function handlePageSelect(page: PageInfo) {
    if (!pageSelection) return
    try {
      await selectPage(
        pageSelection.platform,
        page.id,
        pageSelection.selectionSessionId,
      )
      showToast(`Connected to ${page.name}!`, "success")
      fetchAccounts()
      setPageSelection(null)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to select page",
        "error",
      )
    }
  }

  // Processing callback
  if (isProcessingCallback) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2Icon className="mx-auto mb-3 size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Completing connection...</p>
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
              Connect your first channel
            </h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Link your social accounts to start scheduling and publishing
              content directly from ContentOS.
            </p>
            <Button onClick={() => setShowPicker(true)}>
              <PlusIcon className="size-4" />
              Connect Channel
            </Button>
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
            <h2 className="text-lg font-semibold">Connected Channels</h2>
            <p className="text-sm text-muted-foreground">
              Manage your social media accounts and connections
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowPicker(true)}>
            <PlusIcon className="size-4" />
            Connect Channel
          </Button>
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
            <DialogTitle>Select an account</DialogTitle>
            <DialogDescription>
              Choose which page or account to post as
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto">
            {pageSelection?.pages.map((page) => (
              <button
                key={page.id}
                onClick={() => handlePageSelect(page)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
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
                    <p className="text-xs text-muted-foreground">@{page.username}</p>
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
