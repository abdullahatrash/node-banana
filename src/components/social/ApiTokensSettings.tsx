"use client"

import { useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { CopyIcon, KeyRoundIcon, Loader2Icon, PlusIcon } from "lucide-react"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StudioApiError } from "@/lib/studio/client"
import {
  createApiTokenRequest,
  listApiTokensRequest,
  revokeApiTokenRequest,
  type ApiTokenSummaryView,
  type CreatedApiTokenView,
} from "@/lib/api-tokens/client"

export function ApiTokensSettings() {
  const t = useTranslations("social.settings.tokens")
  const formatValue = useFormatter()
  const formatDate = (value: string | null) => {
    if (!value) return t("never")
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? "—"
      : formatValue.dateTime(date, { year: "numeric", month: "short", day: "numeric" })
  }
  const { show: showToast } = useToast()
  const [tokens, setTokens] = useState<ApiTokenSummaryView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [name, setName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [createdToken, setCreatedToken] = useState<CreatedApiTokenView | null>(
    null,
  )
  const initialized = useRef(false)

  async function loadTokens() {
    setIsLoading(true)
    try {
      setTokens(await listApiTokensRequest())
    } catch (error) {
      showToast(
        error instanceof StudioApiError
          ? error.message
          : t("errors.load"),
        "error",
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Load once on first render — no useEffect (matches repo convention).
  if (!initialized.current) {
    initialized.current = true
    loadTokens()
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || isCreating) return

    setIsCreating(true)
    try {
      const created = await createApiTokenRequest(trimmed)
      setCreatedToken(created)
      setName("")
      showToast(t("toast.created"), "success")
      await loadTokens()
    } catch (error) {
      showToast(
        error instanceof StudioApiError
          ? error.message
          : t("errors.create"),
        "error",
      )
    } finally {
      setIsCreating(false)
    }
  }

  async function handleRevoke(tokenId: string) {
    setRevokingId(tokenId)
    try {
      await revokeApiTokenRequest(tokenId)
      setTokens((prev) =>
        prev.map((token) =>
          token.id === tokenId ? { ...token, revoked: true } : token,
        ),
      )
      showToast(t("toast.revoked"), "success")
    } catch (error) {
      showToast(
        error instanceof StudioApiError
          ? error.message
          : t("errors.revoke"),
        "error",
      )
    } finally {
      setRevokingId(null)
    }
  }

  async function copySecret() {
    if (!createdToken) return
    try {
      await navigator.clipboard.writeText(createdToken.token)
      showToast(t("toast.copied"), "success")
    } catch {
      showToast(t("errors.copy"), "warning")
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <KeyRoundIcon className="size-5" />
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <Label htmlFor="token-name">{t("name")}</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={80}
          />
        </div>
        <Button type="submit" disabled={!name.trim() || isCreating}>
          {isCreating ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <PlusIcon className="size-4" />
          )}
          {t("create")}
        </Button>
      </form>

      <div className="rounded-lg border">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b px-4 py-2.5 text-xs font-medium text-muted-foreground">
          <span>{t("name")}</span>
          <span className="hidden sm:block">{t("created")}</span>
          <span className="hidden sm:block">{t("lastUsed")}</span>
          <span className="text-end">{t("actions")}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : tokens.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          tokens.map((token) => (
            <div
              key={token.id}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b px-4 py-3 text-sm last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {token.name}
                  {token.revoked && (
                    <span className="ms-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {t("revoked")}
                    </span>
                  )}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {token.prefix}…
                </p>
              </div>
              <span className="hidden text-muted-foreground sm:block">
                {formatDate(token.createdAt)}
              </span>
              <span className="hidden text-muted-foreground sm:block">
                {formatDate(token.lastUsedAt)}
              </span>
              <div className="text-end">
                {!token.revoked && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokingId === token.id}
                    onClick={() => handleRevoke(token.id)}
                  >
                    {revokingId === token.id ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      t("revoke")
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog
        open={!!createdToken}
        onOpenChange={(open) => {
          if (!open) setCreatedToken(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("copyTitle")}</DialogTitle>
            <DialogDescription>
              {t("copyDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm">
              {createdToken?.token}
            </code>
            <Button variant="outline" size="sm" onClick={copySecret}>
              <CopyIcon className="size-4" />
              {t("copy")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
