"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { LoaderCircle, RefreshCw } from "lucide-react"
import { getActiveWorkspaceId } from "@/lib/studio/client"

export function BrandSourceRefreshButton({ sourceId, revision, disabled }: { sourceId: string; revision: number; disabled: boolean }) {
  const t = useTranslations("product.brand")
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function refresh() {
    setBusy(true); setError("")
    try {
      const response = await fetch("/api/brand/profile", {
        method: "POST",
        headers: { "content-type": "application/json", "x-workspace-id": getActiveWorkspaceId() ?? "" },
        body: JSON.stringify({ action: "refresh_source", sourceId, expectedSourceRevision: revision, idempotencyKey: crypto.randomUUID() }),
      })
      const result = await response.json() as { success: boolean }
      if (!response.ok || !result.success) throw new Error(t("sources.refreshError"))
      router.refresh()
    } catch {
      setError(t("sources.refreshError"))
    } finally {
      setBusy(false)
    }
  }

  return <div>
    <button type="button" onClick={refresh} disabled={busy || disabled} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{t(disabled ? "sources.refreshPending" : "sources.refresh")}</button>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </div>
}
