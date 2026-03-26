"use client";

import type { SocialPlatform } from "@/lib/db/schema";
import { PLATFORM_COLORS, PLATFORM_ICONS } from "@/lib/social/constants";

interface PlatformIconProps {
  platform: SocialPlatform;
  size?: number;
  className?: string;
}

export function PlatformIcon({
  platform,
  size = 20,
  className,
}: PlatformIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={PLATFORM_COLORS[platform]}
      className={className}
    >
      <path d={PLATFORM_ICONS[platform]} />
    </svg>
  );
}
