"use client";

import { useState } from "react";
import type { SocialAccount } from "@/lib/social/client";
import {
  connectSocialAccount,
  disconnectSocialAccount,
} from "@/lib/social/client";
import { ChannelAvatar } from "./shared/ChannelAvatar";
import { StatusDot } from "./shared/StatusDot";
import { PLATFORM_LABELS } from "@/lib/social/constants";
import { ClockIcon, AlertTriangleIcon, PostsIcon } from "./icons";
import { useToast } from "@/components/Toast";
import { useSocialAccountsStore } from "@/store/socialAccountsStore";
import type { SocialPlatform } from "@/lib/db/schema";

interface ChannelCardProps {
  account: SocialAccount;
}

export function ChannelCard({ account }: ChannelCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const { show: showToast } = useToast();
  const removeAccount = useSocialAccountsStore((s) => s.removeAccount);

  const status = account.requiresReauth
    ? "needs-reauth"
    : account.disabled
      ? "disabled"
      : "connected";

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await disconnectSocialAccount(account.id);
      removeAccount(account.id);
      showToast(`${account.displayName} disconnected`, "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to disconnect",
        "error",
      );
    } finally {
      setIsDisconnecting(false);
      setShowConfirm(false);
    }
  }

  async function handleReconnect() {
    setIsReconnecting(true);
    try {
      const { authUrl } = await connectSocialAccount(account.platform);
      window.location.href = authUrl;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to reconnect",
        "error",
      );
      setIsReconnecting(false);
    }
  }

  return (
    <div
      className={`group rounded-lg border p-4 transition-all duration-200 ${
        account.requiresReauth
          ? "border-red-950 bg-[#111] hover:border-red-900"
          : "border-neutral-800 bg-[#111] hover:border-neutral-700 hover:bg-[#141414]"
      }`}
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-3">
        <ChannelAvatar
          platform={account.platform as SocialPlatform}
          displayName={account.displayName}
          avatarUrl={account.avatarUrl}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-neutral-200">
            {account.displayName}
          </div>
          <div className="text-[10px] text-neutral-600">
            {PLATFORM_LABELS[account.platform as SocialPlatform] ?? account.platform}
            {account.username ? ` · @${account.username}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={status} size="md" />
          <span
            className={`text-[10px] ${
              status === "connected"
                ? "text-green-400"
                : status === "needs-reauth"
                  ? "text-red-400"
                  : "text-neutral-600"
            }`}
          >
            {status === "connected"
              ? "Connected"
              : status === "needs-reauth"
                ? "Re-auth needed"
                : "Disabled"}
          </span>
        </div>
      </div>

      {/* Metadata */}
      <div className="mb-3 flex items-center gap-4 border-t border-neutral-800/50 pt-3">
        {account.requiresReauth ? (
          <div className="flex items-center gap-1 text-[10px] text-neutral-600">
            <AlertTriangleIcon size={12} className="opacity-50" />
            Token expired
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 text-[10px] text-neutral-600">
              <ClockIcon size={12} className="opacity-50" />
              Connected
            </div>
            <div className="flex items-center gap-1 text-[10px] text-neutral-600">
              <PostsIcon size={12} className="opacity-50" />
              0 posts
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1.5">
        {account.requiresReauth && (
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="flex-1 rounded-[5px] bg-amber-900/80 px-3 py-1.5 text-[10px] font-medium text-amber-300 transition-colors hover:bg-amber-800/80 disabled:opacity-50"
          >
            {isReconnecting ? "Reconnecting..." : "Reconnect"}
          </button>
        )}

        {showConfirm ? (
          <>
            <button
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="flex-1 rounded-[5px] bg-red-900/50 px-3 py-1.5 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-900/70 disabled:opacity-50"
            >
              {isDisconnecting ? "Removing..." : "Confirm Remove"}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="rounded-[5px] border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-[10px] text-neutral-500 transition-colors hover:bg-neutral-800"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {!account.requiresReauth && (
              <button className="flex-1 rounded-[5px] border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-[10px] font-medium text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-400">
                Settings
              </button>
            )}
            <button
              onClick={() => setShowConfirm(true)}
              className="flex-1 rounded-[5px] border border-neutral-900 px-3 py-1.5 text-[10px] text-neutral-700 transition-colors hover:border-red-950 hover:bg-[#1a0000] hover:text-red-400"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
}
