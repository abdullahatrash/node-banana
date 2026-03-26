"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSocialAccountsStore } from "@/store/socialAccountsStore";
import { PlatformPicker } from "@/components/social/PlatformPicker";
import { ChannelCard } from "@/components/social/ChannelCard";
import { ChannelsIcon, PlusIcon } from "@/components/social/icons";
import { useToast } from "@/components/Toast";
import {
  handleOAuthCallback,
  selectPage,
} from "@/lib/social/client";
import type { PageInfo } from "@/lib/social/client";
import { XCloseIcon } from "@/components/social/icons";

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
        const acct = result.account as unknown as Record<string, unknown> | undefined;
        setPageSelection({
          pages: result.pages,
          platform,
          accessToken: (acct?.accessToken as string) ?? "",
          refreshToken: acct?.refreshToken as string | undefined,
          expiresIn: acct?.expiresIn as number | undefined,
        });
      } else {
        showToast("Channel connected successfully!", "success");
        fetchAccounts();
      }

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

  // Processing OAuth callback
  if (isProcessingCallback) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-800 bg-[#111]">
            <ChannelsIcon size={20} className="text-neutral-600" />
          </div>
          <div className="text-[13px] text-neutral-300">
            Completing connection...
          </div>
          <div className="mx-auto mt-3 h-0.5 w-24 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-green-600" />
          </div>
        </div>
      </div>
    );
  }

  // Page selection modal (two-step auth)
  if (pageSelection) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-[400px] rounded-xl border border-neutral-800 bg-[#111] shadow-2xl">
          <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
            <div>
              <h2 className="text-[13px] font-semibold text-neutral-200">
                Select an account
              </h2>
              <p className="mt-0.5 text-[10px] text-neutral-600">
                Choose which page or account to post as
              </p>
            </div>
            <button
              onClick={() => setPageSelection(null)}
              className="flex h-6 w-6 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-400"
            >
              <XCloseIcon size={12} />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {pageSelection.pages.map((page) => (
              <button
                key={page.id}
                onClick={() => handlePageSelect(page)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-800/50"
              >
                {page.picture ? (
                  <img
                    src={page.picture}
                    alt={page.name}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-[11px] text-neutral-500">
                    {page.name[0]}
                  </div>
                )}
                <div>
                  <div className="text-[12px] font-medium text-neutral-200">
                    {page.name}
                  </div>
                  {page.username && (
                    <div className="text-[10px] text-neutral-600">
                      @{page.username}
                    </div>
                  )}
                </div>
              </button>
            ))}
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
          <div className="max-w-xs text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-neutral-800 bg-[#111]">
              <ChannelsIcon size={28} className="text-neutral-700" />
            </div>
            <h2 className="mb-1.5 text-[15px] font-semibold text-neutral-300">
              Connect your first channel
            </h2>
            <p className="mb-5 text-[12px] leading-relaxed text-neutral-600">
              Link your social accounts to start scheduling and publishing
              content directly from ContentOS.
            </p>
            <button
              onClick={() => setShowPicker(true)}
              className="rounded-lg bg-green-700 px-5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-green-600"
            >
              Connect Channel
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
        <div>
          <h1 className="text-[15px] font-semibold text-neutral-200">
            Connected Channels
          </h1>
          <p className="mt-0.5 text-[11px] text-neutral-600">
            Manage your social media accounts and connections
          </p>
        </div>
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-3.5 py-1.5 text-[11px] font-medium text-neutral-500 transition-all duration-150 hover:border-neutral-700 hover:bg-neutral-800 hover:text-neutral-300"
        >
          <PlusIcon size={12} />
          Connect Channel
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
