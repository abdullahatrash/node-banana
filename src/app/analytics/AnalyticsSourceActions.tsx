"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react"
import { productRequest } from "@/components/product-surfaces/ProductApi"

function errorKey(code: string): "errors.ANALYTICS_SOURCE_NOT_FOUND" | "errors.ANALYTICS_SOURCE_NOT_VERIFIED" | "errors.ANALYTICS_SOURCE_VERIFICATION_FAILED" | "errors.REQUEST_FAILED" {
  if (code === "ANALYTICS_SOURCE_NOT_FOUND") return "errors.ANALYTICS_SOURCE_NOT_FOUND"
  if (code === "ANALYTICS_SOURCE_NOT_VERIFIED") return "errors.ANALYTICS_SOURCE_NOT_VERIFIED"
  if (code === "ANALYTICS_SOURCE_VERIFICATION_FAILED") return "errors.ANALYTICS_SOURCE_VERIFICATION_FAILED"
  return "errors.REQUEST_FAILED"
}

export function AnalyticsSourceActions({ id, revision, verified, refreshPending }: { id: string; revision: number; verified: boolean; refreshPending: boolean }) {
  const t = useTranslations("product.analytics")
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function command(action: "verify" | "refresh") {
    setBusy(true); setError("")
    try {
      await productRequest("/api/product-analytics/sources", { action, id, expectedRevision: revision, idempotencyKey: crypto.randomUUID() })
      router.refresh()
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "REQUEST_FAILED"
      setError(t(errorKey(code)))
    } finally {
      setBusy(false)
    }
  }

  return <div className="mt-4">
    <button type="button" disabled={busy || refreshPending} onClick={() => void command(verified ? "refresh" : "verify")} className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : verified ? <RefreshCw className="size-4" /> : <CheckCircle2 className="size-4" />}{t(verified ? refreshPending ? "sources.refreshPending" : "sources.refresh" : "sources.verify")}</button>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </div>
}
