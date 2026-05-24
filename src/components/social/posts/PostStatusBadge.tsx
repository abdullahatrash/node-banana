"use client"

import { POST_STATUS_CONFIG } from "@/lib/social/constants"
import { Badge } from "@/components/ui/badge"
import type { SocialPostStatus } from "@/lib/db/schema"

interface PostStatusBadgeProps {
  status: SocialPostStatus
  label?: string
}

export function PostStatusBadge({ status, label }: PostStatusBadgeProps) {
  const config = POST_STATUS_CONFIG[status]
  return (
    <Badge variant="secondary" className={`text-[10px] ${config?.color ?? ""}`}>
      {label ?? config?.label ?? status}
    </Badge>
  )
}
