"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { LoaderCircle, Search } from "lucide-react"
import { getActiveWorkspaceId } from "@/lib/studio/client"

type PickerAsset = { id: string; name: string; type: string; origin: string; ready: boolean }

export function SupportAssetPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const t = useTranslations("product.support")
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<PickerAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  async function load(search = "") {
    const workspaceId = getActiveWorkspaceId()
    if (!workspaceId) { setError(true); setLoading(false); return }
    setLoading(true); setError(false)
    try {
      const params = new URLSearchParams(); if (search.trim()) params.set("q", search.trim())
      const response = await fetch(`/api/product-library/assets?${params}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store" })
      const result = await response.json() as { success?: boolean; items?: PickerAsset[] }
      if (!response.ok || !result.success || !Array.isArray(result.items)) throw new Error("SUPPORT_ASSET_PICKER_UNAVAILABLE")
      setItems(result.items.filter((item) => item.ready))
    } catch { setError(true) } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  function toggle(id: string) { onChange(selected.includes(id) ? selected.filter((item) => item !== id) : selected.length < 5 ? [...selected, id] : selected) }

  return <fieldset className="grid gap-2"><legend className="text-sm font-medium">{t("attachments.title")}</legend><p className="text-xs text-muted-foreground">{t("attachments.help")}</p><div className="flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("attachments.search")} className="min-h-10 min-w-0 flex-1 rounded-xl border bg-background px-3" /><button type="button" onClick={() => void load(query)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm"><Search className="size-4" />{t("attachments.searchAction")}</button></div>
    {loading ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t("attachments.loading")}</p> : error ? <p role="alert" className="text-xs text-destructive">{t("attachments.unavailable")}</p> : items.length ? <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border p-2">{items.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted"><input type="checkbox" checked={selected.includes(item.id)} disabled={!selected.includes(item.id) && selected.length >= 5} onChange={() => toggle(item.id)} className="mt-1" /><span className="min-w-0"><span dir="auto" className="block truncate text-sm font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{t(`attachments.types.${item.type}` as never)} · {t(`attachments.origins.${item.origin}` as never)}</span></span></label>)}</div> : <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">{t("attachments.empty")}</p>}
    <p className="text-xs text-muted-foreground">{t("attachments.selected", { count: selected.length })}</p>
  </fieldset>
}
