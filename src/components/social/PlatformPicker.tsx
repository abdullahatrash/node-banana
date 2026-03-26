"use client";

import { useState, useEffect } from "react";
import type { ProviderCapabilities } from "@/lib/social/provider-interface";
import {
  connectSocialAccount,
  listSocialProviders,
} from "@/lib/social/client";
import { PlatformIcon } from "./shared/PlatformIcon";
import { PLATFORM_LABELS } from "@/lib/social/constants";
import { useToast } from "@/components/Toast";
import type { SocialPlatform } from "@/lib/db/schema";

interface PlatformPickerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PlatformPicker({ isOpen, onClose }: PlatformPickerProps) {
  const [providers, setProviders] = useState<ProviderCapabilities[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(
    null,
  );
  const { show: showToast } = useToast();

  useEffect(() => {
    if (isOpen && providers.length === 0) {
      listSocialProviders()
        .then(setProviders)
        .catch(() => {
          showToast("Failed to load providers", "error");
        });
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

  // Fallback to all 6 platforms if provider list not loaded yet
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-700 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              Choose a platform
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Select the social network you want to connect
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 p-5">
          {platforms.map((platform) => {
            const isConnecting = connectingPlatform === platform.identifier;
            return (
              <button
                key={platform.identifier}
                onClick={() => handleConnect(platform.identifier)}
                disabled={!!connectingPlatform}
                className="flex flex-col items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 p-4 transition-colors hover:border-neutral-500 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PlatformIcon platform={platform.identifier} size={36} />
                <span className="text-xs font-medium text-neutral-200">
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
