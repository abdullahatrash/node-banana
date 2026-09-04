"use client"

import { useSocialComposerStore } from "@/store/socialComposerStore"
import { Label } from "@/components/ui/label"
import { useTranslations } from "next-intl"

export function SchedulePicker() {
  const t = useTranslations("social.compose")
  const { scheduledAt, setScheduledAt } = useSocialComposerStore()

  const dateStr = scheduledAt
    ? new Date(scheduledAt.getTime() - scheduledAt.getTimezoneOffset() * 60000)
        .toISOString()
        .split("T")[0]
    : ""
  const timeStr = scheduledAt
    ? scheduledAt.toTimeString().slice(0, 5)
    : ""

  function handleDateChange(value: string) {
    if (!value) {
      setScheduledAt(null)
      return
    }
    const current = scheduledAt ?? new Date()
    const [year, month, day] = value.split("-").map(Number)
    const next = new Date(current)
    next.setFullYear(year, month - 1, day)
    setScheduledAt(next)
  }

  function handleTimeChange(value: string) {
    if (!value) return
    const [hours, minutes] = value.split(":").map(Number)
    const current = scheduledAt ?? new Date()
    const next = new Date(current)
    next.setHours(hours, minutes, 0, 0)
    setScheduledAt(next)
  }

  return (
    <div>
      <Label className="mb-2 block text-xs">{t("schedule")}</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]" dir="ltr">
        <input
          type="date"
          value={dateStr}
          onChange={(e) => handleDateChange(e.target.value)}
          dir="ltr"
          className="min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <input
          type="time"
          value={timeStr}
          onChange={(e) => handleTimeChange(e.target.value)}
          disabled={!scheduledAt}
          dir="ltr"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>
      {scheduledAt && scheduledAt < new Date() && (
        <p className="mt-1 text-[10px] text-destructive">
          {t("schedulePast")}
        </p>
      )}
    </div>
  )
}
