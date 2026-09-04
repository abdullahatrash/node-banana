"use client"

import { useEffect, useMemo, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import {
  CalendarClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  PencilIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PlatformIcon } from "@/components/social/shared/PlatformIcon"
import { useSocialAccountsStore } from "@/store/socialAccountsStore"
import {
  createSocialPost,
  deleteSocialPost,
  publishSocialPostNow,
  rescheduleSocialPost,
  retrySocialPost,
  type SocialPost,
} from "@/lib/social/client"
import { POST_STATUS_CONFIG } from "@/lib/social/constants"
import { useToast } from "@/components/Toast"
import type { SocialPlatform, SocialPostStatus } from "@/lib/db/schema"

interface CalendarPostDetailsPopoverProps {
  post: SocialPost
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  onMutate: () => void | Promise<void>
}

function toDateTimeLocalValue(value?: string | null) {
  const date = value ? new Date(value) : new Date()
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return offsetDate.toISOString().slice(0, 16)
}

export function CalendarPostDetailsPopover({
  post,
  anchor,
  open,
  onClose,
  onMutate,
}: CalendarPostDetailsPopoverProps) {
  const t = useTranslations("social.calendarUi")
  const formatValue = useFormatter()
  const formatDateTime = (value?: string | null) => value
    ? formatValue.dateTime(new Date(value), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : t("notSet")
  const router = useRouter()
  const { show: showToast } = useToast()
  const accounts = useSocialAccountsStore((s) => s.accounts)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [isActing, setIsActing] = useState(false)
  const [showReschedule, setShowReschedule] = useState(false)
  const [rescheduleValue, setRescheduleValue] = useState(
    toDateTimeLocalValue(post.scheduledAt || post.publishedAt || post.createdAt),
  )

  const account = accounts.find((item) => item.id === post.socialAccountId)
  const platform = (account?.platform ?? "linkedin") as SocialPlatform
  const statusConfig = POST_STATUS_CONFIG[post.status as SocialPostStatus]
  const isPublished = post.status === "published"
  const canEdit = post.status === "draft" || post.status === "failed"
  const canDelete = post.status !== "published"
  const canPublishNow =
    post.status === "draft" ||
    post.status === "failed" ||
    post.status === "queued" ||
    (post.status === "publishing" &&
      post.scheduledAt !== null &&
      post.scheduledAt !== undefined &&
      new Date(post.scheduledAt).getTime() > Date.now())
  const canReschedule = post.status !== "published"
  const postTime = post.scheduledAt || post.publishedAt || post.createdAt

  const media = useMemo(() => post.mediaUrls ?? [], [post.mediaUrls])

  useEffect(() => {
    setRescheduleValue(
      toDateTimeLocalValue(post.scheduledAt || post.publishedAt || post.createdAt),
    )
  }, [post])

  useEffect(() => {
    if (!open || !anchor) return
    const anchorElement = anchor

    function updatePosition() {
      const rect = anchorElement.getBoundingClientRect()
      const left = Math.min(rect.right + 8, window.innerWidth - 340)
      const top = Math.min(rect.top, window.innerHeight - 380)
      setPosition({
        top: Math.max(8, top),
        left: Math.max(8, left),
      })
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [anchor, open])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (anchor?.contains(target)) return
      const popover = document.querySelector("[data-calendar-post-popover]")
      if (popover?.contains(target)) return
      onClose()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [anchor, onClose, open])

  if (!open || typeof document === "undefined") return null

  async function runAction(action: () => Promise<void>) {
    setIsActing(true)
    try {
      await action()
      await onMutate()
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("errors.action"), "error")
    } finally {
      setIsActing(false)
    }
  }

  return createPortal(
    <div
      data-calendar-post-popover
      className="fixed z-50 w-[320px] rounded-lg border bg-popover text-popover-foreground shadow-xl"
      style={{ top: position.top, left: position.left }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={`h-1 rounded-t-lg ${statusConfig?.bgColor ?? "bg-muted"}`} />
      <div className="flex items-start gap-3 p-4">
        <PlatformIcon platform={platform} size={24} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">
              {account?.displayName ?? t("unknownChannel")}
            </p>
            <Badge variant="secondary" className={`text-[10px] ${statusConfig?.color ?? ""}`}>
              {t(`status.${post.status}`)}
            </Badge>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">
            {post.content || t("noContent")}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-2 border-t px-4 py-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>{t("scheduled")}</span>
          <span className="text-foreground">{formatDateTime(post.scheduledAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>{t("published")}</span>
          <span className="text-foreground">{formatDateTime(post.publishedAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>{t("created")}</span>
          <span className="text-foreground">{formatDateTime(post.createdAt)}</span>
        </div>
        {media.length > 0 && (
          <div>
            <div className="mb-2">{t("mediaAttached", { count: media.length })}</div>
            <div className="flex gap-1.5 overflow-hidden">
              {media.slice(0, 4).map((item, index) => (
                item.type === "image" ? (
                  <img
                    key={`${item.url}-${index}`}
                    src={item.url}
                    alt={item.alt ?? ""}
                    className="size-12 rounded border object-cover"
                  />
                ) : (
                  <div
                    key={`${item.url}-${index}`}
                    className="flex size-12 items-center justify-center rounded border bg-muted text-[10px]"
                  >
                    {t("video")}
                  </div>
                )
              ))}
            </div>
          </div>
        )}
        {post.errorMessage && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
            {post.errorMessage}
          </div>
        )}
      </div>

      {showReschedule && canReschedule && (
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <input
            type="datetime-local"
            value={rescheduleValue}
            onChange={(event) => setRescheduleValue(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
          />
          <Button
            size="sm"
            disabled={isActing || !rescheduleValue}
            onClick={() =>
              runAction(async () => {
                await rescheduleSocialPost(
                  post.id,
                  new Date(rescheduleValue).toISOString(),
                )
                showToast(t("toast.rescheduled"), "success")
                setShowReschedule(false)
              })
            }
          >
            {t("actions.save")}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-t p-3">
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => router.push(`/social/compose/${post.id}`)}>
            <PencilIcon className="size-3.5" />
            {t("actions.edit")}
          </Button>
        )}
        {canPublishNow && (
          <Button
            size="sm"
            disabled={isActing}
            onClick={() => {
              if (!confirm(t("confirmPublishNow"))) return
              runAction(async () => {
                await publishSocialPostNow(post.id)
                showToast(t("toast.queuedNow"), "success")
                onClose()
              })
            }}
          >
            <SendIcon className="size-3.5" />
            {t("actions.publishNow")}
          </Button>
        )}
        {post.status === "failed" && (
          <Button
            size="sm"
            variant="outline"
            disabled={isActing}
            onClick={() =>
              runAction(async () => {
                await retrySocialPost(post.id)
                showToast(t("toast.requeued"), "success")
                onClose()
              })
            }
          >
            <RefreshCwIcon className="size-3.5" />
            {t("actions.retry")}
          </Button>
        )}
        {canReschedule && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowReschedule((value) => !value)}
          >
            <CalendarClockIcon className="size-3.5" />
            {t("actions.reschedule")}
          </Button>
        )}
        {isPublished && post.platformPostUrl && (
          <Button
            size="sm"
            variant="outline"
            render={<a href={post.platformPostUrl} target="_blank" rel="noopener" />}
            nativeButton={false}
          >
            <ExternalLinkIcon className="size-3.5" />
            {t("actions.open")}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={isActing}
          onClick={() =>
            runAction(async () => {
              const duplicated = await createSocialPost({
                socialAccountId: post.socialAccountId,
                content: post.content ?? undefined,
                mediaUrls: post.mediaUrls ?? undefined,
                mediaReferences: post.stableMediaRefs?.map((reference) => ({ resourceKind: reference.resourceKind ?? "studio_asset", id: reference.assetId, digest: reference.assetDigest })),
                platformSettings: post.platformSettings ?? undefined,
              })
              showToast(t("toast.duplicated"), "success")
              router.push(`/social/compose/${duplicated.id}`)
            })
          }
        >
          <CopyIcon className="size-3.5" />
          {t("actions.duplicate")}
        </Button>
        {canDelete && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={isActing}
            onClick={() => {
              if (!confirm(t("confirmDelete"))) return
              runAction(async () => {
                await deleteSocialPost(post.id)
                showToast(t("toast.deleted"), "success")
                onClose()
              })
            }}
          >
            <Trash2Icon className="size-3.5" />
            {t("actions.delete")}
          </Button>
        )}
      </div>
      {postTime && (
        <div className="border-t px-4 py-2 text-[10px] text-muted-foreground">
          {t("calendarTime", { value: formatDateTime(postTime) })}
        </div>
      )}
    </div>,
    document.body,
  )
}
