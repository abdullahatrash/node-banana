"use client"

import { useRef, useState } from "react"
import {
  ImageIcon,
  VideoIcon,
  Loader2Icon,
  CheckIcon,
  UploadCloudIcon,
} from "lucide-react"
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
import {
  getActiveWorkspaceId,
  createStudioAssetPresign,
  finalizeStudioAssetUpload,
} from "@/lib/studio/client"
import { useToast } from "@/components/Toast"

interface AssetItem {
  id: string
  type: string
  storageKey: string
  mimeType?: string
  sizeBytes?: number
  metadata?: Record<string, unknown>
}

type PoolTab = "library" | "upload"
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

function invalidateAssetCache() {
  assetCache = null
}

function getAssetType(mimeType: string): "image" | "video" | "audio" {
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  return "image"
}

function getFileExtension(file: File): string {
  const parts = file.name.split(".")
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "bin"
}

interface MediaPoolProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MediaPool({ open, onOpenChange }: MediaPoolProps) {
  const [assets, setAssets] = useState<AssetItem[]>(assetCache ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<PoolTab>("library")
  const [filter, setFilter] = useState<FilterTab>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const addMedia = useSocialComposerStore((s) => s.addMedia)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initialized = useRef(false)
  const { show: showToast } = useToast()

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

  // Reset when closed
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

  function handleInsertSelected() {
    const items: ComposerMediaItem[] = assets
      .filter((a) => selected.has(a.id))
      .map((a) => ({
        assetId: a.id,
        resourceKind: "studio_asset" as const,
        type: (a.type === "video" ? "video" : "image") as "image" | "video",
        url: a.storageKey,
        mimeType: a.mimeType,
      }))

    addMedia(items)
    setSelected(new Set())
    onOpenChange(false)
  }

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return

    setIsUploading(true)
    const uploaded: ComposerMediaItem[] = []

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setUploadProgress(`Uploading ${i + 1} of ${files.length}...`)

        const assetType = getAssetType(file.type)
        const ext = getFileExtension(file)

        // 1. Get presigned URL
        const presign = await createStudioAssetPresign({
          assetType,
          contentType: file.type,
          expectedSizeBytes: file.size,
          fileName: file.name,
        })

        // 2. Upload to S3/R2 via presigned PUT
        const uploadRes = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        })

        if (!uploadRes.ok) {
          throw new Error(`Upload failed for ${file.name}`)
        }

        // 3. Finalize
        await finalizeStudioAssetUpload(presign.assetId, {
          uploadState: "ready",
          sizeBytes: file.size,
          mimeType: file.type,
        })

        uploaded.push({
          assetId: presign.assetId,
          resourceKind: "studio_asset",
          type: assetType === "video" ? "video" : "image",
          url: presign.downloadUrl,
          mimeType: file.type,
        })
      }

      // Add uploaded media to composer
      addMedia(uploaded)

      // Invalidate cache so library tab refreshes
      invalidateAssetCache()

      showToast(
        `${uploaded.length} file${uploaded.length > 1 ? "s" : ""} uploaded`,
        "success",
      )
      onOpenChange(false)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Upload failed",
        "error",
      )
    } finally {
      setIsUploading(false)
      setUploadProgress(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const FILTER_TABS: { value: FilterTab; label: string }[] = [
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
            Browse your library or upload from your device
          </DialogDescription>
        </DialogHeader>

        {/* Pool tabs: Library / Upload */}
        <div className="flex gap-1 border-b pb-2">
          <button
            onClick={() => setActiveTab("library")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "library"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            <ImageIcon className="size-3.5" />
            Library
          </button>
          <button
            onClick={() => setActiveTab("upload")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "upload"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            }`}
          >
            <UploadCloudIcon className="size-3.5" />
            Upload
          </button>
        </div>

        {activeTab === "upload" ? (
          /* ─── Upload tab ─── */
          <div className="py-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => handleFileUpload(e.target.files)}
              className="hidden"
            />

            {isUploading ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{uploadProgress}</p>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border py-10 transition-colors hover:border-muted-foreground hover:bg-accent/50"
              >
                <UploadCloudIcon className="size-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium">
                    Click to upload files
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Images and videos supported
                  </p>
                </div>
              </button>
            )}
          </div>
        ) : (
          /* ─── Library tab ─── */
          <>
            {/* Filter tabs */}
            <div className="flex gap-1">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    filter === tab.value
                      ? "bg-secondary text-secondary-foreground"
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
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    {assets.length === 0
                      ? "No media assets yet"
                      : "No matching assets"}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setActiveTab("upload")}
                  >
                    <UploadCloudIcon className="size-3.5" />
                    Upload files
                  </Button>
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

                        {isSelected && (
                          <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                            <div className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <CheckIcon className="size-4" />
                            </div>
                          </div>
                        )}

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
          </>
        )}

        {activeTab === "library" && (
          <DialogFooter>
            <div className="flex w-full items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {selected.size} selected
              </span>
              <Button
                size="sm"
                onClick={handleInsertSelected}
                disabled={selected.size === 0}
              >
                Insert Selected
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
