"use client"

import { useRef, useState } from "react"
import { KeyRoundIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StudioApiError } from "@/lib/studio/client"
import {
  deleteProviderKeyRequest,
  listProviderKeysRequest,
  saveProviderKeyRequest,
  type ProviderKeySummaryView,
} from "@/lib/byok/client"
import {
  BYOK_PROVIDERS,
  BYOK_PROVIDER_LABELS,
  type ByokProvider,
} from "@/lib/byok/providers"

function formatDate(value: string | null): string {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function ProviderKeysSettings() {
  const { show: showToast } = useToast()
  const [keys, setKeys] = useState<ProviderKeySummaryView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [provider, setProvider] = useState<ByokProvider>(BYOK_PROVIDERS[0])
  const [apiKey, setApiKey] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [deletingProvider, setDeletingProvider] = useState<string | null>(null)
  const initialized = useRef(false)

  async function loadKeys() {
    setIsLoading(true)
    try {
      setKeys(await listProviderKeysRequest())
    } catch (error) {
      showToast(
        error instanceof StudioApiError
          ? error.message
          : "Failed to load provider keys",
        "error",
      )
    } finally {
      setIsLoading(false)
    }
  }

  // Load once on first render — no useEffect (matches repo convention).
  if (!initialized.current) {
    initialized.current = true
    loadKeys()
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed || isSaving) return

    setIsSaving(true)
    try {
      await saveProviderKeyRequest(provider, trimmed)
      setApiKey("")
      showToast(`${BYOK_PROVIDER_LABELS[provider]} key saved`, "success")
      await loadKeys()
    } catch (error) {
      showToast(
        error instanceof StudioApiError || error instanceof Error
          ? error.message
          : "Failed to save provider key",
        "error",
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(target: ByokProvider) {
    if (
      !confirm(
        `Delete the stored ${BYOK_PROVIDER_LABELS[target]} key for this workspace?`,
      )
    ) {
      return
    }

    setDeletingProvider(target)
    try {
      await deleteProviderKeyRequest(target)
      setKeys((prev) => prev.filter((key) => key.provider !== target))
      showToast("Provider key deleted", "success")
    } catch (error) {
      showToast(
        error instanceof StudioApiError
          ? error.message
          : "Failed to delete provider key",
        "error",
      )
    } finally {
      setDeletingProvider(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <KeyRoundIcon className="size-5" />
          Provider Keys (BYOK)
        </h2>
        <p className="text-sm text-muted-foreground">
          Store your own AI provider API keys per workspace. Keys are
          validated with a live check before saving, encrypted at rest, and
          never shown again after creation.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div>
          <Label htmlFor="provider-key-provider">Provider</Label>
          <select
            id="provider-key-provider"
            aria-label="Provider"
            className="flex h-9 w-full min-w-40 rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as ByokProvider)
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
          <Label htmlFor="provider-key-value">API key</Label>
          <Input
            id="provider-key-value"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste the provider's API key"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={!apiKey.trim() || isSaving}>
          {isSaving ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ShieldCheckIcon className="size-4" />
          )}
          Save key
        </Button>
      </form>

      <div className="rounded-lg border">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b px-4 py-2.5 text-xs font-medium text-muted-foreground">
          <span>Provider</span>
          <span className="hidden sm:block">Key</span>
          <span className="hidden sm:block">Updated</span>
          <span className="text-end">Actions</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading provider keys…
          </div>
        ) : keys.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No provider keys yet. Add one above to run generation on your own
            budget.
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
                    "Delete"
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
