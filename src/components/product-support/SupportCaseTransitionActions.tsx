"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { productRequest } from "@/components/product-surfaces/ProductApi"

export function SupportCaseTransitionActions({ recordId, revision, state, resolution }: { recordId: string; revision: number; state: string; resolution: string }) {
  const t = useTranslations("product.support")
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const targets = state === "open" ? ["investigating", "waiting_customer", "resolved"] : state === "investigating" ? ["waiting_customer", "resolved"] : state === "waiting_customer" ? ["investigating", "resolved"] : state === "resolved" ? ["investigating", "closed"] : []
  if (!targets.length) return null
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("")
    const data = new FormData(event.currentTarget)
    try { await productRequest(`/api/product-support/cases/${encodeURIComponent(recordId)}`, { expectedRevision: revision, state: String(data.get("state")), resolution: String(data.get("resolution")), idempotencyKey: crypto.randomUUID() }, "PATCH"); router.refresh() }
    catch (cause) { const code = cause instanceof Error ? cause.message : "REQUEST_FAILED"; setError(hasLocalizedError(code) ? t(`errors.${code}` as never) : t("error")) }
    finally { setBusy(false) }
  }
  return <details className="mt-3 rounded-xl border p-3"><summary className="cursor-pointer text-xs font-semibold">{t("caseActions.title")}</summary><form onSubmit={submit} className="mt-3 grid gap-2"><label className="grid gap-1 text-xs">{t("caseActions.state")}<select name="state" className="min-h-10 rounded-lg border bg-background px-2">{targets.map((target) => <option key={target} value={target}>{t(`states.${target}` as never)}</option>)}</select></label><label className="grid gap-1 text-xs">{t("caseActions.resolution")}<textarea name="resolution" defaultValue={resolution} rows={3} dir="auto" className="rounded-lg border bg-background p-2" /></label><button disabled={busy} className="min-h-10 rounded-lg bg-stone-950 px-3 text-xs font-semibold text-white">{busy ? t("caseActions.saving") : t("caseActions.save")}</button>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</form></details>
}

function hasLocalizedError(code: string) { return ["SUPPORT_CASE_ADMIN_REQUIRED", "SUPPORT_CASE_TRANSITION_INVALID", "SUPPORT_CASE_RESOLUTION_REQUIRED", "SUPPORT_CASE_COMMAND_INVALID", "SUPPORT_CASE_NOT_FOUND", "SUPPORT_CASE_REVISION_CONFLICT", "SUPPORT_CASE_IDEMPOTENCY_CONFLICT", "REQUEST_FAILED"].includes(code) }
