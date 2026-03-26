"use client";

import type { SocialPlatform } from "@/lib/db/schema";
import { PlatformIcon } from "./PlatformIcon";

interface ChannelAvatarProps {
  avatarUrl?: string | null;
  platform: SocialPlatform;
  displayName: string;
  size?: number;
}

export function ChannelAvatar({
  avatarUrl,
  platform,
  displayName,
  size = 32,
}: ChannelAvatarProps) {
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const badgeSize = Math.max(12, Math.round(size * 0.4));

  return (
    <div className="relative inline-flex flex-shrink-0" style={{ width: size, height: size }}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={displayName}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-full bg-neutral-700 text-neutral-300"
          style={{ width: size, height: size, fontSize: size * 0.35 }}
        >
          {initials}
        </div>
      )}
      <div
        className="absolute -bottom-0.5 -right-0.5 rounded-full bg-neutral-900 p-0.5"
        style={{ width: badgeSize + 4, height: badgeSize + 4 }}
      >
        <PlatformIcon platform={platform} size={badgeSize} />
      </div>
    </div>
  );
}
