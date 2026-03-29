"use client"

import { useRef, useState } from "react"
import {
  listSocialEvents,
  markSocialEventRead,
  markSocialEventUnread,
  type SocialEvent,
} from "@/lib/social/client"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/Toast"

export default function SocialEventsPage() {
  const [events, setEvents] = useState<SocialEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdatingId, setIsUpdatingId] = useState<string | null>(null)
  const initialized = useRef(false)
  const { show } = useToast()

  async function load() {
    const rows = await listSocialEvents({
      perUserReads: true,
      userFacing: true,
      limit: 200,
    })
    setEvents(rows)
  }

  if (!initialized.current) {
    initialized.current = true
    load().finally(() => setIsLoading(false))
  }

  async function toggleRead(event: SocialEvent) {
    setIsUpdatingId(event.id)
    try {
      if (event.readByCurrentUser) {
        await markSocialEventUnread(event.id, { perUserReads: true })
      } else {
        await markSocialEventRead(event.id, { perUserReads: true })
      }
      await load()
    } catch (error) {
      show(error instanceof Error ? error.message : "Failed to update event", "error")
    } finally {
      setIsUpdatingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <h2 className="text-lg font-semibold">Events</h2>
      {events.length === 0 ? (
        <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
          No events yet.
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    {event.eventType} · {event.severity.toUpperCase()}
                  </div>
                  <p className="mt-0.5 text-sm">{event.message}</p>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={event.readByCurrentUser ? "outline" : "secondary"}
                  onClick={() => toggleRead(event)}
                  disabled={isUpdatingId === event.id}
                >
                  {event.readByCurrentUser ? "Mark Unread" : "Mark Read"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
