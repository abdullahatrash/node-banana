"use client"

import { useRef } from "react"
import { useSocialComposerStore } from "@/store/socialComposerStore"
import { ComposeView } from "./ComposeView"

interface ComposePageClientProps {
  initialDate: string | null
}

export function ComposePageClient({ initialDate }: ComposePageClientProps) {
  const initialized = useRef(false)
  const { reset, setScheduledAt } = useSocialComposerStore()

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
  }

  return <ComposeView />
}
