import { describe, expect, it } from "vitest"
import { decodeLibraryCursor, encodeLibraryCursor, projectLibraryAsset } from "../library-projection"

const row = { id: "asset_1", type: "image" as const, storageProvider: "s3" as const, storageKey: "workspace/file.png", width: 1080, height: 1920, durationSeconds: null, checksum: `sha256:${"a".repeat(64)}`, metadata: { uploadState: "ready", sourceAssetIds: ["source_1", "bad id"] }, createdAt: new Date("2026-01-02T03:04:05Z") }

describe("Library projections", () => {
  it("round-trips a stable keyset cursor and rejects malformed cursors", () => {
    const cursor = encodeLibraryCursor({ at: row.createdAt, id: row.id })
    expect(decodeLibraryCursor(cursor)).toEqual({ at: row.createdAt, id: row.id })
    expect(decodeLibraryCursor("not-json")).toBeNull()
  })

  it("exposes sanitized generation origin and canonical lineage only", () => {
    expect(projectLibraryAsset(row, { id: "job_1", provider: "replicate", model: "model/v1" })).toMatchObject({ ready: true, origin: "generated", originDetail: "replicate · model/v1", lineageAssetIds: ["source_1"] })
  })

  it("fails safe picker readiness when a cryptographic digest is absent", () => {
    expect(projectLibraryAsset({ ...row, checksum: null }, null).ready).toBe(false)
  })
})
