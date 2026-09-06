import "server-only"

import { and, asc, eq, inArray } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { user, workspaceProductRecordRevisions, workspaceProductRecords, type WorkspaceRole } from "@/lib/db/schema"
import { updateProductRecord } from "@/lib/product-surfaces/repository"
import { supportCaseStateSchema, admitSupportCaseTransition } from "./case-policy"

export { SupportCasePolicyError } from "./case-policy"

export async function transitionSupportCase(input: { workspaceId: string; userId: string; actorRole: WorkspaceRole; recordId: string; expectedRevision: number; state: string; resolution: string; idempotencyKey: string }) {
  const [record] = await getDb().select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.recordId), eq(workspaceProductRecords.kind, "support_case"))).limit(1)
  if (!record) return null
  const admitted = admitSupportCaseTransition({ actorRole: input.actorRole, from: record.state, to: input.state, resolution: input.resolution })
  const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? record.payload : {}
  return updateProductRecord({ workspaceId: input.workspaceId, userId: input.userId, id: input.recordId, expectedKind: "support_case", expectedRevision: input.expectedRevision, state: admitted.state, payload: { ...payload, resolution: admitted.resolution }, idempotencyKey: input.idempotencyKey })
}

export async function listSupportCaseHistories(input: { workspaceId: string; recordIds: string[] }) {
  const recordIds = [...new Set(input.recordIds)].slice(0, 100)
  if (!recordIds.length) return new Map<string, SupportCaseHistoryEntry[]>()
  const rows = await getDb().select({ recordId: workspaceProductRecordRevisions.recordId, revision: workspaceProductRecordRevisions.revision, state: workspaceProductRecordRevisions.state, payload: workspaceProductRecordRevisions.payload, actorId: workspaceProductRecordRevisions.authorUserId, actorName: user.name, createdAt: workspaceProductRecordRevisions.createdAt })
    .from(workspaceProductRecordRevisions)
    .leftJoin(user, eq(user.id, workspaceProductRecordRevisions.authorUserId))
    .where(and(eq(workspaceProductRecordRevisions.workspaceId, input.workspaceId), inArray(workspaceProductRecordRevisions.recordId, recordIds)))
    .orderBy(asc(workspaceProductRecordRevisions.recordId), asc(workspaceProductRecordRevisions.revision))
  const history = new Map<string, SupportCaseHistoryEntry[]>()
  for (const row of rows) {
    const state = supportCaseStateSchema.safeParse(row.state)
    if (!state.success) continue
    const resolution = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) && typeof row.payload.resolution === "string" ? row.payload.resolution : ""
    const entry = { revision: row.revision, state: state.data, resolution, actor: { id: row.actorId, name: row.actorName }, createdAt: row.createdAt }
    history.set(row.recordId, [...(history.get(row.recordId) ?? []), entry])
  }
  return history
}

export type SupportCaseHistoryEntry = { revision: number; state: "open" | "waiting_customer" | "investigating" | "resolved" | "closed"; resolution: string; actor: { id: string; name: string | null }; createdAt: Date }
