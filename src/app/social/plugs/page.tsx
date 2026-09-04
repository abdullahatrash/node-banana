"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import {
  createSocialWebhook,
  deleteSocialWebhook,
  listSocialWebhooks,
  updateSocialWebhook,
  type SocialWebhook,
} from "@/lib/social/client"
import { useToast } from "@/components/Toast"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTranslations } from "next-intl"

export default function SocialPlugsPage() {
  const t = useTranslations("social.plugs")
  const [webhooks, setWebhooks] = useState<SocialWebhook[]>([])
  const [targetUrl, setTargetUrl] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [mutatingWebhookId, setMutatingWebhookId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { show } = useToast()

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setWebhooks(await listSocialWebhooks())
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("errors.load")
      setError(message)
      setWebhooks([])
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!targetUrl.trim()) return
    setIsCreating(true)
    try {
      const { signingSecret } = await createSocialWebhook({ targetUrl: targetUrl.trim() })
      show(
        signingSecret
          ? t("toast.createdWithSecret", { secret: `${signingSecret.slice(0, 12)}…` })
          : t("toast.created"),
        "success",
      )
      setTargetUrl("")
      await refresh()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("errors.create")
      setError(message)
      show(message, "error")
    } finally {
      setIsCreating(false)
    }
  }

  async function onToggleEnabled(webhook: SocialWebhook) {
    setMutatingWebhookId(webhook.id)
    try {
      await updateSocialWebhook(webhook.id, { enabled: !webhook.enabled })
      await refresh()
      show(webhook.enabled ? t("toast.disabled") : t("toast.enabled"), "success")
    } catch (error) {
      show(error instanceof Error ? error.message : t("errors.update"), "error")
    } finally {
      setMutatingWebhookId(null)
    }
  }

  async function onDelete(webhook: SocialWebhook) {
    if (!confirm(t("confirmDelete"))) return
    setMutatingWebhookId(webhook.id)
    try {
      await deleteSocialWebhook(webhook.id)
      await refresh()
      show(t("toast.deleted"), "success")
    } catch (error) {
      show(error instanceof Error ? error.message : t("errors.delete"), "error")
    } finally {
      setMutatingWebhookId(null)
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
      <form onSubmit={onCreate} className="flex gap-2">
        <Input
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder={t("urlPlaceholder")}
        />
        <Button type="submit" disabled={isCreating}>
          {isCreating ? t("creating") : t("add")}
        </Button>
      </form>
      <div className="space-y-2">
        {webhooks.length === 0 ? (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          webhooks.map((webhook) => (
            <div key={webhook.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{webhook.targetUrl}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {webhook.enabled ? t("state.enabled") : t("state.disabled")} · <bdi>{webhook.id}</bdi>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onToggleEnabled(webhook)}
                    disabled={mutatingWebhookId === webhook.id}
                  >
                    {webhook.enabled ? t("disable") : t("enable")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => onDelete(webhook)}
                    disabled={mutatingWebhookId === webhook.id}
                  >
                    {t("delete")}
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
