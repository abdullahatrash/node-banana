"use client"

import { POST_STATUS_CONFIG } from "@/lib/social/constants"
import { Badge } from "@/components/ui/badge"
import type { SocialPostStatus } from "@/lib/db/schema"

interface PostStatusBadgeProps {
  status: SocialPostStatus
}

export function PostStatusBadge({ status }: PostStatusBadgeProps) {
  const config = POST_STATUS_CONFIG[status]
  return (
    <Badge variant="secondary" className={`text-[10px] ${config?.color ?? ""}`}>
      {config?.label ?? status}
    </Badge>
  )
}
