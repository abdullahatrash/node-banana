"use client"

import { useRef, useState } from "react"
import { ImageIcon, VideoIcon, Loader2Icon, CheckIcon } from "lucide-react"
import { useSocialComposerStore, type ComposerMediaItem } from "@/store/socialComposerStore"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getActiveWorkspaceId } from "@/lib/studio/client"

interface AssetItem {
  id: string
  type: string
  storageKey: string
  mimeType?: string
  sizeBytes?: number
  metadata?: Record<string, unknown>
}

type FilterTab = "all" | "image" | "video"

// Module-level cache
let assetCache: AssetItem[] | null = null

async function fetchAssets(): Promise<AssetItem[]> {
  if (assetCache) return assetCache

  const workspaceId = getActiveWorkspaceId()
  if (!workspaceId) return []

  const res = await fetch("/api/studio/assets", {
    headers: { "x-workspace-id": workspaceId },
  })
  const data = await res.json()
  if (data.success && Array.isArray(data.assets)) {
    assetCache = data.assets
    return data.assets
  }
  return []
}

interface MediaPoolProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MediaPool({ open, onOpenChange }: MediaPoolProps) {
  const [assets, setAssets] = useState<AssetItem[]>(assetCache ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [filter, setFilter] = useState<FilterTab>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const addMedia = useSocialComposerStore((s) => s.addMedia)
  const initialized = useRef(false)

  // Fetch on open — no useEffect
  if (open && !initialized.current) {
    initialized.current = true
    if (!assetCache) {
      setIsLoading(true)
      fetchAssets()
        .then((data) => {
          setAssets(data)
          setIsLoading(false)
        })
        .catch(() => setIsLoading(false))
    }
  }

  // Reset selection when closed
  if (!open && initialized.current) {
    initialized.current = false
  }

  const filtered = assets.filter((a) => {
    if (filter === "all") return true
    return a.type === filter
  })

  function toggleSelect(assetId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) {
        next.delete(assetId)
      } else {
        next.add(assetId)
      }
      return next
    })
  }

  function handleInsert() {
    const items: ComposerMediaItem[] = assets
      .filter((a) => selected.has(a.id))
      .map((a) => ({
        type: (a.type === "video" ? "video" : "image") as "image" | "video",
        url: a.storageKey,
        mimeType: a.mimeType,
      }))

    addMedia(items)
    setSelected(new Set())
    onOpenChange(false)
  }

  const TABS: { value: FilterTab; label: string }[] = [
    { value: "all", label: "All" },
    { value: "image", label: "Images" },
    { value: "video", label: "Videos" },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Media Pool</DialogTitle>
          <DialogDescription>
            Select assets from your workspace library
          </DialogDescription>
        </DialogHeader>

        {/* Filter tabs */}
        <div className="flex gap-1 border-b pb-2">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filter === tab.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Asset grid */}
        <div className="max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {assets.length === 0
                ? "No media assets in your workspace yet"
                : "No matching assets"}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {filtered.map((asset) => {
                const isSelected = selected.has(asset.id)
                return (
                  <button
                    key={asset.id}
                    onClick={() => toggleSelect(asset.id)}
                    className={`group relative aspect-square overflow-hidden rounded-lg border transition-all ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border hover:border-muted-foreground"
                    }`}
                  >
                    {asset.type === "image" && asset.storageKey ? (
                      <img
                        src={asset.storageKey}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-muted">
                        {asset.type === "video" ? (
                          <VideoIcon className="size-6 text-muted-foreground" />
                        ) : (
                          <ImageIcon className="size-6 text-muted-foreground" />
                        )}
                      </div>
                    )}

                    {/* Selection checkmark */}
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                        <div className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <CheckIcon className="size-4" />
                        </div>
                      </div>
                    )}

                    {/* Type badge */}
                    <Badge
                      variant="secondary"
                      className="absolute bottom-1 right-1 px-1 py-0 text-[8px]"
                    >
                      {asset.type}
                    </Badge>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {selected.size} selected
            </span>
            <Button
              size="sm"
              onClick={handleInsert}
              disabled={selected.size === 0}
            >
              Insert Selected
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
