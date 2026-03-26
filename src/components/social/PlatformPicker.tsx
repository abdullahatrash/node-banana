"use client";

import { useState, useEffect } from "react";
import type { ProviderCapabilities } from "@/lib/social/provider-interface";
import {
  connectSocialAccount,
  listSocialProviders,
} from "@/lib/social/client";
import { PlatformIcon } from "./shared/PlatformIcon";
import { PLATFORM_LABELS } from "@/lib/social/constants";
import { XCloseIcon } from "./icons";
import { useToast } from "@/components/Toast";
import type { SocialPlatform } from "@/lib/db/schema";

interface PlatformPickerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PlatformPicker({ isOpen, onClose }: PlatformPickerProps) {
  const [providers, setProviders] = useState<ProviderCapabilities[]>([]);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(
    null,
  );
  const { show: showToast } = useToast();

  useEffect(() => {
    if (isOpen && providers.length === 0) {
      listSocialProviders()
        .then(setProviders)
        .catch(() => showToast("Failed to load providers", "error"));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleConnect(platform: string) {
    setConnectingPlatform(platform);
    try {
      const { authUrl } = await connectSocialAccount(platform);
      window.location.href = authUrl;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to connect",
        "error",
      );
      setConnectingPlatform(null);
    }
  }

  const platforms: Array<{ identifier: SocialPlatform; name: string }> =
    providers.length > 0
      ? providers.map((p) => ({
          identifier: p.identifier,
          name: p.displayName,
        }))
      : (
          ["linkedin", "instagram", "x", "tiktok", "facebook", "youtube"] as const
        ).map((id) => ({ identifier: id, name: PLATFORM_LABELS[id] }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[420px] rounded-xl border border-neutral-800 bg-[#111] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-[13px] font-semibold text-neutral-200">
              Connect a channel
            </h2>
            <p className="mt-0.5 text-[10px] text-neutral-600">
              Select the platform you want to link
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-400"
          >
            <XCloseIcon size={12} />
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-3 gap-2 p-4">
          {platforms.map((platform) => {
            const isConnecting = connectingPlatform === platform.identifier;
            return (
              <button
                key={platform.identifier}
                onClick={() => handleConnect(platform.identifier)}
                disabled={!!connectingPlatform}
                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-800 bg-[#0a0a0a] px-3 py-4 transition-all duration-200 hover:-translate-y-px hover:border-neutral-700 hover:bg-[#141414] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800">
                  <PlatformIcon platform={platform.identifier} size={20} />
                </div>
                <span className="text-[11px] font-medium text-neutral-500 transition-colors group-hover:text-neutral-200">
                  {isConnecting ? "Connecting..." : platform.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
