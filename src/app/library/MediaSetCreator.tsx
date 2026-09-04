"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Check, FolderPlus, LoaderCircle, Search } from "lucide-react"
import { productRequest } from "@/components/product-surfaces/ProductApi"
import type { LibraryAssetProjection } from "@/lib/product-surfaces/library-projection"
import { getActiveWorkspaceId } from "@/lib/studio/client"

interface AssetPage { success: boolean; items: LibraryAssetProjection[]; nextCursor: string | null }

export function MediaSetCreator() {
  const t = useTranslations("product.library")
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [assets, setAssets] = useState<LibraryAssetProjection[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  const load = useCallback(async (cursor?: string) => {
    setLoading(true); setError("")
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set("q", query.trim())
      if (cursor) params.set("cursor", cursor)
      const response = await fetch(`/api/product-library/assets?${params}`, { headers: { "x-workspace-id": getActiveWorkspaceId() ?? "" } })
      const result = await response.json() as AssetPage
      if (!response.ok || !result.success) throw new Error(t("picker.error"))
      setAssets((current) => cursor ? [...current, ...result.items] : result.items)
      setNextCursor(result.nextCursor)
    } catch {
      setError(t("picker.error"))
    } finally {
      setLoading(false)
    }
  }, [query, t])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer) }, [load])

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("")
    const data = new FormData(event.currentTarget)
    try {
      await productRequest("/api/product-library/media-sets", { title: String(data.get("title")), assetIds: selected, category: String(data.get("category")), description: String(data.get("description")), idempotencyKey: crypto.randomUUID() })
      event.currentTarget.reset(); setSelected([]); router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error"))
    } finally {
      setBusy(false)
    }
  }

  return <form onSubmit={submit} className="rounded-2xl border bg-card p-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><input name="title" required placeholder={t("setName")} className="min-h-11 rounded-xl border bg-background px-3" /><input name="category" placeholder={t("category")} className="min-h-11 rounded-xl border bg-background px-3" /><input name="description" placeholder={t("descriptionField")} className="min-h-11 rounded-xl border bg-background px-3" /></div>
    <fieldset className="mt-4"><legend className="font-semibold">{t("picker.title")}</legend><p className="mt-1 text-sm text-muted-foreground">{t("picker.description")}</p>
      <label className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border bg-background px-3"><Search className="size-4 text-muted-foreground" /><span className="sr-only">{t("picker.search")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("picker.search")} className="min-w-0 flex-1 bg-transparent outline-none" /></label>
      <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{assets.map((asset) => { const checked = selected.includes(asset.id); return <button key={asset.id} type="button" role="checkbox" aria-checked={checked} onClick={() => toggle(asset.id)} className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 text-start ${checked ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : "bg-background"}`}><span className={`grid size-5 shrink-0 place-items-center rounded border ${checked ? "border-amber-500 bg-amber-300 text-stone-950" : ""}`}>{checked && <Check className="size-3" />}</span><span className="min-w-0"><span dir="auto" className="block truncate text-sm font-medium">{asset.name}</span><span className="block text-xs text-muted-foreground">{t(`assetTypes.${asset.type}`)} · {t(`origin.${asset.origin}`)}</span></span></button> })}</div>
      {!loading && assets.length === 0 && <p className="mt-3 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{t("picker.empty")}</p>}
      {loading && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t("picker.loading")}</p>}
      {nextCursor && !loading && <button type="button" onClick={() => void load(nextCursor)} className="mt-3 min-h-10 rounded-xl border px-4 text-sm font-semibold">{t("picker.more")}</button>}
      <p className="mt-3 text-xs text-muted-foreground">{t("picker.selected", { count: selected.length })}</p>
    </fieldset>
    <button disabled={busy || selected.length === 0} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-300 font-semibold text-stone-950 disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}{t("createSet")}</button>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </form>
}
