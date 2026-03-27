"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { ComposeView } from "@/components/social/compose/ComposeView"

export default function ComposePage() {
  const searchParams = useSearchParams()
  const { reset, setScheduledAt } = useSocialComposerStore()

  useEffect(() => {
    // Reset store for new post
    reset()

    // Pre-fill schedule from query param (from calendar click)
    const dateParam = searchParams.get("date")
    if (dateParam) {
      const date = new Date(dateParam)
      if (!isNaN(date.getTime())) {
        setScheduledAt(date)
      }
    }
  }, [])

  return <ComposeView />
}
