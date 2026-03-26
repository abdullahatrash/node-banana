"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSocialAccountsStore } from "@/store/socialAccountsStore";
import { PlatformPicker } from "@/components/social/PlatformPicker";
import { ChannelCard } from "@/components/social/ChannelCard";
import { useToast } from "@/components/Toast";
import {
  handleOAuthCallback,
  selectPage,
} from "@/lib/social/client";
import type { PageInfo } from "@/lib/social/client";

export default function ChannelsPage() {
  const { accounts, isLoading, fetchAccounts } = useSocialAccountsStore();
  const [showPicker, setShowPicker] = useState(false);
  const [isProcessingCallback, setIsProcessingCallback] = useState(false);
  const [pageSelection, setPageSelection] = useState<{
    pages: PageInfo[];
    platform: string;
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  } | null>(null);
  const { show: showToast } = useToast();
  const searchParams = useSearchParams();

  // Handle OAuth callback params on mount
  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const platform = searchParams.get("platform");
    // X uses oauth_token / oauth_verifier
    const oauthToken = searchParams.get("oauth_token");
    const oauthVerifier = searchParams.get("oauth_verifier");

    if ((code && state) || (oauthToken && oauthVerifier)) {
      processOAuthCallback(
        platform || "",
        code || oauthVerifier || "",
        state || oauthToken || "",
      );
    }
  }, []);

  async function processOAuthCallback(
    platform: string,
    code: string,
    state: string,
  ) {
    setIsProcessingCallback(true);
    try {
      const result = await handleOAuthCallback(platform, code, state);

      if (result.requiresPageSelection && result.pages) {
        setPageSelection({
          pages: result.pages,
          platform,
          accessToken: (result.account as any)?.accessToken ?? "",
          refreshToken: (result.account as any)?.refreshToken,
          expiresIn: (result.account as any)?.expiresIn,
        });
      } else {
        showToast("Channel connected successfully!", "success");
        fetchAccounts();
      }

      // Clean up URL params
      window.history.replaceState({}, "", "/social/channels");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to complete connection",
        "error",
      );
      window.history.replaceState({}, "", "/social/channels");
    } finally {
      setIsProcessingCallback(false);
    }
  }

  async function handlePageSelect(page: PageInfo) {
    if (!pageSelection) return;
    try {
      await selectPage(
        pageSelection.platform,
        page.id,
        pageSelection.accessToken,
        pageSelection.refreshToken,
        pageSelection.expiresIn,
      );
      showToast(`Connected to ${page.name}!`, "success");
      fetchAccounts();
      setPageSelection(null);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to select page",
        "error",
      );
    }
  }

  // Loading / processing state
  if (isProcessingCallback) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mb-3 text-3xl">🔗</div>
          <div className="text-sm text-neutral-300">
            Completing connection...
          </div>
          <div className="mt-2 h-1 w-32 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-green-500" />
          </div>
        </div>
      </div>
    );
  }

  // Page selection modal (two-step auth)
  if (pageSelection) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-800 shadow-xl">
          <div className="border-b border-neutral-700 px-5 py-4">
            <h2 className="text-base font-semibold text-neutral-100">
              Select an account
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Choose which page or account to post as
            </p>
          </div>
          <div className="max-h-64 overflow-y-auto p-3">
            {pageSelection.pages.map((page) => (
              <button
                key={page.id}
                onClick={() => handlePageSelect(page)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-neutral-700"
              >
                {page.picture ? (
                  <img
                    src={page.picture}
                    alt={page.name}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-700 text-xs text-neutral-400">
                    {page.name[0]}
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium text-neutral-100">
                    {page.name}
                  </div>
                  {page.username && (
                    <div className="text-xs text-neutral-500">
                      @{page.username}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
          <div className="border-t border-neutral-700 px-5 py-3">
            <button
              onClick={() => setPageSelection(null)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!isLoading && accounts.length === 0) {
    return (
      <>
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center">
            <div className="mb-4 text-5xl">📱</div>
            <h2 className="mb-2 text-lg font-semibold text-neutral-100">
              Connect your first channel
            </h2>
            <p className="mb-6 text-sm text-neutral-500">
              Link your social accounts to start scheduling and publishing
              content directly from ContentOS.
            </p>
            <button
              onClick={() => setShowPicker(true)}
              className="rounded-lg bg-green-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-500"
            >
              + Connect Channel
            </button>
          </div>
        </div>
        <PlatformPicker
          isOpen={showPicker}
          onClose={() => setShowPicker(false)}
        />
      </>
    );
  }

  // Connected channels grid
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">
          Connected Channels
        </h1>
        <button
          onClick={() => setShowPicker(true)}
          className="rounded-md bg-green-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-500"
        >
          + Connect Channel
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => (
          <ChannelCard key={account.id} account={account} />
        ))}
      </div>

      <PlatformPicker
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
      />
    </div>
  );
}
