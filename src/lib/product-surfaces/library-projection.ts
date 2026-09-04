export type LibraryAssetOrigin = "generated" | "uploaded" | "imported" | "ingested" | "unknown"

export interface LibraryAssetProjection {
  id: string
  name: string
  type: "image" | "video" | "audio" | "model3d" | "workflow"
  width: number | null
  height: number | null
  durationSeconds: number | null
  checksum: string | null
  ready: boolean
  origin: LibraryAssetOrigin
  originDetail: string | null
  lineageAssetIds: string[]
  createdAt: Date
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function safeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(item)))].slice(0, 20)
}

export function projectLibraryAsset(row: {
  id: string
  type: LibraryAssetProjection["type"]
  storageProvider: "local" | "s3" | "r2"
  storageKey: string
  width: number | null
  height: number | null
  durationSeconds: number | null
  checksum: string | null
  metadata: Record<string, unknown> | null
  createdAt: Date
}, generation: { id: string; provider: string; model: string } | null): LibraryAssetProjection {
  const metadata = metadataRecord(row.metadata)
  const candidateName = metadata.name ?? metadata.originalFileName
  const name = typeof candidateName === "string" && candidateName.trim() ? candidateName.trim().slice(0, 240) : row.storageKey.split("/").at(-1)?.slice(0, 240) || row.id
  const imported = metadata.importProvenance
  const importSource = metadataRecord(imported).source
  const remoteSource = metadata.remoteSource ?? metadata.sourceUrl
  const lineageAssetIds = safeIds(metadata.sourceAssetIds ?? metadata.lineageAssetIds)
  const origin: LibraryAssetOrigin = generation ? "generated" : imported ? "imported" : typeof remoteSource === "string" ? "ingested" : metadata.uploadState ? "uploaded" : "unknown"
  const originDetail = generation ? `${generation.provider} · ${generation.model}` : typeof importSource === "string" ? importSource.slice(0, 120) : null
  return { id: row.id, name, type: row.type, width: row.width, height: row.height, durationSeconds: row.durationSeconds, checksum: row.checksum, ready: metadata.uploadState === "ready" && /^sha256:[a-f0-9]{64}$/.test(row.checksum ?? ""), origin, originDetail, lineageAssetIds, createdAt: row.createdAt }
}

export function encodeLibraryCursor(value: { at: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ at: value.at.toISOString(), id: value.id }), "utf8").toString("base64url")
}

export function decodeLibraryCursor(value: string | null | undefined): { at: Date; id: string } | null {
  if (!value || value.length > 500) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { at?: unknown; id?: unknown }
    const at = typeof parsed.at === "string" ? new Date(parsed.at) : null
    if (!at || Number.isNaN(at.getTime()) || typeof parsed.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(parsed.id)) return null
    return { at, id: parsed.id }
  } catch {
    return null
  }
}
