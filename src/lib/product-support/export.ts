import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workspaceProductRecordRevisions, workspaceProductRecords } from "@/lib/db/schema";

export async function exportSupportRecord(input: { workspaceId: string; recordId: string; exportedAt?: Date }) {
  const db = getDb();
  const [record] = await db.select({ id: workspaceProductRecords.id, kind: workspaceProductRecords.kind, title: workspaceProductRecords.title, state: workspaceProductRecords.state, revision: workspaceProductRecords.revision, payload: workspaceProductRecords.payload, createdAt: workspaceProductRecords.createdAt, updatedAt: workspaceProductRecords.updatedAt }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.recordId), inArray(workspaceProductRecords.kind, ["feedback", "support_case"]))).limit(1);
  if (!record) return null;
  const revisions = await db.select({ revision: workspaceProductRecordRevisions.revision, title: workspaceProductRecordRevisions.title, state: workspaceProductRecordRevisions.state, payload: workspaceProductRecordRevisions.payload, createdAt: workspaceProductRecordRevisions.createdAt }).from(workspaceProductRecordRevisions).where(and(eq(workspaceProductRecordRevisions.workspaceId, input.workspaceId), eq(workspaceProductRecordRevisions.recordId, input.recordId))).orderBy(asc(workspaceProductRecordRevisions.revision));
  return { schema: "tasmeemai-support-record-export/v1", exportedAt: (input.exportedAt ?? new Date()).toISOString(), record, revisions };
}
