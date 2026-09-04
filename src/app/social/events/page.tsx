"use client"

import { useCallback, useEffect, useState } from "react"
import {
  listSocialEvents,
  markSocialEventRead,
  markSocialEventUnread,
  type SocialEvent,
} from "@/lib/social/client"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/Toast"
import { useFormatter, useTranslations } from "next-intl"

export default function SocialEventsPage() {
  const t = useTranslations("social.events")
  const format = useFormatter()
  const [events, setEvents] = useState<SocialEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdatingId, setIsUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { show } = useToast()

  const load = useCallback(async () => {
    setError(null)
    try {
      const rows = await listSocialEvents({
        perUserReads: true,
        userFacing: true,
        limit: 200,
      })
      setEvents(rows)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("errors.load")
      setError(message)
      setEvents([])
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

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
      show(error instanceof Error ? error.message : t("errors.update"), "error")
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
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {events.length === 0 ? (
        <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    <bdi>{event.eventType}</bdi> · {event.severity === "error" ? t("severity.error") : event.severity === "warning" ? t("severity.warning") : t("severity.info")}
                  </div>
                  <p className="mt-0.5 text-sm">{event.message}</p>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    <bdi>{format.dateTime(new Date(event.createdAt), { dateStyle: "medium", timeStyle: "short" })}</bdi>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={event.readByCurrentUser ? "outline" : "secondary"}
                  onClick={() => toggleRead(event)}
                  disabled={isUpdatingId === event.id}
                >
                  {event.readByCurrentUser ? t("markUnread") : t("markRead")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
