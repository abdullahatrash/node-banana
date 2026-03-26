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
      showToast(
        `${account.displayName} disconnected`,
        "success",
      );
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
      className={`rounded-lg border p-4 ${
        account.requiresReauth
          ? "border-red-900/50 bg-neutral-900"
          : "border-neutral-700 bg-neutral-900"
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
          <div className="truncate text-sm font-medium text-neutral-100">
            {account.displayName}
          </div>
          <div className="text-xs text-neutral-500">
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
                  : "text-neutral-500"
            }`}
          >
            {status === "connected"
              ? "Connected"
              : status === "needs-reauth"
                ? "Needs re-auth"
                : "Disabled"}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {account.requiresReauth && (
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="flex-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
          >
            {isReconnecting ? "Reconnecting..." : "Reconnect"}
          </button>
        )}

        {showConfirm ? (
          <>
            <button
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
            >
              {isDisconnecting ? "Removing..." : "Confirm Remove"}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-700"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-neutral-700"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
