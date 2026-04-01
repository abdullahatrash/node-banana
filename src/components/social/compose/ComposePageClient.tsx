"use client"

import { useRef } from "react"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { ComposeView } from "./ComposeView"

interface ComposePageClientProps {
  initialDate: string | null
  initialAccountId: string | null
}

export function ComposePageClient({
  initialDate,
  initialAccountId,
}: ComposePageClientProps) {
  const initialized = useRef(false)
  const { reset, setScheduledAt, setSelectedAccounts } = useSocialComposerStore()

  // Initialize once on first render — no useEffect needed
  if (!initialized.current) {
    initialized.current = true
    reset()
    if (initialDate) {
      const date = new Date(initialDate)
      if (!isNaN(date.getTime())) {
        setScheduledAt(date)
      }
    }
    if (initialAccountId) {
      setSelectedAccounts([initialAccountId])
    }
  }

  return <ComposeView />
}
