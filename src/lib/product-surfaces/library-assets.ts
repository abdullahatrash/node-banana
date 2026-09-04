import "server-only"

import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { assets, generationJobs } from "@/lib/db/schema"
import { decodeLibraryCursor, encodeLibraryCursor, projectLibraryAsset, type LibraryAssetProjection } from "./library-projection"

export async function listLibraryAssets(input: { workspaceId: string; query?: string; cursor?: string | null; limit?: number; readyOnly?: boolean }): Promise<{ items: LibraryAssetProjection[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 24, 1), 50)
  const cursor = decodeLibraryCursor(input.cursor)
  const query = input.query?.trim().slice(0, 120)
  const filters = [eq(assets.workspaceId, input.workspaceId), isNull(assets.deletedAt)]
  if (cursor) filters.push(or(lt(assets.createdAt, cursor.at), and(eq(assets.createdAt, cursor.at), lt(assets.id, cursor.id)))!)
  if (query) filters.push(ilike(sql`coalesce(${assets.metadata}->>'name', ${assets.metadata}->>'originalFileName', ${assets.storageKey})`, `%${query}%`))
  if (input.readyOnly) filters.push(and(sql`${assets.metadata}->>'uploadState' = 'ready'`, sql`${assets.checksum} ~ '^sha256:[a-f0-9]{64}$'`)!)
  const rows = await getDb().select().from(assets).where(and(...filters)).orderBy(desc(assets.createdAt), desc(assets.id)).limit(limit + 1)
  const pageRows = rows.slice(0, limit)
  const ids = pageRows.map((row) => row.id)
  const jobs = ids.length ? await getDb().select({ id: generationJobs.id, resultAssetId: generationJobs.resultAssetId, provider: generationJobs.provider, model: generationJobs.model }).from(generationJobs).where(and(eq(generationJobs.workspaceId, input.workspaceId), inArray(generationJobs.resultAssetId, ids))) : []
  const jobByAsset = new Map(jobs.map((job) => [job.resultAssetId, job]))
  const items = pageRows.map((row) => projectLibraryAsset(row, jobByAsset.get(row.id) ?? null))
  const last = pageRows.at(-1)
  return { items, nextCursor: rows.length > limit && last ? encodeLibraryCursor({ at: last.createdAt, id: last.id }) : null }
}
