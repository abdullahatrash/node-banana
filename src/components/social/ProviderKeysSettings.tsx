"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import Link from "next/link"
import { KeyRoundIcon, Loader2Icon, RouteIcon, ShieldCheckIcon, WalletCardsIcon } from "lucide-react"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StudioApiError } from "@/lib/studio/client"
import { useClientErrorPresentation } from "@/hooks/use-client-error-presentation"
import {
  beginProviderKeyStepUpRequest,
  deleteProviderKeyRequest,
  listProviderKeysRequest,
  saveProviderKeyRequest,
  type ProviderKeySummaryView,
  verifyProviderKeyStepUpRequest,
} from "@/lib/byok/client"
import {
  BYOK_PROVIDERS,
  BYOK_PROVIDER_LABELS,
  type ByokProvider,
} from "@/lib/byok/providers"

export function ProviderKeysSettings() {
  const t = useTranslations("social.settings.providerKeys")
  const { show: showClientError } = useClientErrorPresentation()
  const formatValue = useFormatter()
  const formatDate = (value: string | null) => {
    if (!value) return t("never")
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? "—"
      : formatValue.dateTime(date, { year: "numeric", month: "short", day: "numeric" })
  }
  const { show: showToast } = useToast()
  const [keys, setKeys] = useState<ProviderKeySummaryView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [provider, setProvider] = useState<ByokProvider>(BYOK_PROVIDERS[0])
  const [apiKey, setApiKey] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [challenge, setChallenge] = useState<{ challengeId: string; expiresAt: string } | null>(null)
  const [verificationCode, setVerificationCode] = useState("")
  const [stepUpToken, setStepUpToken] = useState("")
  const [isRequestingCode, setIsRequestingCode] = useState(false)
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [stepUpError, setStepUpError] = useState<string | null>(null)
  const [deletingProvider, setDeletingProvider] = useState<string | null>(null)
  const initialized = useRef(false)

  const loadKeys = useCallback(async () => {
    setIsLoading(true)
    try {
      setKeys(await listProviderKeysRequest())
    } catch (error) {
      showClientError(showToast, error, t("errors.load"))
    } finally {
      setIsLoading(false)
    }
  }, [showClientError, showToast, t])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void loadKeys()
  }, [loadKeys])

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed || !stepUpToken || isSaving) return

    setIsSaving(true)
    try {
      await saveProviderKeyRequest(provider, trimmed, stepUpToken)
      setApiKey("")
      resetStepUp()
      showToast(t("toast.saved", { provider: BYOK_PROVIDER_LABELS[provider] }), "success")
      await loadKeys()
    } catch (error) {
      // A transport failure has an ambiguous outcome, while a 403 means the
      // proof is no longer accepted. A provider-validation 422 can safely keep
      // the still-fresh, exact-provider proof while the user corrects the key.
      if (!(error instanceof StudioApiError && error.status === 422)) {
        resetStepUp()
      }
      showClientError(showToast, error, t("errors.save"))
    } finally {
      setIsSaving(false)
    }
  }

  function resetStepUp() {
    setChallenge(null)
    setVerificationCode("")
    setStepUpToken("")
    setStepUpError(null)
  }

  function handleProviderChange(value: ByokProvider) {
    setProvider(value)
    resetStepUp()
  }

  async function requestStepUpCode() {
    if (isRequestingCode || isVerifyingCode || isSaving) return
    setIsRequestingCode(true)
    setStepUpError(null)
    try {
      setChallenge(await beginProviderKeyStepUpRequest(provider))
      setVerificationCode("")
      setStepUpToken("")
    } catch {
      setStepUpError(t("stepUp.errors.request"))
    } finally {
      setIsRequestingCode(false)
    }
  }

  async function verifyStepUpCode() {
    if (!challenge || !/^\d{6}$/.test(verificationCode) || isVerifyingCode) return
    setIsVerifyingCode(true)
    setStepUpError(null)
    try {
      const result = await verifyProviderKeyStepUpRequest(
        challenge.challengeId,
        verificationCode,
      )
      if (!result.verified) {
        setStepUpError(
          t("stepUp.errors.invalid", { count: result.attemptsRemaining }),
        )
        return
      }
      if (!result.stepUpToken.trim()) {
        setStepUpError(t("stepUp.errors.verify"))
        return
      }
      setStepUpToken(result.stepUpToken)
      setVerificationCode("")
    } catch {
      setStepUpError(t("stepUp.errors.verify"))
    } finally {
      setIsVerifyingCode(false)
    }
  }

  async function handleDelete(target: ByokProvider) {
    if (
      !confirm(
        t("confirmDelete", { provider: BYOK_PROVIDER_LABELS[target] }),
      )
    ) {
      return
    }

    setDeletingProvider(target)
    try {
      await deleteProviderKeyRequest(target)
      setKeys((prev) => prev.filter((key) => key.provider !== target))
      showToast(t("toast.deleted"), "success")
    } catch (error) {
      showClientError(showToast, error, t("errors.delete"))
    } finally {
      setDeletingProvider(null)
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

      <section aria-labelledby="provider-funding-title" className="grid gap-3 rounded-xl border bg-muted/20 p-4">
        <div>
          <h3 id="provider-funding-title" className="text-sm font-semibold">{t("funding.title")}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t.rich("funding.encryptionBoundary", {
              encryptionKey: (chunks) => <bdi dir="ltr" className="font-mono text-xs">{chunks}</bdi>,
            })}
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-background p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <KeyRoundIcon className="size-4" aria-hidden="true" />
              {t("funding.byokTitle")}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("funding.byokDescription")}</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <WalletCardsIcon className="size-4" aria-hidden="true" />
              {t("funding.managedTitle")}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("funding.managedDescription")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold">
          <Link href="/studio/model-routing" className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline">
            <RouteIcon className="size-3.5" aria-hidden="true" />
            {t("funding.readinessAction")}
          </Link>
          <Link href="/billing" className="text-primary underline-offset-4 hover:underline">
            {t("funding.billingAction")}
          </Link>
        </div>
      </section>

      <form
        onSubmit={handleSave}
        className="grid gap-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div>
            <Label htmlFor="provider-key-provider">{t("provider")}</Label>
            <select
              id="provider-key-provider"
              aria-label={t("provider")}
              className="flex h-9 w-full min-w-40 rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
              value={provider}
              onChange={(event) =>
                handleProviderChange(event.target.value as ByokProvider)
              }
            >
              {BYOK_PROVIDERS.map((value) => (
                <option key={value} value={value}>
                  {BYOK_PROVIDER_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <Label htmlFor="provider-key-value">{t("apiKey")}</Label>
            <Input
              id="provider-key-value"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t("keyPlaceholder")}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={!apiKey.trim() || !stepUpToken || isSaving}>
            {isSaving ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ShieldCheckIcon className="size-4" />
            )}
            {t("save")}
          </Button>
        </div>

        <div
          className="grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3"
          aria-labelledby="provider-key-step-up-title"
        >
          <div>
            <p id="provider-key-step-up-title" className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheckIcon className="size-4" aria-hidden="true" />
              {t("stepUp.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("stepUp.description", { provider: BYOK_PROVIDER_LABELS[provider] })}
            </p>
          </div>

          {!challenge ? (
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={isRequestingCode || isSaving}
              onClick={requestStepUpCode}
            >
              {isRequestingCode && <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />}
              {isRequestingCode ? t("stepUp.requesting") : t("stepUp.request")}
            </Button>
          ) : stepUpToken ? (
            <p className="text-sm text-primary" role="status">
              {t("stepUp.verified", { provider: BYOK_PROVIDER_LABELS[provider] })}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{t("stepUp.sent")}</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label htmlFor="provider-key-verification-code">
                    {t("stepUp.code")}
                  </Label>
                  <Input
                    id="provider-key-verification-code"
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value)}
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoComplete="one-time-code"
                    dir="ltr"
                  />
                </div>
                <Button
                  type="button"
                  disabled={!/^\d{6}$/.test(verificationCode) || isVerifyingCode}
                  onClick={verifyStepUpCode}
                >
                  {isVerifyingCode && <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />}
                  {isVerifyingCode ? t("stepUp.verifying") : t("stepUp.verify")}
                </Button>
                <Button type="button" variant="ghost" onClick={requestStepUpCode} disabled={isRequestingCode || isVerifyingCode}>
                  {t("stepUp.resend")}
                </Button>
              </div>
            </>
          )}

          <div aria-live="polite" aria-atomic="true">
            {stepUpError ? <p className="text-sm text-destructive" role="alert">{stepUpError}</p> : null}
          </div>
        </div>
      </form>

      <div className="rounded-lg border">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b px-4 py-2.5 text-xs font-medium text-muted-foreground">
          <span>{t("provider")}</span>
          <span className="hidden sm:block">{t("key")}</span>
          <span className="hidden sm:block">{t("updated")}</span>
          <span className="text-end">{t("actions")}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : keys.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          keys.map((key) => (
            <div
              key={key.provider}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b px-4 py-3 text-sm last:border-b-0"
            >
              <p className="truncate font-medium">
                {BYOK_PROVIDER_LABELS[key.provider] ?? key.provider}
              </p>
              <span className="hidden truncate font-mono text-xs text-muted-foreground sm:block">
                {key.hint}
              </span>
              <span className="hidden text-muted-foreground sm:block">
                {formatDate(key.updatedAt)}
              </span>
              <div className="text-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deletingProvider === key.provider}
                  onClick={() => handleDelete(key.provider)}
                >
                  {deletingProvider === key.provider ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    t("delete")
                  )}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
